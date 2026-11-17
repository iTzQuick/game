// Generazione della Frattura: una catena di stanze collegate da corridoi,
// ricavata da un seme. Tutti i dispositivi generano la stessa Frattura dallo
// stesso seme, quindi in rete viaggia solo il numero.
//
// Le stanze avanzano verso -Z: stanza 0 (ingresso, sicura), poi stanze di
// combattimento, infine la stanza del boss.

import { rng } from './defs';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Pillar {
  x: number;
  z: number;
  r: number;
  h: number;
}

export type RoomKind = 'start' | 'combat' | 'boss';

/**
 * Che cosa c'è in una stanza di combattimento:
 * - normale: le ondate di sempre;
 * - campione: meno nemici, ma uno è un Campione (grosso, dorato, lascia un oggetto migliore);
 * - prova: ripulirla entro il tempo dà un premio in più;
 * - trappole: dal pavimento escono spine (fanno male anche ai nemici);
 * - tesoro: niente nemici, un forziere al centro.
 */
export type RoomVariant = 'normale' | 'campione' | 'prova' | 'trappole' | 'tesoro';

export const VARIANT_INFO: Record<RoomVariant, { name: string; hint: string; glyph: string }> = {
  normale: { name: 'Stanza', hint: '', glyph: '⚔' },
  campione: { name: 'Il Campione', hint: 'Un nemico dorato, molto più forte: lascia un oggetto migliore', glyph: '♛' },
  prova: { name: 'Prova a tempo', hint: 'Ripulite la stanza prima che scada il tempo: premio in più', glyph: '⧗' },
  trappole: { name: 'Sala delle spine', hint: 'Le spine escono dal pavimento: fanno male anche ai nemici', glyph: '⚠' },
  tesoro: { name: 'Tesoro', hint: 'Nessun nemico: avvicinatevi al forziere', glyph: '✦' },
};

export interface DRoom {
  i: number;
  kind: RoomKind;
  cx: number;
  cz: number;
  w: number;
  d: number;
  rect: Rect;
  pillars: Pillar[];
  /** solo per le stanze di combattimento */
  variant?: RoomVariant;
  /** x della porta sud (da dove si entra) e nord (da dove si esce). */
  doorSouthX: number | null;
  doorNorthX: number | null;
}

export interface Corridor {
  /** Collega la stanza i alla stanza i + 1. */
  i: number;
  x: number;
  rect: Rect;
}

export interface Dungeon {
  seed: number;
  rooms: DRoom[];
  corridors: Corridor[];
}

export const CORRIDOR_WIDTH = 4;
export const CORRIDOR_LENGTH = 9;
export const WALL_THICKNESS = 0.6;
export const WALL_HEIGHT = 2.6;

/** Numero di stanze di combattimento: cresce piano con il Grado. */
export function combatRoomCount(grado: number): number {
  return Math.min(5, 3 + Math.floor((Math.max(1, grado) - 1) / 3));
}

export function generateDungeon(seed: number, grado: number): Dungeon {
  const rand = rng(seed);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const kinds: RoomKind[] = ['start', ...Array(combatRoomCount(grado)).fill('combat'), 'boss'];

  const rooms: DRoom[] = [];
  const corridors: Corridor[] = [];
  let cx = 0;
  let southEdge = 7; // bordo sud della stanza 0

  kinds.forEach((kind, i) => {
    const w = kind === 'start' ? 16 : kind === 'boss' ? 32 : Math.round(between(20, 28));
    const d = kind === 'start' ? 14 : kind === 'boss' ? 30 : Math.round(between(18, 26));
    if (i > 0) {
      const prev = rooms[i - 1];
      const maxOff = Math.min(prev.w, w) / 2 - 5;
      cx = prev.cx + between(-maxOff, maxOff);
      southEdge = prev.rect.z0 - CORRIDOR_LENGTH;
    }
    const cz = southEdge - d / 2;
    rooms.push({
      i,
      kind,
      cx,
      cz,
      w,
      d,
      rect: { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 },
      pillars: [],
      doorSouthX: null,
      doorNorthX: null,
    });
  });

  assignVariants(rooms, seed);

  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i];
    const b = rooms[i + 1];
    const lo = Math.max(a.rect.x0, b.rect.x0) + CORRIDOR_WIDTH;
    const hi = Math.min(a.rect.x1, b.rect.x1) - CORRIDOR_WIDTH;
    const x = Math.round((lo + (hi - lo) * rand()) * 10) / 10;
    a.doorNorthX = x;
    b.doorSouthX = x;
    corridors.push({
      i,
      x,
      rect: { x0: x - CORRIDOR_WIDTH / 2, x1: x + CORRIDOR_WIDTH / 2, z0: b.rect.z1, z1: a.rect.z0 },
    });
  }

  // Colonne: lontane dai bordi, dalle porte e tra loro.
  for (const room of rooms) {
    const doors: [number, number][] = [];
    if (room.doorSouthX !== null) doors.push([room.doorSouthX, room.rect.z1]);
    if (room.doorNorthX !== null) doors.push([room.doorNorthX, room.rect.z0]);
    if (room.kind === 'boss') {
      const ox = room.w / 2 - 6;
      const oz = room.d / 2 - 6;
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        room.pillars.push({ x: room.cx + sx * ox, z: room.cz + sz * oz, r: 1.3, h: 5.5 });
      }
      continue;
    }
    const want = room.kind === 'start' ? 2 : 2 + Math.floor(rand() * 4);
    for (let tries = 0; tries < 60 && room.pillars.length < want; tries++) {
      const r = between(0.7, 1.4);
      const x = between(room.rect.x0 + 3 + r, room.rect.x1 - 3 - r);
      const z = between(room.rect.z0 + 3 + r, room.rect.z1 - 3 - r);
      const nearDoor = doors.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 5);
      const nearPillar = room.pillars.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 3);
      const nearCenter = (room.kind === 'start' || room.variant === 'tesoro') && Math.hypot(room.cx - x, room.cz - z) < 4;
      if (nearDoor || nearPillar || nearCenter) continue;
      room.pillars.push({ x, z, r, h: between(2.2, 5) });
    }
  }

  return { seed, rooms, corridors };
}

