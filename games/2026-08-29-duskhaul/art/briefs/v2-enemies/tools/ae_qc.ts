// Batch per-asset QC for enemies-v2: checkPalette (same fn as xd://sprite_check_palette),
// reviewArt (same fn as xd://art_review, per asset), plus body-mass lightness (CIE L*).
import sharp from "/Users/tmwh/.omp/plugins/node_modules/oh-my-pi-sprite-forge/node_modules/sharp";
import { checkPalette, loadStyleProfile } from "/Users/tmwh/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/style-profile.ts";
import { reviewArt } from "/Users/tmwh/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts/art-report.ts";
import { readdirSync } from "node:fs";

const G = "/Users/tmwh/homework/1Pgames/games/2026-08-29-duskhaul";
const root = `${G}/public/assets/generated/enemies-v2`;
const profile = await loadStyleProfile(`${G}/art/style.json`);
const lstar = (r: number, g: number, b: number) => {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};
const rows: Record<string, unknown>[] = [];
for (const id of readdirSync(root).filter((d) => d.startsWith("enemy-")).sort()) {
  const { data, info } = await sharp(`${root}/${id}/sprite-sheet.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pal = checkPalette(data, info.width, info.height, profile);
  const art = reviewArt(data, info.width, info.height, profile);
  const ls: number[] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) ls.push(lstar(data[i], data[i + 1], data[i + 2]));
  ls.sort((a, b) => a - b);
  const median = ls[Math.floor(ls.length / 2)];
  const ge40 = ls.filter((v) => v >= 40).length / ls.length;
  rows.push({
    id, meanDistance: +pal.meanDistance.toFixed(2), palPass: pal.passed,
    Lmedian: +median.toFixed(1), shareL40: +ge40.toFixed(3),
    dark: +art.value.dark.toFixed(3), mid: +art.value.mid.toFixed(3), light: +art.value.light.toFixed(3),
    artPass: art.passed, findings: art.findings.map((f) => `${f.severity}:${f.code}`).join(","),
  });
}
console.log(JSON.stringify(rows));
