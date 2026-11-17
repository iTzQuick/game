import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/core';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const d = await io.read(f);
  const r = d.getRoot();
  const tris = r.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const scene = r.listScenes()[0];
  const b = getBounds(scene);
  console.log(f.split('/').pop(), {
    tris: Math.round(tris),
    textures: r.listTextures().map((t) => `${t.getMimeType()} ${t.getSize()?.join('x')}`),
    skins: r.listSkins().map((s) => s.listJoints().length + ' ossa'),
    anims: r.listAnimations().map((a) => `${a.getName()} (${a.listChannels().length} canali)`),
    size: b.max.map((v, i) => +(v - b.min[i]).toFixed(2)),
    min: b.min.map((v) => +v.toFixed(2)),
    nodes: r.listNodes().length,
  });
}
