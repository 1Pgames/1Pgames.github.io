import Phaser from 'phaser';
import { CSS, PALETTE, SAFE, TEXT, VIEW } from '../config';
import { TEX } from '../core/keys';
import { sfx } from '../core/audio';
import { idleBob } from '../core/juice';
import { Button } from './button';
import { drawPanel } from './primitives';

/**
 * Level-select overlay for level-based families (board/match, table, word,
 * puzzle): a serpentine path of level nodes with a 0-3 star readout, the
 * classic saga map. Unlocked levels are tappable, everything past the
 * player's frontier is dimmed and inert, and the current level pulses so the
 * eye lands on it without reading a single label.
 *
 * Presentation only: the caller owns `unlockedCount` and `starsByLevel`
 * (usually `loadMeta().stars` + a derived frontier) and starts the level in
 * `onPick`, exactly like `ui/cards.ts` owns nothing about upgrades.
 *
 * Use for: choosing a level in a level-progression game.
 * Do NOT use for: run-scoped choices mid-level (that is `ui/cards.ts`) or the
 * meta-upgrade shop (`scenes/meta.ts`).
 */

export interface SagaMapLevel {
  id: string;
  label: string;
}

export interface SagaMapOptions {
  levels: readonly SagaMapLevel[];
  /** Levels `0..unlockedCount-1` are playable; the last of them is "current". */
  unlockedCount: number;
  starsByLevel: Record<string, number>;
  onPick: (levelId: string) => void;
  onClose: () => void;
}

export interface SagaMapHandle {
  destroy(): void;
}

const NODE_SIZE = 116; // >= 88px tap target, plus a visible ring of chrome
const ROW_HEIGHT = 190;
const SERPENTINE_X = 150;
const PIP_SIZE = 26;
const PIP_GAP = 32;
/** A pointer that travelled further than this was a scroll, never a tap. */
const DRAG_SLOP = 12;
const MAX_STAR_PIPS = 3;

interface NodeView {
  container: Phaser.GameObjects.Container;
  /** Segment up to the previous node; hidden unless both ends are on screen. */
  line: Phaser.GameObjects.Graphics | null;
}

/**
 * Half-heights of a node's drawn box (ring above, star pips below). Culling
 * uses them so a node is shown only while it fits *entirely* inside the
 * viewport — with no mask available, a half-drawn node would spill over the
 * panel border and the CLOSE button.
 */
const NODE_EXTENT_TOP = 82;
const NODE_EXTENT_BOTTOM = 96;
/** Slack at the end of the list so the last node can scroll fully into view. */
const CONTENT_PAD = 56;

