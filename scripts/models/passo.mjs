// Quanto va veloce una camminata o una corsa "sul posto": misura i piedi quando
// toccano terra. Serve a far coincidere animazione e movimento (niente piedi che scivolano).
// Uso: node scripts/models/passo.mjs file.glb clip altezza_in_metri
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
await MeshoptDecoder.ready;
const [file, clip, heightArg] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const anim = root.listAnimations().find((a) => a.getName() === clip);
if (!anim) throw new Error(`clip ${clip} non trovato: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);

// campionatori per nodo e proprietà
const tracks = new Map();
let duration = 0;
for (const ch of anim.listChannels()) {
  const s = ch.getSampler();
  const input = s.getInput().getArray();
  duration = Math.max(duration, input[input.length - 1]);
  (tracks.get(ch.getTargetNode()) ?? tracks.set(ch.getTargetNode(), {}).get(ch.getTargetNode()))[ch.getTargetPath()] = { input, output: s.getOutput().getArray() };
}
function sample(tr, t, size) {
  const { input, output } = tr;
  let i = 0;
  while (i < input.length - 2 && input[i + 1] < t) i++;
  const t0 = input[i];
  const t1 = input[Math.min(i + 1, input.length - 1)];
  const k = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const a = Array.from(output.slice(i * size, i * size + size));
  const b = Array.from(output.slice((i + 1) * size, (i + 1) * size + size));
  if (size === 4) return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...(b.length === 4 ? b : a)), k);
  return a.map((v, j) => v + ((b[j] ?? v) - v) * k);
}
function world(t) {
  const out = new Map();
  const visit = (node, parent) => {
    const tr = tracks.get(node) ?? {};
    const p = tr.translation ? sample(tr.translation, t, 3) : node.getTranslation();
    const q = tr.rotation ? sample(tr.rotation, t, 4) : new THREE.Quaternion(...node.getRotation());
    const s = tr.scale ? sample(tr.scale, t, 3) : node.getScale();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
    const w = parent ? parent.clone().multiply(m) : m;
    out.set(node.getName(), w);
    for (const c of node.listChildren()) visit(c, w);
  };
  for (const n of scene.listChildren()) visit(n, null);
  return out;
}
// scala: l'anca di una persona sta a circa il 52% dell'altezza (i bounds dei modelli
// compressi non sono affidabili, lo scheletro sì)
const rest = world(0);
const hipsY = new THREE.Vector3().setFromMatrixPosition(rest.get('Hips')).y;
const footY = Math.min(...['LeftFoot', 'RightFoot'].map((f) => new THREE.Vector3().setFromMatrixPosition(rest.get(f)).y));
const scale = (Number(heightArg) * 0.52) / (hipsY - footY + 0.06 * (hipsY - footY));
const feet = ['LeftFoot', 'RightFoot'];
const N = 240;
const res = [];
for (const foot of feet) {
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * duration;
    const w = world(t).get(foot) ?? [...world(t).entries()].find(([k]) => k.endsWith(foot))?.[1];
    if (!w) continue;
    pts.push(new THREE.Vector3().setFromMatrixPosition(w));
  }
  if (pts.length < 3) continue;
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const speeds = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y > lo + (hi - lo) * 0.12) continue; // solo quando il piede è a terra
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    speeds.push(d / (duration / N));
  }
  speeds.sort((a, c) => a - c);
  const median = speeds[Math.floor(speeds.length / 2)] ?? 0;
  res.push(median * scale);
}
const avg = res.reduce((a, c) => a + c, 0) / Math.max(1, res.length);
console.log(`${file} ${clip}: durata ${duration.toFixed(2)} s, velocità naturale ${avg.toFixed(2)} m/s (piedi: ${res.map((r) => r.toFixed(2)).join(', ')})`);
