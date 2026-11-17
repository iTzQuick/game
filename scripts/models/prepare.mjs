// Prepara un modello 3D generato (Higgsfield/Meshy) per il gioco:
// - unisce in un solo file le animazioni arrivate in file separati
//   (stesso scheletro: i canali si collegano per nome dell'osso),
// - dà ai clip nomi semplici (idle, run, attack, down…),
// - alleggerisce per il telefono: texture WebP ridotte, geometria compressa (meshopt).
//
// Uso:
//   node scripts/models/prepare.mjs out.glb base.glb:idle [run.glb:run ...] [--texture 1024]
//
// Il file base dà mesh, materiali e scheletro; il suo primo clip prende il nome indicato.
// Un clip si può ritagliare indicando inizio e fine in secondi: attack.glb:attack@0.7-1.5
// (scripts/models/strike.mjs dice quando arriva il colpo).

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const textureSize = Number(opt('texture', '1024'));
const [out, baseSpec, ...extra] = args;
if (!out || !baseSpec) {
  console.error('uso: prepare.mjs out.glb base.glb:clip [altro.glb:clip ...] [--texture 1024]');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** "file.glb:nome@0.7-1.5" → [file, nome, [0.7, 1.5] | null] */
const split = (spec) => {
  const i = spec.lastIndexOf(':');
  if (i <= 1) return [spec, null, null];
  const [name, range] = spec.slice(i + 1).split('@');
  const trim = range ? range.split('-').map(Number) : null;
  return [spec.slice(0, i), name, trim];
};

/** Tiene solo i fotogrammi tra from e to e li sposta a partire da 0. */
function trimArrays(input, output, from, to) {
  const n = input.length;
  const size = output.length / n;
  const keep = [];
  for (let k = 0; k < n; k++) if (input[k] >= from - 1e-4 && input[k] <= to + 1e-4) keep.push(k);
  if (!keep.length) {
    // nessun fotogramma nella finestra: il valore più vicino, fermo
    let best = 0;
    for (let k = 1; k < n; k++) if (Math.abs(input[k] - from) < Math.abs(input[best] - from)) best = k;
    keep.push(best);
  }
  const t = new Float32Array(keep.length);
  const v = new output.constructor(keep.length * size);
  keep.forEach((k, j) => {
    t[j] = Math.max(0, input[k] - from);
    for (let c = 0; c < size; c++) v[j * size + c] = output[k * size + c];
  });
  return [t, v];
}

const [basePath, baseClip, baseTrim] = split(baseSpec);
if (baseTrim) console.warn('il ritaglio non si applica al clip del file base');
const doc = await io.read(basePath);
const root = doc.getRoot();
const buffer = root.listBuffers()[0] ?? doc.createBuffer();

const anims = root.listAnimations();
if (baseClip && anims[0]) anims[0].setName(baseClip);
for (const a of anims.slice(1)) a.dispose(); // un clip per file: teniamo solo il primo

const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));

for (const spec of extra) {
  const [path, clipName, trim] = split(spec);
  const src = await io.read(path);
  const anim = src.getRoot().listAnimations()[0];
  if (!anim) {
    console.warn(`${path}: nessuna animazione`);
    continue;
  }
  const copy = doc.createAnimation(clipName ?? anim.getName());
  let linked = 0;
  for (const ch of anim.listChannels()) {
    const target = ch.getTargetNode();
    const node = target && nodesByName.get(target.getName());
    if (!node) continue;
    const s = ch.getSampler();
    let input = s.getInput().getArray().slice();
    let output = s.getOutput().getArray().slice();
    if (trim) [input, output] = trimArrays(input, output, trim[0], trim[1]);
    const acc = (array, like) => doc.createAccessor().setType(like.getType()).setArray(array).setNormalized(like.getNormalized()).setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(acc(input, s.getInput()))
      .setOutput(acc(output, s.getOutput()))
      .setInterpolation(s.getInterpolation());
    copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    linked++;
  }
  console.log(`${path} → clip "${copy.getName()}" (${linked} canali collegati${trim ? `, ritagliato ${trim[0]}–${trim[1]} s` : ''})`);
}

await doc.transform(
  dedup(),
  resample(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize], quality: 85 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const clips = root.listAnimations().map((a) => a.getName());
const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
await io.write(out, doc);
console.log(`scritto ${out}: ${Math.round(tris)} triangoli, clip: ${clips.join(', ') || 'nessuno'}`);