export function showSagaMap(scene: Phaser.Scene, opts: SagaMapOptions): SagaMapHandle {
  const root = scene.add.container(0, 0).setDepth(2200).setScrollFactor(0);

  const dim = scene.add
    .rectangle(VIEW.centerX, VIEW.centerY, VIEW.width, VIEW.height, 0x000000, 0.62)
    .setScrollFactor(0)
    .setInteractive();
  root.add(dim);

  const panelWidth = VIEW.width - SAFE.side * 2;
  const viewportTop = SAFE.top + 40;
  const viewportBottom = VIEW.height - SAFE.bottom - 90;
  const viewportHeight = viewportBottom - viewportTop;

  // `drawPanel` centres its geometry on the Graphics origin, so the chrome is
  // positioned by its middle, not its corner.
  const panelTop = viewportTop - 78;
  const panelBottom = viewportBottom + 24;
  const panel = drawPanel(scene, panelWidth, panelBottom - panelTop, {
    fill: PALETTE.bgTop,
    fillAlpha: 0.96,
    stroke: PALETTE.primary,
    strokeAlpha: 0.45,
    strokeWidth: 4,
    radius: 32,
  })
    .setPosition(VIEW.centerX, (panelTop + panelBottom) / 2)
    .setScrollFactor(0);
  root.add(panel);

  const heading = scene.add
    .text(VIEW.centerX, viewportTop - 36, 'LEVELS', { ...TEXT.heading, fontSize: '44px' })
    .setOrigin(0.5)
    .setScrollFactor(0);
  root.add(heading);

  // Phaser 4 has no GeometryMask: the list is a plain container whose rows are
  // hidden once they leave the viewport (same trade as `scenes/meta.ts`).
  const content = scene.add.container(0, viewportTop).setScrollFactor(0);
  root.add(content);

  const nodes: NodeView[] = [];
  let dragDistance = 0;

  opts.levels.forEach((level, index) => {
    const x = VIEW.centerX + (index % 2 === 0 ? -SERPENTINE_X : SERPENTINE_X);
    const y = index * ROW_HEIGHT + ROW_HEIGHT / 2;
    // The path segment belongs to the node it arrives at, in node-local
    // coordinates, instead of to one shared Graphics: a segment is then shown
    // only while both of its ends are inside the viewport, which keeps the
    // path from drawing across the panel border with no mask available.
    // Drawn once per node, never per frame.
    const incoming = index === 0 ? null : { dx: SERPENTINE_X * (index % 2 === 0 ? 2 : -2), dy: -ROW_HEIGHT };

    const view = buildNode(scene, x, y, {
      label: level.label,
      stars: opts.starsByLevel[level.id] ?? 0,
      unlocked: index < opts.unlockedCount,
      current: index === opts.unlockedCount - 1,
      incoming,
      onTap: () => {
        if (dragDistance > DRAG_SLOP) return;
        sfx('ui');
        opts.onPick(level.id);
      },
    });
    content.add(view.container);
    nodes.push(view);
  });

  const contentHeight = opts.levels.length * ROW_HEIGHT + CONTENT_PAD;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  let scrollY = 0;

  // Open on the frontier: a saga map that starts at level 1 makes the player
  // flick through everything they already finished.
  const focusIndex = Math.max(0, Math.min(opts.levels.length - 1, opts.unlockedCount - 1));
  scrollY = Phaser.Math.Clamp(focusIndex * ROW_HEIGHT - viewportHeight / 2, 0, maxScroll);
  content.y = viewportTop - scrollY;

  function cull(): void {
    for (let i = 0; i < nodes.length; i += 1) {
      const view = nodes[i];
      if (view === undefined) continue;
      const worldY = content.y + view.container.y;
      const visible = worldY - NODE_EXTENT_TOP > viewportTop && worldY + NODE_EXTENT_BOTTOM < viewportBottom;
      if (view.container.visible !== visible) view.container.setVisible(visible);
      if (view.line === null) continue;
      const linkVisible = visible && nodes[i - 1]?.container.visible === true;
      if (view.line.visible !== linkVisible) view.line.setVisible(linkVisible);
    }
  }
  cull();

  let dragging = false;
  let lastPointerY = 0;

  const onDown = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.y < viewportTop || pointer.y > viewportBottom) return;
    dragging = true;
    dragDistance = 0;
    lastPointerY = pointer.y;
  };
  const onMove = (pointer: Phaser.Input.Pointer): void => {
    if (!dragging) return;
    const dy = pointer.y - lastPointerY;
    lastPointerY = pointer.y;
    dragDistance += Math.abs(dy);
    if (maxScroll === 0) return;
    scrollY = Phaser.Math.Clamp(scrollY - dy, 0, maxScroll);
    content.y = viewportTop - scrollY;
    cull();
  };
  const onUp = (): void => {
    dragging = false;
  };

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
  scene.input.on(Phaser.Input.Events.POINTER_UP, onUp);

  const close = new Button(
    scene,
    VIEW.centerX,
    VIEW.height - SAFE.bottom + 20,
    'CLOSE',
    () => opts.onClose(),
    { width: panelWidth, height: 96, fill: PALETTE.bgTop, stroke: PALETTE.primary, textColor: CSS.ink },
  );
  root.add(close);

  // `GameObject#scene` is nulled on destroy and scene shutdown destroys
  // children before every SHUTDOWN listener runs: keep our own scene handle
  // plus a flag so a double teardown cannot throw inside the shutdown emit.
  let destroyed = false;
  const host = scene;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    host.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
    host.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
    host.input.off(Phaser.Input.Events.POINTER_UP, onUp);
    host.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
    root.destroy(true);
  }
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);

  return { destroy };
}

