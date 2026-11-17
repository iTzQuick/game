// Trova il momento del colpo in un clip d'attacco: l'istante in cui la mano
// (o l'avambraccio) ruota più in fretta. Serve a ritagliare il clip attorno al
// colpo, perché i clip della libreria hanno lunghe preparazioni e chiusure.
//
// Uso: node scripts/models/strike.mjs clip.glb [osso ...]

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [path, ...bones] = process.argv.slice(2);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
const anim = doc.getRoot().listAnimations()[0];
const watch = bones.length ? bones : ['RightHand', 'RightForeArm', 'LeftHand', 'LeftForeArm', 'Spine02'];

export function speedCurve(anim, boneName) {
  const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === boneName && c.getTargetPath() === 'rotation');
  if (!ch) return null;
  const t = ch.getSampler().getInput().getArray();
  const q = ch.getSampler().getOutput().getArray();
  const out = [];
  for (let i = 1; i < t.length; i++) {
    const dot = Math.abs(q[i * 4 - 4] * q[i * 4] + q[i * 4 - 3] * q[i * 4 + 1] + q[i * 4 - 2] * q[i * 4 + 2] + q[i * 4 - 1] * q[i * 4 + 3]);
    const ang = 2 * Math.acos(Math.min(1, dot));
    out.push([t[i], ang / (t[i] - t[i - 1])]);
  }
  return out;
}

const dur = Math.max(...anim.listSamplers().map((s) => s.getInput().getMax([])[0]));
console.log(`${path}: ${anim.getName()}, ${dur.toFixed(2)} s`);
for (const b of watch) {
  const c = speedCurve(anim, b);
  if (!c) continue;
  const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 3);
  // profilo a blocchi di 0.1 s
  const bins = [];
  for (const [t, v] of c) {
    const k = Math.floor(t * 10);
    bins[k] = Math.max(bins[k] ?? 0, v);
  }
  const bar = bins.map((v) => ' ▁▂▃▄▅▆▇█'[Math.min(8, Math.round(((v ?? 0) / top[0][1]) * 8))]).join('');
  console.log(`${b.padEnd(13)} picco ${top[0][0].toFixed(2)} s  |${bar}|`);
}
