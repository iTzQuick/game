// Copia un clip intero da un modello a un altro con lo stesso scheletro (Meshy):
// per ogni osso la rotazione RELATIVA alla posa di riposo; lo spostamento delle anche
// in proporzione all'altezza delle anche. Il clip con lo stesso nome nella
// destinazione viene sostituito (gli altri restano com'erano).
//
// Uso: node scripts/models/copia-clip.mjs destinazione.glb sorgente.glb clip [nuovoNome]
// Esempio (la corsa a passi lunghi della Lama al Guardiano):
//   node scripts/models/copia-clip.mjs public/models/guardiano.glb public/models/lama.glb run

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';

const [dst, src, clip, newName = clip] = process.argv.slice(2);
if (!dst || !src || !clip) {
  console.error('uso: copia-clip.mjs destinazione.glb sorgente.glb clip [nuovoNome]');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const target = await io.read(dst);
const source = await io.read(src);
const srcAnim = source.getRoot().listAnimations().find((a) => a.getName() === clip);
if (!srcAnim) throw new Error(`clip ${clip} non trovato in ${src}`);

const nodesByName = new Map(target.getRoot().listNodes().map((n) => [n.getName(), n]));
const hipsT = nodesByName.get('Hips');
const hipsS = source.getRoot().listNodes().find((n) => n.getName() === 'Hips');
// le anche più alte fanno passi più lunghi: lo spostamento si scala con l'altezza delle anche
const hipScale = hipsT && hipsS ? hipsT.getTranslation()[1] / hipsS.getTranslation()[1] : 1;

const buffer = target.getRoot().listBuffers()[0];
const old = target.getRoot().listAnimations().find((a) => a.getName() === newName);
if (old) {
  for (const ch of old.listChannels()) ch.dispose();
  for (const s of old.listSamplers()) s.dispose();
  old.dispose();
}
const anim = target.createAnimation(newName);
let copied = 0;
for (const ch of srcAnim.listChannels()) {
  const sNode = ch.getTargetNode();
  const path = ch.getTargetPath();
  const tNode = sNode && nodesByName.get(sNode.getName());
  if (!sNode || !tNode) continue;
  const s = ch.getSampler();
  const sIn = s.getInput().getArray();
  const sOut = s.getOutput().getArray();
  let out;
  if (path === 'rotation') {
    const restS = new THREE.Quaternion(...sNode.getRotation());
    const restT = new THREE.Quaternion(...tNode.getRotation());
    out = new Float32Array(sOut.length);
    for (let i = 0; i < sOut.length / 4; i++) {
      const q = new THREE.Quaternion(sOut[i * 4], sOut[i * 4 + 1], sOut[i * 4 + 2], sOut[i * 4 + 3]);
      const fixed = restT.clone().multiply(restS.clone().invert().multiply(q)).normalize();
      out.set([fixed.x, fixed.y, fixed.z, fixed.w], i * 4);
    }
  } else if (path === 'translation') {
    // solo le anche si spostano davvero; per le altre ossa resta la posa della destinazione
    const restS = sNode.getTranslation();
    const restT = tNode.getTranslation();
    out = new Float32Array(sOut.length);
    const k = sNode.getName() === 'Hips' ? hipScale : 0;
    for (let i = 0; i < sOut.length / 3; i++) {
      for (let j = 0; j < 3; j++) out[i * 3 + j] = restT[j] + (sOut[i * 3 + j] - restS[j]) * k;
    }
  } else continue;
  const input = target.createAccessor().setType('SCALAR').setArray(new Float32Array(sIn)).setBuffer(buffer);
  const output = target.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(out).setBuffer(buffer);
  const sampler = target.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
  anim.addSampler(sampler);
  anim.addChannel(target.createAnimationChannel().setTargetNode(tNode).setTargetPath(path).setSampler(sampler));
  copied++;
}
await io.write(dst, target);
console.log(`${newName}: ${copied} canali copiati da ${src} (anche ×${hipScale.toFixed(2)}) → ${dst}`);
