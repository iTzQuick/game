// Rende un'immagine ripetibile senza cuciture (per pavimenti, muri, cielo).
// Due passaggi: prima in orizzontale, poi in verticale. In ognuno l'immagine si
// fonde con una copia spostata di mezza larghezza, usando la copia solo vicino ai
// bordi: così i bordi opposti combaciano e al centro resta l'originale.
//
// Uso: node scripts/models/tile.mjs in.png out.webp [--size 1024] [--solo-orizzontale] [--quality 82]

import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const size = Number(opt('size', '1024'));
const quality = Number(opt('quality', '82'));
const onlyH = flag('solo-orizzontale');
const [input, output] = args;
if (!input || !output) {
  console.error('uso: tile.mjs in.png out.webp [--size 1024] [--solo-orizzontale]');
  process.exit(1);
}

const img = sharp(input).removeAlpha();
const meta = await img.metadata();
const w = onlyH ? size : size;
const h = onlyH ? Math.round((size * meta.height) / meta.width) : size;
const { data } = await img.resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });

const smooth = (t) => t * t * (3 - 2 * t);
/** peso della copia spostata: 1 al bordo, 0 da un quarto in poi */
const edge = (u) => 1 - smooth(Math.min(1, Math.min(u, 1 - u) / 0.25));

function pass(src, horizontal) {
  const out = Buffer.alloc(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = horizontal ? (x + w / 2) % w : x;
      const sy = horizontal ? y : (y + h / 2) % h;
      const m = horizontal ? edge(x / (w - 1)) : edge(y / (h - 1));
      const i = (y * w + x) * 3;
      const j = (sy * w + sx) * 3;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(src[i + c] * (1 - m) + src[j + c] * m);
    }
  }
  return out;
}

let px = pass(data, true);
if (!onlyH) px = pass(px, false);
await sharp(px, { raw: { width: w, height: h, channels: 3 } }).webp({ quality }).toFile(output);
console.log(`scritto ${output} (${w}×${h}${onlyH ? ', solo in orizzontale' : ''})`);
