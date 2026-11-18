// Quanto si muove ogni osso in un clip (gradi): per scovare busti rigidi e braccia ferme.
// Uso: node scripts/models/ossa.mjs file.glb clip
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
await MeshoptDecoder.ready;
const [file, clip] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clip);
const bones = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
const rows = [];
for (const b of bones) {
  const ch = anim.listChannels().find((c) => c.getTargetNode()?.getName() === b && c.getTargetPath() === 'rotation');
  if (!ch) {
    rows.push(`${b}: —`);
    continue;
  }
  const o = ch.getSampler().getOutput().getArray();
  const q0 = new THREE.Quaternion(o[0], o[1], o[2], o[3]);
  const rest = new THREE.Quaternion(...ch.getTargetNode().getRotation());
  let max = 0;
  for (let i = 0; i < o.length / 4; i++) max = Math.max(max, q0.angleTo(new THREE.Quaternion(o[i * 4], o[i * 4 + 1], o[i * 4 + 2], o[i * 4 + 3])));
  rows.push(`${b}: ${THREE.MathUtils.radToDeg(max).toFixed(0)}° (dal riposo ${THREE.MathUtils.radToDeg(rest.angleTo(q0)).toFixed(0)}°)`);
}
console.log(`${file} ${clip}\n  ` + rows.join('\n  '));
