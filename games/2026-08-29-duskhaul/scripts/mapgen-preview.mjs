// Debug preview of `generateMap` (PRD-V2 §3): renders one seed's GeneratedMap
// to a PNG (1 px = 8 world px, 768×768) with no canvas dependency — raw RGB
// raster + zlib-deflated PNG chunks.
//
// run (from the game folder):
//   node --import ./scripts/ts-resolve.mjs scripts/mapgen-preview.mjs <zone> <seed...> [--out /tmp/duskhaul-mapgen]
// e.g. node --import ./scripts/ts-resolve.mjs scripts/mapgen-preview.mjs castle 1 2 3
//
// Legend: floor shade = region depth (darker = deeper) with 3 variant tones,
// roads = warm brown soft bands (the road brush decals), nav-blocked = near-black, bodies = grey discs (landmarks
// light grey), POI clearings = coloured rings (chests gold, lair/den red,
// vault violet, shrines cyan, veins/lore white, events orange, bell/fence
// teal), gates = large squares (A green, B yellow, C red, X violet), spawn =
// white cross, hazard anchors = orange dots, light pools = faint warm halos,
// breakables = tiny tan dots.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { zoneDef } from '../src/data/zones.ts';
import { generateMap } from '../src/systems/mapgen.ts';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : '/tmp/duskhaul-mapgen';
const positional = outIdx >= 0 ? args.filter((_, i) => i !== outIdx && i !== outIdx + 1) : args;
const [zoneId = 'castle', ...seeds] = positional;
if (seeds.length === 0) seeds.push('1');

/** 1 px = 32 world px (768² for the 24576² map). */
const SCALE = 32;

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(map) {
  const W = Math.round(map.width / SCALE);
  const img = Buffer.alloc(W * W * 3);
  const set = (x, y, c, a = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const i = (y * W + x) * 3;
    for (let k = 0; k < 3; k += 1) img[i + k] = Math.round(img[i + k] * (1 - a) + c[k] * a);
  };
  const disc = (wx, wy, wr, c, a = 1) => {
    const x = wx / SCALE, y = wy / SCALE, r = wr / SCALE;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy += 1) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx += 1) if (dx * dx + dy * dy <= r * r) set(x + dx, y + dy, c, a);
  };
  const ring = (wx, wy, wr, c) => {
    const x = wx / SCALE, y = wy / SCALE, r = wr / SCALE;
    const n = Math.max(24, Math.ceil(r * 7));
    for (let k = 0; k < n; k += 1) set(x + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r, c);
  };
  const square = (wx, wy, half, c) => {
    for (let dy = -half; dy <= half; dy += 1) for (let dx = -half; dx <= half; dx += 1) set(wx / SCALE + dx, wy / SCALE + dy, c);
  };

  // Floor: depth shade × variant tone; roads.
  const mn = Math.round(map.width / 32);
  const fl = map.floor;
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const wx = x * SCALE, wy = y * SCALE;
      const region = map.regionAt[Math.floor(wy / 32) * mn + Math.floor(wx / 32)];
      const depth = map.regions[region]?.depth ?? 2;
      const fi = Math.floor(wy / fl.cell) * fl.cols + Math.floor(wx / fl.cell);
      const v = fl.variant[fi];
      const base = [78, 64, 50][depth] + v * 6;
      let c = [base, base + 2, base + 8];
      const ni = Math.floor(wy / map.nav.cell) * map.nav.cols + Math.floor(wx / map.nav.cell);
      if (map.nav.blocked[ni] === 1) c = [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45];
      set(x, y, c);
    }
  }
  // Region borders.
  for (let y = 1; y < W; y += 1) for (let x = 1; x < W; x += 1) {
    const r = (px, py) => map.regionAt[Math.floor((py * SCALE) / 32) * mn + Math.floor((px * SCALE) / 32)];
    if (r(x, y) !== r(x - 1, y) || r(x, y) !== r(x, y - 1)) set(x, y, [120, 120, 140], 0.5);
  }
  // Roads: the soft `road-<zone>` brushes Arena draws along the road curves.
  for (const d of map.decals) if (d.id.startsWith('road-')) disc(d.x, d.y, 180, [120, 96, 70], 0.35);
  for (const l of map.lightPools) disc(l.x, l.y, l.r, [255, 200, 120], 0.12);
  for (const b of map.breakables) set(b.x / SCALE, b.y / SCALE, [190, 160, 110]);
  for (const p of map.props) disc(p.x, p.y, p.bodyRadius, p.id.startsWith('lm-') ? [215, 215, 215] : [150, 150, 158]);
  const poiColor = (k) =>
    k.startsWith('chest') ? [240, 200, 60] : k === 'lair' || k === 'den' ? [230, 50, 50] : k === 'vault' ? [180, 110, 240]
      : k.startsWith('shrine') ? [90, 220, 240] : k === 'event_yard' ? [250, 140, 40] : k === 'bell' || k === 'fence' ? [60, 200, 170] : [240, 240, 240];
  for (const p of map.pois) {
    ring(p.x, p.y, p.radius, poiColor(p.kind));
    disc(p.x, p.y, 64, poiColor(p.kind));
  }
  for (const h of map.hazardAnchors) set(h.x / SCALE, h.y / SCALE, [255, 120, 20]);
  const gateColor = { a: [60, 230, 90], b: [240, 230, 60], c: [240, 50, 50], x: [190, 90, 255] };
  for (const g of map.gates) {
    ring(g.x, g.y, 400, gateColor[g.id]);
    square(g.x, g.y, 5, gateColor[g.id]);
  }
  for (let k = -8; k <= 8; k += 1) {
    set(map.spawn.x / SCALE + k, map.spawn.y / SCALE, [255, 255, 255]);
    set(map.spawn.x / SCALE, map.spawn.y / SCALE + k, [255, 255, 255]);
  }
  return png(W, W, img);
}

mkdirSync(outDir, { recursive: true });
const zone = zoneDef(zoneId);
for (const seed of seeds) {
  const map = generateMap(zone, seed);
  const file = `${outDir}/x16-${zoneId}-${seed}.png`;
  writeFileSync(file, render(map));
  const m = map.metrics;
  console.log(
    `${file}: props ${map.props.length}, pois ${m.poiCount}, coverage ${m.coverage}, corridor ${m.minCorridor}, ` +
      `narrow ${m.narrowShare}, pathFactor ${m.maxPathFactor}, reseeds ${m.reseeds}, ${m.ms.toFixed(0)} ms`,
  );
}
