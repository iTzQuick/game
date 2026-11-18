// Disegna lo scheletro di un clip, di lato e da dietro, in alcuni momenti: per vedere la
// postura (busto, braccia, gambe) senza aprire il gioco.
// Uso: node scripts/models/scheletro.mjs file.glb clip uscita.png [quanti=8] [da=0] [a=durata]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';
await MeshoptDecoder.ready;
const [file, clip, outFile, nArg = '8', fromArg, toArg] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const anim = root.listAnimations().find((a) => a.getName() === clip);
const tracks = new Map();
let duration = 0;
for (const ch of anim.listChannels()) {
  const s = ch.getSampler();
  const input = s.getInput().getArray();
  duration = Math.max(duration, input[input.length - 1]);
  const t = tracks.get(ch.getTargetNode()) ?? {};
  t[ch.getTargetPath()] = { input, output: s.getOutput().getArray() };
  tracks.set(ch.getTargetNode(), t);
}
const sample = (tr, t, size) => {
  const { input, output } = tr;
  let i = 0;
  while (i < input.length - 2 && input[i + 1] < t) i++;
  const k = input[i + 1] > input[i] ? Math.min(1, Math.max(0, (t - input[i]) / (input[i + 1] - input[i]))) : 0;
  const a = Array.from(output.slice(i * size, i * size + size));
  const b = Array.from(output.slice((i + 1) * size, (i + 1) * size + size));
  if (size === 4) return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...(b.length === 4 ? b : a)), k);
  return a.map((v, j) => v + ((b[j] ?? v) - v) * k);
};
const world = (t) => {
  const out = new Map();
  const visit = (node, parent) => {
    const tr = tracks.get(node) ?? {};
    const p = tr.translation ? sample(tr.translation, t, 3) : node.getTranslation();
    const q = tr.rotation ? sample(tr.rotation, t, 4) : new THREE.Quaternion(...node.getRotation());
    const s = tr.scale ? sample(tr.scale, t, 3) : node.getScale();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
    const w = parent ? parent.clone().multiply(m) : m;
    out.set(node.getName(), new THREE.Vector3().setFromMatrixPosition(w));
    for (const c of node.listChildren()) visit(c, w);
  };
  for (const n of scene.listChildren()) visit(n, null);
  return out;
};
const links = [
  ['Hips', 'Spine'], ['Spine', 'Spine01'], ['Spine01', 'Spine02'], ['Spine02', 'neck'], ['neck', 'Head'], ['Head', 'head_end'],
  ['Spine02', 'LeftShoulder'], ['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
  ['Spine02', 'RightShoulder'], ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
  ['Hips', 'LeftUpLeg'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['LeftFoot', 'LeftToeBase'],
  ['Hips', 'RightUpLeg'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'], ['RightFoot', 'RightToeBase'],
];
const left = (a) => a.startsWith('Left');
const n = Number(nArg);
const t0 = fromArg ? Number(fromArg) : 0;
const t1 = toArg ? Number(toArg) : duration;
const rest = world(0);
const h = rest.get('Head').y - Math.min(rest.get('LeftToeBase').y, rest.get('RightToeBase').y);
const S = 150 / h;
const W = 170;
const H = 210;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * n}" height="${H * 2}"><rect width="100%" height="100%" fill="#101018"/>`;
for (let i = 0; i < n; i++) {
  const t = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
  const w = world(t);
  const groundY = Math.min(...[...w.values()].map((v) => v.y));
  for (const [view, row] of [['lato', 0], ['dietro', 1]]) {
    const ox = i * W + W / 2;
    const oy = row * H + H - 20;
    const px = (v) => ox + (view === 'lato' ? v.z : v.x) * S;
    const py = (v) => oy - (v.y - groundY) * S;
    svg += `<text x="${i * W + 6}" y="${row * H + 16}" fill="#aaa" font-size="13" font-family="sans-serif">${t.toFixed(2)}s ${view}</text>`;
    svg += `<line x1="${i * W}" y1="${oy}" x2="${i * W + W}" y2="${oy}" stroke="#333"/>`;
    for (const [a, b] of links) {
      const A = w.get(a);
      const B = w.get(b);
      if (!A || !B) continue;
      const col = left(b) ? '#5ec8ff' : b.startsWith('Right') ? '#ff7a8a' : '#f2e3a0';
      svg += `<line x1="${px(A).toFixed(1)}" y1="${py(A).toFixed(1)}" x2="${px(B).toFixed(1)}" y2="${py(B).toFixed(1)}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>`;
    }
  }
}
svg += '</svg>';
await sharp(Buffer.from(svg)).png().toFile(outFile);
console.log(`${outFile}: ${clip} da ${t0.toFixed(2)} a ${t1.toFixed(2)} s (avanti = destra nella vista di lato)`);
