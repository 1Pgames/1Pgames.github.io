import Phaser from 'phaser';
import { CSS, PALETTE, VIEW } from '../../config';
import { save } from '../../core/storage';
import { DIRECTIVES, PROTOCOLS, buildingDef, type DirectiveDef, type ProtocolDef } from '../../slices/colony/content';
import type { ColonyEvent, ColonyUiHost } from '../../slices/colony/contracts';
import type { ColonyState } from '../../slices/colony/model/state';
import { enterPinningHitArea } from '../entrance';
import { playEvolution } from '../progressFx';
import { label, tapZone } from '../widgets';
import { uiState } from './bridge';
import { CHROME, Control, TAG_HUE, TAG_ICON, TAG_LABEL, UI_DEPTH, icon, paintCapsule, paintPlacard, pin } from './theme';

/**
 * Dawn draft (§14 Draft; interface-direction: 3 cards 200 × 420 at x
 * 40/260/480, y 340 (h 400); protocol card 640 × 112 at y 752; REROLL 200 × 88 in the header row at
 * (480, 240)) over a bgDeep 0.72 scrim on the live map. Each card: tag chip,
 * icon, name, effect, and a synergy line ("Pairs with your 3 Pulse Turrets →
 * Bastion Array"). The protocol card carries the pulsing EVOLUTION READY rim;
 * tapping it plays the evolution ceremony (`playEvolution`) and then picks it.
 * No skip (a draft is a stopped clock); pick = 1 tap, reroll = 1 tap.
 */
const CARD = { w: 200, h: 400, y: 340, xs: [40, 260, 480] } as const;
const PROTO = { x: 40, y: 752, w: 640, h: 112 } as const;
/** REROLL sits in the header row (QA2 N1): nothing of the draft reaches the tray (872+) or the dock. */
const REROLL = { x: 480, y: 240, w: 200, h: 88 } as const;
const ARMOUR = { stroke: '#1a1418', strokeThickness: 4, shadow: { offsetX: 0, offsetY: 2, color: '#1a1418', blur: 0, fill: true, stroke: true } } as const;

type DraftEvent = Extract<ColonyEvent, { type: 'draft' }>;

/** How many buildings of the protocol's kind the colony has. */
function protoCount(model: ColonyState, p: ProtocolDef): number {
  let n = 0;
  for (const b of model.buildings.values()) {
    if (p.building === 'extractors' ? buildingDef(b.def).deposit !== null && b.def !== 'vent_tap' : b.def === p.building) n += 1;
  }
  return n;
}

function protoPieceName(p: ProtocolDef, plural: boolean): string {
  if (p.building === 'extractors') return plural ? 'extractors' : 'extractor';
  const name = buildingDef(p.building).name;
  return plural && !name.endsWith('s') ? `${name}s` : name;
}

/** The synergy line under a directive: what it evolves into, and whether the colony already pairs with it. */
function synergyLine(model: ColonyState, d: DirectiveDef): { text: string; ready: boolean } | null {
  const p = PROTOCOLS.find((x) => x.directive === d.id);
  if (p !== undefined) {
    const have = protoCount(model, p);
    if (have >= p.count) return { text: `Pairs with your ${have} ${protoPieceName(p, have !== 1)} → ${p.name}`, ready: true };
    return { text: `${p.count} ${protoPieceName(p, p.count !== 1)} → ${p.name} (${have}/${p.count})`, ready: false };
  }
  let sameTag = 0;
  for (const id of model.owned) if (DIRECTIVES.find((x) => x.id === id)?.tag === d.tag) sameTag += 1;
  return sameTag > 0 ? { text: `Your ${TAG_LABEL[d.tag]} ×${sameTag} → ×${sameTag + 1}`, ready: false } : null;
}