interface NodeSpec {
  label: string;
  stars: number;
  unlocked: boolean;
  current: boolean;
  /** Offset of the previous node, node-local; `null` for the first level. */
  incoming: { dx: number; dy: number } | null;
  onTap: () => void;
}

function buildNode(scene: Phaser.Scene, x: number, y: number, spec: NodeSpec): NodeView {
  const node = scene.add.container(x, y);

  let line: Phaser.GameObjects.Graphics | null = null;
  if (spec.incoming !== null) {
    line = scene.add.graphics();
    line.lineStyle(10, PALETTE.primary, 0.22);
    line.lineBetween(0, 0, spec.incoming.dx, spec.incoming.dy);
    node.add(line);
  }

  const disc = scene.add
    .image(0, 0, TEX.disc)
    .setDisplaySize(NODE_SIZE, NODE_SIZE)
    .setTint(spec.unlocked ? PALETTE.primary : PALETTE.bgBottom);
  const ring = scene.add
    .image(0, 0, TEX.ring)
    .setDisplaySize(NODE_SIZE + 14, NODE_SIZE + 14)
    .setTint(spec.current ? PALETTE.accent : PALETTE.inkSoft)
    .setAlpha(spec.current ? 1 : 0.5);
  const label = scene.add
    .text(0, 0, spec.label, {
      ...TEXT.button,
      fontSize: '36px',
      color: spec.unlocked ? '#05070d' : CSS.inkSoft,
      // The disc is the contrast surface; the backdrop armour would smear the digit.
      stroke: undefined,
      strokeThickness: 0,
      shadow: undefined,
    })
    .setOrigin(0.5);

  const pips: Phaser.GameObjects.Image[] = [];
  for (let i = 0; i < MAX_STAR_PIPS; i += 1) {
    const earned = i < spec.stars;
    pips.push(
      scene.add
        .image((i - 1) * PIP_GAP, NODE_SIZE / 2 + 22, TEX.star)
        .setDisplaySize(PIP_SIZE, PIP_SIZE)
        .setTint(earned ? PALETTE.accent : PALETTE.inkSoft)
        .setAlpha(earned ? 1 : 0.28),
    );
  }

  node.add([ring, disc, label, ...pips]);
  node.setSize(NODE_SIZE + 14, NODE_SIZE + 14);

  if (!spec.unlocked) {
    node.setAlpha(0.34);
    return { container: node, line };
  }

  // Screen-space interactive: pin it, or a following camera offsets the hit
  // area from the pixels (Phaser hit-tests children against camera scroll).
  node.setScrollFactor(0);
  node.setInteractive({ useHandCursor: true });

  // Click semantics: arm on our own POINTER_DOWN, disarm on POINTER_OUT, so a
  // release that began elsewhere (or a flick-scroll) never picks a level.
  let armed = false;
  node.on(Phaser.Input.Events.POINTER_DOWN, () => {
    armed = true;
    node.setScale(0.95);
  });
  node.on(Phaser.Input.Events.POINTER_OUT, () => {
    armed = false;
    node.setScale(1);
  });
  node.on(Phaser.Input.Events.POINTER_UP, () => {
    node.setScale(1);
    if (!armed) return;
    armed = false;
    spec.onTap();
  });

  if (spec.current) idleBob(scene, node, 8, 1200);
  return { container: node, line };
}
