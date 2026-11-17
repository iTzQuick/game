// Corregge un osso rovinato in alcuni clip copiando il movimento dallo stesso
// clip di un altro modello con lo stesso scheletro (Meshy). Si copia la rotazione
// RELATIVA alla posa di riposo, così va bene anche se le pose di riposo differiscono.
//
// Uso: node scripts/models/copia-osso.mjs destinazione.glb sorgente.glb Osso clip1,clip2
// Esempio (testa del Custode girata all'indietro in corsa):
//   node scripts/models/copia-osso.mjs public/models/custode.glb public/models/guardiano.glb Head run,down

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';

const [dst, src, bone, clipList] = process.argv.slice(2);
if (!dst || !src || !bone || !clipList) {
  console.error('uso: copia-osso.mjs destinazione.glb sorgente.glb Osso clip1,clip2');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const target = await io.read(dst);
const source = await io.read(src);

function track(doc, clip) {
  const a = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
  const ch = a?.listChannels().find((c) => c.getTargetNode()?.getName() === bone && c.getTargetPath() === 'rotation');
  return ch ? { node: ch.getTargetNode(), sampler: ch.getSampler() } : null;
}

for (const clip of clipList.split(',')) {
  const t = track(target, clip);
  const s = track(source, clip);
  if (!t || !s) {
    console.error(`${clip}: osso ${bone} non trovato in uno dei due modelli`);
    process.exit(1);
  }
  const restT = new THREE.Quaternion(...t.node.getRotation());
  const restS = new THREE.Quaternion(...s.node.getRotation());
  const sIn = s.sampler.getInput().getArray();
  const sOut = s.sampler.getOutput().getArray();
  const out = new Float32Array(sOut.length);
  for (let i = 0; i < sIn.length; i++) {
    const q = new THREE.Quaternion(sOut[i * 4], sOut[i * 4 + 1], sOut[i * 4 + 2], sOut[i * 4 + 3]);
    const rel = restS.clone().invert().multiply(q);
    const fixed = restT.clone().multiply(rel).normalize();
    out.set([fixed.x, fixed.y, fixed.z, fixed.w], i * 4);
  }
  // tempi e valori nuovi su accessor nuovi (gli altri canali restano com'erano)
  const input = target.createAccessor().setType('SCALAR').setArray(new Float32Array(sIn)).setBuffer(target.getRoot().listBuffers()[0]);
  const output = target.createAccessor().setType('VEC4').setArray(out).setBuffer(target.getRoot().listBuffers()[0]);
  t.sampler.setInput(input).setOutput(output).setInterpolation(s.sampler.getInterpolation());
  console.log(`${clip}: ${bone} copiato (${sIn.length} chiavi)`);
}
await io.write(dst, target);
console.log(`scritto ${dst}`);