export function showDraft(host: ColonyUiHost, draft: DraftEvent): { destroy(): void } {
  const scene = host.scene;
  const model = host.model;
  const s = uiState(scene);
  // Law 1: the draft closes every lower non-pausing overlay (sheets, card).
  s.sheet?.close();
  if (s.cardUid !== null) host.select(null);
  // One draft on screen: a re-deal (reroll, the directive pick after a protocol) replaces any overlay still alive.
  for (const other of [...s.drafts]) other();

  const root = scene.add.container(0, 0).setDepth(UI_DEPTH.draft);
  const loops: Phaser.Tweens.Tween[] = [];
  const keys: Array<[string, () => void]> = [];
  let done = false;
  let picking = false;

  const scrim = scene.add.rectangle(0, 0, VIEW.width, VIEW.height, PALETTE.bgDeep, CHROME.draftScrim).setOrigin(0, 0).setInteractive();
  scrim.setData('noop', 'draft scrim: a draft has no skip; pick a card');
  const head = label(scene, 40, 284, `SOL ${draft.sol} · CHOOSE A DIRECTIVE`, { size: 28, bold: true, color: CSS.primary, origin: [0, 0.5] });
  head.setStroke(ARMOUR.stroke, ARMOUR.strokeThickness).setShadow(ARMOUR.shadow.offsetX, ARMOUR.shadow.offsetY, ARMOUR.shadow.color, ARMOUR.shadow.blur, ARMOUR.shadow.stroke, ARMOUR.shadow.fill);
  if (head.width > 424) head.setScale(424 / head.width);
  // Header over the scrimmed HUD: its own 0.6 band (interface-direction §4: text over art sits on a band).
  // It covers the whole SolBanner band (y 236-332) so the dimmed banner text never shows through under the title.
  const headBand = scene.add.rectangle(0, 236, VIEW.width, 96, PALETTE.bgDeep, 0.96).setOrigin(0, 0);
  root.add([scrim, headBand, head]);

  const destroy = (): void => {
    if (done) return;
    done = true;
    for (const t of loops) t.remove();
    loops.length = 0;
    for (const [k, fn] of keys) scene.input.keyboard?.off(k, fn);
    keys.length = 0;
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
    s.drafts.delete(destroy);
    s.draftOpen = s.drafts.size > 0;
    if (root.scene) root.destroy();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
  s.drafts.add(destroy);
  s.draftOpen = true;

  const pickDirective = (id: string): void => {
    if (done || picking) return;
    picking = true;
    save('tut:draft', true);
    destroy();
    host.pick(id);
  };

  const cards = draft.cards.map((id) => DIRECTIVES.find((d) => d.id === id)).filter((d): d is DirectiveDef => d !== undefined);
  cards.forEach((d, i) => {
    const x = CARD.xs[i] ?? CARD.xs[0];
    const zone = tapZone(scene, x, CARD.y, CARD.w, CARD.h, () => pickDirective(d.id), true).setData('cardId', d.id);
    const bg = scene.add.graphics({ x: CARD.w / 2, y: CARD.h / 2 });
    paintPlacard(bg, CARD.w, CARD.h, d.rarity === 'prime' ? PALETTE.accent : PALETTE.bgDeep);
    const hue = TAG_HUE[d.tag];
    const tag = scene.add.graphics({ x: CARD.w / 2, y: 34 });
    paintCapsule(tag, CARD.w - 24, 40, PALETTE.bgTop, hue);
    tag.fillStyle(hue, 0.25).fillRoundedRect(-(CARD.w - 24) / 2 + 2, -18, CARD.w - 28, 36, 18);
    const tagIcon = icon(scene, TAG_ICON[d.tag], 30);
    const tagText = label(scene, CARD.w / 2 + 14, 34, TAG_LABEL[d.tag], { size: 22, bold: true, origin: [0.5, 0.5] });
    const name = label(scene, CARD.w / 2, 186, d.name, { size: 24, bold: true, origin: [0.5, 0], align: 'center', wrap: CARD.w - 20 });
    const desc = label(scene, CARD.w / 2, 0, d.desc, { size: 22, color: CSS.inkSoft, origin: [0.5, 0], align: 'center', wrap: CARD.w - 24 });
    const parts: Phaser.GameObjects.GameObject[] = [bg, tag, tagText, name, desc];
    if (tagIcon !== null) parts.push(tagIcon.setPosition(34, 34));
    const syn = synergyLine(model, d);
    const line = syn === null ? null : label(scene, CARD.w / 2, 0, syn.text, { size: 22, bold: syn.ready, color: syn.ready ? CSS.accent : CSS.inkSoft, origin: [0.5, 1], align: 'center', wrap: CARD.w - 20 });
    // Measured flow (critic final #5): name → effect → synergy never overlap. When the text runs long,
    // the icon shrinks and the block rises; text keeps its 22 px floor.
    const bottom = CARD.h - 14;
    const need = name.height + 10 + desc.height + (line === null ? 0 : 12 + line.height);
    const nameY = Math.max(96, Math.min(186, bottom - need));
    name.setY(nameY);
    desc.setY(nameY + name.height + 10);
    const iconSize = Math.max(48, Math.min(96, nameY - 76));
    const img = icon(scene, d.iconKey, iconSize);
    if (img !== null) parts.push(img.setPosition(CARD.w / 2, 60 + (nameY - 60) / 2));
    if (line !== null && syn !== null) {
      line.setY(Math.max(bottom, desc.y + desc.height + 12 + line.height));
      parts.push(line);
      if (syn.ready) {
        const rim = scene.add.graphics({ x: CARD.w / 2, y: CARD.h / 2 });
        rim.lineStyle(4, PALETTE.accent, 1).strokeRoundedRect(-CARD.w / 2 + 2, -CARD.h / 2 + 2, CARD.w - 4, CARD.h - 4, 18);
        parts.push(rim);
        loops.push(scene.tweens.add({ targets: rim, alpha: { from: 0.6, to: 1 }, duration: 900, yoyo: true, repeat: -1 }));
      }
    }
    zone.add(parts);
    root.add(zone);
    pin(zone);
    enterPinningHitArea(scene, zone, { delayMs: i * 60, distance: 60, durationMs: 300 });
    const key = `keydown-${['ONE', 'TWO', 'THREE'][i] ?? 'ONE'}`;
    const fn = (): void => pickDirective(d.id);
    scene.input.keyboard?.on(key, fn);
    keys.push([key, fn]);
  });

  const proto = draft.protocol === null ? undefined : PROTOCOLS.find((p) => p.id === draft.protocol);
  if (proto !== undefined) {
    const directive = DIRECTIVES.find((d) => d.id === proto.directive);
    const evolve = (): void => {
      if (done || picking) return;
      picking = true;
      // The ceremony draws under the draft layer: hide the draft, play, then pick (the director re-opens the directive pick).
      root.setVisible(false);
      playEvolution(scene, {
        fromName: directive?.name ?? proto.directive,
        withName: `${proto.count} ${protoPieceName(proto, proto.count !== 1)}`,
        toName: proto.name,
        effectLine: proto.desc,
        onDone: () => {
          destroy();
          host.pick(proto.id);
        },
      });
    };
    const zone = tapZone(scene, PROTO.x, PROTO.y, PROTO.w, PROTO.h, evolve, true).setData('cardId', proto.id);
    const bg = scene.add.graphics({ x: PROTO.w / 2, y: PROTO.h / 2 });
    paintPlacard(bg, PROTO.w, PROTO.h);
    const rim = scene.add.graphics({ x: PROTO.w / 2, y: PROTO.h / 2 });
    rim.lineStyle(4, PALETTE.accent, 1).strokeRoundedRect(-PROTO.w / 2 + 2, -PROTO.h / 2 + 2, PROTO.w - 4, PROTO.h - 4, 18);
    loops.push(scene.tweens.add({ targets: rim, alpha: { from: 0.6, to: 1 }, duration: 900, yoyo: true, repeat: -1 }));
    const img = icon(scene, `proto-${proto.id}`, 96);
    const kicker = label(scene, 144, 20, 'EVOLUTION READY · FREE', { size: 22, bold: true, color: CSS.accent, origin: [0, 0.5] });
    const name = label(scene, 144, 48, proto.name, { size: 26, bold: true, origin: [0, 0.5] });
    const desc = label(scene, 144, 84, proto.desc, { size: 22, color: CSS.inkSoft, origin: [0, 0.5] });
    if (desc.width > 480) desc.setScale(480 / desc.width);
    zone.add(img === null ? [bg, rim, kicker, name, desc] : [bg, rim, img.setPosition(70, PROTO.h / 2), kicker, name, desc]);
    root.add(zone);
    pin(zone);
    enterPinningHitArea(scene, zone, { delayMs: 180, distance: 60, durationMs: 300 });
    scene.input.keyboard?.on('keydown-FOUR', evolve);
    keys.push(['keydown-FOUR', evolve]);
  }

  const reroll = (): void => {
    if (done || picking || draft.rerolls <= 0) return;
    // A successful reroll re-emits 'draft'; game.ts replaces this overlay.
    host.reroll();
  };
  const rr = new Control(scene, REROLL.x, REROLL.y, REROLL.w, REROLL.h, draft.rerolls > 0 ? `REROLL · ${draft.rerolls}` : 'REROLL · 0 left', 'secondary', reroll, { size: 24 });
  rr.setEnabled(draft.rerolls > 0 && cards.length > 0);
  root.add(rr.root);
  enterPinningHitArea(scene, rr.root, { delayMs: 200, distance: 40, durationMs: 260, fadeTo: rr.root.alpha });
  scene.input.keyboard?.on('keydown-R', reroll);
  keys.push(['keydown-R', reroll]);
  pin(root);

  return { destroy };
}
