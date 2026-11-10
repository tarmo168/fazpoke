/**
 * Build assets/og-image.png from an SVG card.
 *
 * The card is static. This script does not read data/sessions.json.
 * Chat apps cannot see a live chip leader from a GitHub Pages meta tag.
 *
 *   python3 -m pip install fonttools brotli
 *   npm install --no-save @resvg/resvg-js
 *   node scripts/og-image.mjs
 *
 * RESVG_MODULE can point at the package entry if it is installed elsewhere.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "assets", "og-image.png");

const python = `
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

def bake(src, dest, axes):
    font = TTFont(src)
    static = instantiateVariableFont(font, axes, inplace=False)
    static.flavor = None
    static.save(dest)

src_f, src_o, out_f, out_o = sys.argv[1:5]
bake(src_f, out_f, {"wght": 560, "opsz": 72})
bake(src_o, out_o, {"wght": 680})
`;

function loadResvg() {
  const require = createRequire(import.meta.url);
  const specs = [];
  if (process.env.RESVG_MODULE) specs.push(process.env.RESVG_MODULE);
  specs.push("@resvg/resvg-js");
  for (const spec of specs) {
    try {
      return require(spec).Resvg;
    } catch {
      /* Try the next place the package might be installed. */
    }
  }
  console.error("Install the SVG renderer, then run this script again:");
  console.error("  npm install --no-save @resvg/resvg-js");
  process.exit(1);
}

function bakeFonts(dir) {
  const fraunces = join(dir, "fraunces.ttf");
  const outfit = join(dir, "outfit.ttf");
  const result = spawnSync("python3", [
    "-c",
    python,
    join(root, "assets", "fonts", "fraunces.woff2"),
    join(root, "assets", "fonts", "outfit.woff2"),
    fraunces,
    outfit,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "Could not prepare the fonts.");
    console.error("Install them with: python3 -m pip install fonttools brotli");
    process.exit(result.status || 1);
  }
  return { fraunces, outfit };
}

function spots(count, radius, length, width) {
  let marks = "";
  for (let index = 0; index < count; index += 1) {
    const angle = (360 / count) * index;
    marks += `<rect x="${-width / 2}" y="${-radius}" width="${width}" height="${length}" rx="3" transform="rotate(${angle})" fill="#e4c27a"/>`;
  }
  return marks;
}

function cardSvg() {
  const edge = spots(16, 158, 34, 20);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="felt" cx="16%" cy="0%" r="78%">
      <stop offset="0%" stop-color="#2e7a4e" stop-opacity="0.62"/>
      <stop offset="58%" stop-color="#2e7a4e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lamp" cx="88%" cy="8%" r="52%">
      <stop offset="0%" stop-color="#e4c27a" stop-opacity="0.2"/>
      <stop offset="68%" stop-color="#e4c27a" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grain" width="5" height="5" patternUnits="userSpaceOnUse">
      <circle cx="0.7" cy="0.7" r="0.55" fill="#ffffff" opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="#101411"/>
  <rect width="1200" height="630" fill="url(#felt)"/>
  <rect width="1200" height="630" fill="url(#lamp)"/>
  <rect width="1200" height="630" fill="url(#grain)"/>
  <g stroke="#e4c27a" stroke-opacity="0.22" stroke-width="1">
    <path d="M70 150 H520"/>
    <path d="M70 470 H430"/>
    <path d="M64 196 V430"/>
  </g>
  <rect x="32" y="32" width="1136" height="566" rx="28" fill="none" stroke="#e4c27a" stroke-opacity="0.34" stroke-width="1.4"/>
  <g fill="none" stroke="#e4c27a" stroke-width="2.2" stroke-linecap="square">
    <path d="M52 92 V52 H92"/>
    <path d="M1108 92 V52 H1068"/>
    <path d="M52 538 V578 H92"/>
    <path d="M1108 538 V578 H1068"/>
  </g>
  <g transform="translate(76 196) scale(1.85)">
    <path d="M18 3.2 32.8 18 18 32.8 3.2 18 Z" fill="none" stroke="#e4c27a" stroke-width="1.7"/>
    <path d="M18 11.2 24.8 18 18 24.8 11.2 18 Z" fill="#e4c27a"/>
  </g>
  <text x="158" y="236" font-family="Outfit" font-size="20" fill="#e4c27a" letter-spacing="4.6">PRIVATE LEDGER</text>
  <text x="72" y="352" font-family="Fraunces" font-size="96" fill="#f6f3ec" letter-spacing="-2.6">Fazwazpoker</text>
  <text x="76" y="418" font-family="Outfit" font-size="28" fill="#e4c27a" letter-spacing="8.4">LEADERBOARD</text>
  <g transform="translate(968 324)">
    <ellipse cx="8" cy="168" rx="132" ry="16" fill="#000000" opacity="0.38"/>
    <g transform="translate(36 28) rotate(12)">
      <circle r="126" fill="#0c1410"/>
      <circle r="126" fill="none" stroke="#8d7040" stroke-width="8"/>
      <circle r="104" fill="#142019"/>
      <path d="M0 -22 L16 0 L0 22 L-16 0 Z" fill="#e4c27a"/>
    </g>
    <circle r="158" fill="#163228"/>
    ${edge}
    <circle r="128" fill="#101411"/>
    <circle r="116" fill="none" stroke="#e4c27a" stroke-width="2.4"/>
    <circle r="108" fill="none" stroke="#3ddc97" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="1.5 7"/>
    <circle r="100" fill="#1a2c23"/>
    <g fill="#f4e3b8" transform="translate(0 4)">
      <path d="M0 -62 L48 8 L-48 8 Z"/>
      <circle cx="-26" cy="12" r="25"/>
      <circle cx="26" cy="12" r="25"/>
      <path d="M-8 30 H8 L11 60 H-11 Z"/>
    </g>
  </g>
</svg>`;
}

function assertPng(png) {
  if (png.subarray(1, 4).toString() !== "PNG") throw new Error("Not a PNG.");
  if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
    throw new Error("Expected a 1200 by 630 PNG.");
  }
}

const dir = mkdtempSync(join(tmpdir(), "fazpoke-og-"));
try {
  const fonts = bakeFonts(dir);
  const Resvg = loadResvg();
  const resvg = new Resvg(cardSvg(), {
    fitTo: { mode: "width", value: 1200 },
    font: {
      fontFiles: [fonts.fraunces, fonts.outfit],
      loadSystemFonts: false,
      defaultFontFamily: "Outfit",
      serifFamily: "Fraunces",
      sansSerifFamily: "Outfit",
    },
  });
  const rendered = resvg.render();
  if (rendered.width !== 1200 || rendered.height !== 630) {
    throw new Error(`Renderer produced ${rendered.width} by ${rendered.height}.`);
  }
  const png = rendered.asPng();
  assertPng(png);
  writeFileSync(outPath, png);
  assertPng(readFileSync(outPath));
  console.log(outPath);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
