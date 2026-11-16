// Stato dell'interfaccia e della stanza (React lo legge). Le posizioni che
// cambiano a ogni frame NON stanno qui: vivono in oggetti mutabili letti
// dentro useFrame, per non ridisegnare React 60 volte al secondo.

import { create } from 'zustand';
import type { ClassId } from './constants';
import type { Member, RunState } from '../net/roomLogic';

export type Quality = 'bassa' | 'media' | 'alta';
export type LinkKind = 'local' | 'p2p' | 'relay' | 'connecting';

export interface PeerInfo {
  link: LinkKind;
  rtt: number | null;
}

export interface Settings {
  quality: Quality;
  sensitivity: number;
  showStats: boolean;
  touch: 'auto' | 'on' | 'off';
  /** Mira automatica sul nemico più vicino davanti (sul telefono è sempre attiva). */
  autoAim: boolean;
}

export interface Dialog {
  title: string;
  lines: string[];
  index: number;
}

export interface Toast {
  id: number;
  text: string;
}

export interface Ping {
  id: number;
  by: string;
  p: [number, number, number];
  color: string;
  t0: number;
}

export interface Prompt {
  id: string;
  label: string;
}

export type RoomStatus = 'idle' | 'connecting' | 'joined' | 'full' | 'error';

export interface RoomView {
  code: string;
  mode: 'local' | 'online';
  status: RoomStatus;
  error?: string;
  hostId: string | null;
  members: Member[];
  classes: Record<string, ClassId>;
  peers: Record<string, PeerInfo>;
  run: RunState | null;
  grado: number;
  best: number;
}

interface GameStore {
  screen: 'menu' | 'game';
  selfId: string;
  selfName: string;
  room: RoomView;
  settings: Settings;
  classPicker: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  emoteWheel: boolean;
  dialog: Dialog | null;
  prompt: Prompt | null;
  toasts: Toast[];
  pings: Ping[];
  emotes: Record<string, { e: number; t0: number }>;
  pointerLocked: boolean;
  /** Combo di coppia appena riuscita (striscione al centro dello schermo). */
  combo: { name: string; t0: number } | null;
}

const SETTINGS_KEY = 'fratture.settings';
const NAME_KEY = 'fratture.name';

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

function loadSettings(): Settings {
  const defaults: Settings = {
    quality: isTouchDevice() ? 'bassa' : 'media',
    sensitivity: 1,
    showStats: false,
    touch: 'auto',
    autoAim: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage non disponibile */
  }
  return defaults;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export const emptyRoom = (): RoomView => ({
  code: '',
  mode: 'local',
  status: 'idle',
  hostId: null,
  members: [],
  classes: {},
  peers: {},
  run: null,
  grado: 1,
  best: 0,
});

export const useGame = create<GameStore>(() => ({
  screen: 'menu',
  selfId: '',
  selfName: loadName(),
  room: emptyRoom(),
  settings: loadSettings(),
  classPicker: false,
  settingsOpen: false,
  helpOpen: false,
  emoteWheel: false,
  dialog: null,
  prompt: null,
  toasts: [],
  pings: [],
  emotes: {},
  pointerLocked: false,
  combo: null,
}));

export const setGame = useGame.setState;
export const getGame = useGame.getState;

export function patchRoom(patch: Partial<RoomView>) {
  setGame((s) => ({ room: { ...s.room, ...patch } }));
}

export function updateSettings(patch: Partial<Settings>) {
  setGame((s) => {
    const settings = { ...s.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignorato */
    }
    return { settings };
  });
}

export function saveName(name: string) {
  setGame({ selfName: name });
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignorato */
  }
}

let toastSeq = 0;
export function toast(text: string, ms = 3200) {
  const id = ++toastSeq;
  setGame((s) => ({ toasts: [...s.toasts.slice(-3), { id, text }] }));
  setTimeout(() => setGame((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

let pingSeq = 0;
export function addPing(by: string, p: [number, number, number], color: string) {
  const id = ++pingSeq;
  const t0 = performance.now();
  // Un solo ping alla volta per giocatore.
  setGame((s) => ({ pings: [...s.pings.filter((x) => x.by !== by), { id, by, p, color, t0 }] }));
  setTimeout(() => setGame((s) => ({ pings: s.pings.filter((x) => x.id !== id) })), 4000);
}

export function showEmote(playerId: string, e: number) {
  const t0 = performance.now();
  setGame((s) => ({ emotes: { ...s.emotes, [playerId]: { e, t0 } } }));
  setTimeout(() => {
    setGame((s) => {
      if (s.emotes[playerId]?.t0 !== t0) return s;
      const emotes = { ...s.emotes };
      delete emotes[playerId];
      return { emotes };
    });
  }, 2600);
}

export function openDialog(title: string, lines: string[]) {
  setGame({ dialog: { title, lines, index: 0 } });
}

export function advanceDialog() {
  setGame((s) => {
    if (!s.dialog) return s;
    const index = s.dialog.index + 1;
    return { dialog: index >= s.dialog.lines.length ? null : { ...s.dialog, index } };
  });
}

/** True se un menu o un dialogo blocca i controlli del personaggio. */
export function controlsBlocked(): boolean {
  const s = getGame();
  return s.classPicker || s.settingsOpen || s.dialog !== null || s.helpOpen;
}

export function displayName(id: string): string {
  const s = getGame();
  if (id === s.selfId) return s.selfName || 'Tu';
  return s.room.members.find((m) => m.id === id)?.name ?? '???';
}
