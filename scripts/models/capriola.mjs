// Quanto gira il corpo in una capriola: l'angolo delle anche rispetto all'inizio, nel tempo.
// Uso: node scripts/models/capriola.mjs file.glb [clip]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
await MeshoptDecoder.ready;
const [file, clip = 'dodge'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clip);
if (!anim) throw new Error(`clip ${clip} non trovato`);
const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === 'Hips' && c.getTargetPath() === 'rotation');
const tr = anim.listChannels().find((c) => c.getTargetNode()?.getName() === 'Hips' && c.getTargetPath() === 'translation');
const inp = ch.getSampler().getInput().getArray();
const out = ch.getSampler().getOutput().getArray();
const q0 = new THREE.Quaternion(out[0], out[1], out[2], out[3]);
let total = 0;
let prev = q0.clone();
const rows = [];
const n = inp.length;
for (let i = 0; i < n; i++) {
  const q = new THREE.Quaternion(out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]);
  total += THREE.MathUtils.radToDeg(prev.angleTo(q));
  prev = q;
  if (i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1) {
    const ty = tr ? tr.getSampler().getOutput().getArray()[Math.min(i, tr.getSampler().getInput().getArray().length - 1) * 3 + 1] : NaN;
    rows.push(`${inp[i].toFixed(2)}s: ${THREE.MathUtils.radToDeg(q0.angleTo(q)).toFixed(0)}° h=${ty.toFixed(0)}`);
  }
}
console.log(`${file} ${clip}: durata ${inp[n - 1].toFixed(2)} s, rotazione totale delle anche ${total.toFixed(0)}°`);
console.log('  ' + rows.join(' | '));