/**
 * Tipi delle stanze, da un seme a parte (così la forma della Frattura non cambia):
 * la prima è sempre normale, al massimo un tesoro, mai due stanze speciali uguali di fila.
 */
function assignVariants(rooms: DRoom[], seed: number) {
  const rand = rng((seed ^ 0x2f6b9e1d) >>> 0);
  let treasure = false;
  let prev: RoomVariant = 'normale';
  rooms
    .filter((r) => r.kind === 'combat')
    .forEach((r, k) => {
      let v: RoomVariant = 'normale';
      if (k > 0) {
        const roll = rand();
        if (roll < 0.2 && !treasure) v = 'tesoro';
        else if (roll < 0.42) v = 'campione';
        else if (roll < 0.62) v = 'trappole';
        else if (roll < 0.8) v = 'prova';
        if (v !== 'normale' && v === prev) v = 'normale';
      }
      if (v === 'tesoro') treasure = true;
      r.variant = v;
      prev = v;
    });
}

// --- Domande sulla geometria -------------------------------------------------------

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x >= r.x0 + margin && x <= r.x1 - margin && z >= r.z0 + margin && z <= r.z1 - margin;
}

/** Indice della stanza che contiene il punto, -1 se è in un corridoio o fuori. */
export function roomAt(d: Dungeon, x: number, z: number, margin = 0): number {
  for (const r of d.rooms) if (inRect(r.rect, x, z, margin)) return r.i;
  return -1;
}

/** true se il punto è sul pavimento (stanza o corridoio) e non dentro una colonna. */
export function walkable(d: Dungeon, x: number, z: number, margin = 0): boolean {
  const room = d.rooms.find((r) => inRect(r.rect, x, z, margin));
  if (room) return !room.pillars.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + margin);
  return d.corridors.some((c) => inRect(c.rect, x, z, margin));
}

/**
 * Dove si riparte per affrontare la stanza `roomIndex` (dopo una sconfitta di
 * gruppo, entrando a metà Frattura o tornando in gioco): nella stanza prima,
 * già sicura, davanti alla porta. Così il gruppo entra quando è pronto.
 */
export function checkpoint(d: Dungeon, roomIndex: number): [number, number, number] {
  const i = Math.min(Math.max(0, roomIndex), d.rooms.length - 1);
  if (i === 0) return [d.rooms[0].cx, 0.2, d.rooms[0].cz + 2];
  const prev = d.rooms[i - 1];
  return [prev.doorNorthX ?? prev.cx, 0.2, prev.rect.z0 + 2.5];
}

/** Punti di comparsa dei nemici: nella metà lontana dall'ingresso, liberi dalle colonne. */
export function spawnPoints(d: Dungeon, roomIndex: number, count: number, rand: () => number): [number, number][] {
  const room = d.rooms[roomIndex];
  const out: [number, number][] = [];
  const southZ = room.rect.z1;
  for (let tries = 0; tries < count * 30 && out.length < count; tries++) {
    const x = room.rect.x0 + 2.5 + rand() * (room.w - 5);
    const z = room.rect.z0 + 2.5 + rand() * (room.d - 5);
    if (southZ - z < 7) continue;
    if (!walkable(d, x, z, 1.2)) continue;
    if (out.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < 1.6)) continue;
    out.push([x, z]);
  }
  while (out.length < count) out.push([room.cx + (rand() - 0.5) * 4, room.rect.z0 + 3 + rand() * 3]);
  return out;
}

export interface WallBox {
  x: number;
  z: number;
  /** semi-dimensioni */
  hx: number;
  hz: number;
}

/** I muri come scatole: servono sia alla fisica sia al disegno. */
export function wallBoxes(d: Dungeon): WallBox[] {
  const t = WALL_THICKNESS / 2;
  const out: WallBox[] = [];
  const hWall = (x0: number, x1: number, z: number) => {
    if (x1 - x0 > 0.05) out.push({ x: (x0 + x1) / 2, z, hx: (x1 - x0) / 2 + t, hz: t });
  };
  const vWall = (z0: number, z1: number, x: number) => {
    if (z1 - z0 > 0.05) out.push({ x, z: (z0 + z1) / 2, hx: t, hz: (z1 - z0) / 2 });
  };
  const half = CORRIDOR_WIDTH / 2;
  for (const r of d.rooms) {
    const { x0, x1, z0, z1 } = r.rect;
    // nord
    if (r.doorNorthX === null) hWall(x0, x1, z0);
    else {
      hWall(x0, r.doorNorthX - half, z0);
      hWall(r.doorNorthX + half, x1, z0);
    }
    // sud
    if (r.doorSouthX === null) hWall(x0, x1, z1);
    else {
      hWall(x0, r.doorSouthX - half, z1);
      hWall(r.doorSouthX + half, x1, z1);
    }
    vWall(z0, z1, x0);
    vWall(z0, z1, x1);
  }
  for (const c of d.corridors) {
    vWall(c.rect.z0, c.rect.z1, c.rect.x0);
    vWall(c.rect.z0, c.rect.z1, c.rect.x1);
  }
  return out;
}
