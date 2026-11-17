// Confronta due modelli con lo stesso scheletro: per ogni clip indicato, le ossa che si
// muovono in modo molto diverso (più di 25°). Serve a scovare animazioni rovinate.
// Uso: node scripts/models/confronta-clip.mjs a.glb b.glb clip1 [clip2 ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const read = async (f) => {
  const doc = await io.read(f); const out = {};
  for (const a of doc.getRoot().listAnimations()) for (const ch of a.listChannels()) {
    const n = ch.getTargetNode(); if (!n || ch.getTargetPath() !== 'rotation') continue;
    const rest = new THREE.Quaternion(...n.getRotation()); const v = ch.getSampler().getOutput().getArray();
    const rel = []; for (let i = 0; i < v.length / 4; i++) rel.push(rest.clone().invert().multiply(new THREE.Quaternion(v[i*4], v[i*4+1], v[i*4+2], v[i*4+3])));
    (out[a.getName()] ??= {})[n.getName()] = rel;
  }
  return out;
};
const A = await read(process.argv[2]); const B = await read(process.argv[3]);
for (const clip of process.argv.slice(4)) {
  const rows = [];
  for (const [bone, qa] of Object.entries(A[clip] ?? {})) {
    const qb = B[clip]?.[bone]; if (!qb || qb.length !== qa.length) { rows.push(`${bone}:?`); continue; }
    let m = 0; for (let i = 0; i < qa.length; i++) m = Math.max(m, THREE.MathUtils.radToDeg(qa[i].angleTo(qb[i])));
    if (m > 25) rows.push(`${bone} ${m.toFixed(0)}°`);
  }
  console.log(clip, '→ ossa diverse più di 25°:', rows.join(', ') || 'nessuno');
}
