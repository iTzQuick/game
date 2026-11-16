// Disposizione del Crocevia e oggetti con cui si può interagire.

import { CLASS_IDS, CLASSES, CUSTODE_LINES, WORLDS, type ClassId } from '../game/constants';
import { displayName, getGame, openDialog, setGame, toast } from '../game/store';
import { getRoom } from '../net/room';
import { emitCombat } from '../combat/bus';
import type { Dungeon } from '../combat/dungeon';

export const ISLAND_RADIUS = 22;
export const PORTAL_RADIUS = 16.5;
export const ALTAR_RADIUS = 7;
export const PILLAR_RADIUS = 11.5;

const polar = (r: number, a: number): [number, number] => [Math.sin(a) * r, Math.cos(a) * r];

/** I portali guardano verso il centro; il primo è a sud (+Z), dietro al punto di partenza. */
export const PORTALS = WORLDS.map((w, i) => {
  const a = (i * Math.PI) / 2;
  const [x, z] = polar(PORTAL_RADIUS, a);
  return { world: w, x, z, angle: a };
});

export const ALTARS = CLASS_IDS.map((cls, i) => {
  const a = Math.PI / 4 + (i * Math.PI) / 2;
  const [x, z] = polar(ALTAR_RADIUS, a);
  return { cls, x, z, angle: a };
});

/** La Frattura: una crepa luminosa sul bordo dell'isola, sempre aperta. */
export const RIFT = { x: Math.sin(Math.PI / 4) * 15.5, z: Math.cos(Math.PI / 4) * 15.5 };

export const PILLARS = Array.from({ length: 8 }, (_, i) => {
  const a = Math.PI / 8 + (i * Math.PI) / 4;
  const [x, z] = polar(PILLAR_RADIUS, a);
  // altezze "rotte" diverse ma uguali per tutti i giocatori
  const h = [3.2, 1.4, 4.1, 2.2, 3.6, 0.9, 2.8, 4.4][i];
  return { x, z, h, fallen: i === 5 };
});

export interface Interactable {
  id: string;
  x: number;
  z: number;
  radius: number;
  label: () => string;
  act: () => void;
}

let custodeTurn = 0;

function classLabel(cls: ClassId): string {
  const s = getGame();
  const holder = Object.entries(s.room.classes).find(([, c]) => c === cls)?.[0];
  const name = CLASSES[cls].name;
  if (holder === s.selfId) return `${name}: è la tua classe`;
  if (holder) return `${name}: scelta da ${displayName(holder)}`;
  return `Scegli la classe: ${name}`;
}

export const INTERACTABLES: Interactable[] = [
  {
    id: 'custode',
    x: 0,
    z: 0,
    radius: 3.8,
    label: () => 'Ascolta il Custode Muto',
    act: () => {
      const lines = CUSTODE_LINES[custodeTurn % CUSTODE_LINES.length];
      custodeTurn++;
      openDialog('Il Custode Muto', lines);
    },
  },
  ...ALTARS.map<Interactable>((a) => ({
    id: `altare-${a.cls}`,
    x: a.x,
    z: a.z,
    radius: 2.3,
    label: () => classLabel(a.cls),
    act: () => {
      const s = getGame();
      const holder = Object.entries(s.room.classes).find(([, c]) => c === a.cls)?.[0];
      if (holder && holder !== s.selfId) {
        setGame({ classPicker: true });
        return;
      }
      getRoom()?.requestClass(a.cls);
    },
  })),
  {
    id: 'frattura',
    x: RIFT.x,
    z: RIFT.z,
    radius: 3.4,
    label: () => {
      const s = getGame();
      if (s.room.run?.phase === 'countdown') return 'La Frattura si sta aprendo…';
      return `Entra nella Frattura · Grado ${s.room.grado}`;
    },
    act: () => {
      const s = getGame();
      if (s.room.run) return;
      if (!s.room.classes[s.selfId]) {
        toast('Scegli prima una classe');
        setGame({ classPicker: true });
        return;
      }
      runRequest('start');
    },
  },
  ...PORTALS.map<Interactable>((p) => ({
    id: `portale-${p.world.id}`,
    x: Math.sin(p.angle) * (PORTAL_RADIUS - 1.2),
    z: Math.cos(p.angle) * (PORTAL_RADIUS - 1.2),
    radius: 3.4,
    label: () => `Portale spento: ${p.world.name}`,
    act: () => openDialog(p.world.name, [p.world.whisper, 'Il portale è spento. Per ora.']),
  })),
];

/** Chiede all'host di aprire, lasciare o abbandonare la Frattura. */
export function runRequest(a: 'start' | 'leave' | 'abandon') {
  const room = getRoom();
  if (room?.hostId) emitCombat({ t: 'runreq', a }, { to: room.hostId });
}

/** Cose con cui interagire dentro la Frattura (per ora: il portale d'uscita dopo il boss). */
export function fratturaInteractables(d: Dungeon, complete: boolean): Interactable[] {
  if (!complete) return [];
  const boss = d.rooms[d.rooms.length - 1];
  return [
    {
      id: 'uscita',
      x: boss.cx,
      z: boss.rect.z0 + 4,
      radius: 3,
      label: () => 'Torna al Crocevia',
      act: () => runRequest('leave'),
    },
  ];
}

export function nearestInteractable(x: number, z: number, list: Interactable[] = INTERACTABLES): Interactable | null {
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const it of list) {
    const d = Math.hypot(it.x - x, it.z - z);
    if (d < it.radius && d < bestD) {
      best = it;
      bestD = d;
    }
  }
  return best;
}

/** Numeri pseudo-casuali ripetibili: tutti i giocatori vedono la stessa isola. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
