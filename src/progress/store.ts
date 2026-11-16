// Stato della progressione del giocatore (React lo legge) e salvataggio.
//
// - Con un account: il salvataggio sta su Supabase e segue il giocatore su
//   ogni dispositivo.
// - Da ospite: sta nel browser (localStorage), legato al nome.

import { create } from 'zustand';
import type { ClassId } from '../game/constants';
import { getGame, toast } from '../game/store';
import { supabaseConfig } from '../net/room';
import { currentAccount, loadCloudSave, signIn, signOut, signUp, writeCloudSave } from './cloud';
import { computeMods, emptySave, normalizeSave, type Mods, type PlayerSave } from './model';

export interface AccountState {
  status: 'loading' | 'guest' | 'cloud';
  email?: string;
  userId?: string;
  error?: string;
}

interface ProgressStore {
  account: AccountState;
  save: PlayerSave;
  saving: boolean;
}

export const useProgress = create<ProgressStore>(() => ({
  account: { status: 'loading' },
  save: emptySave(),
  saving: false,
}));

export const getProgress = useProgress.getState;
export const setProgress = useProgress.setState;

const onlineAvailable = () => supabaseConfig() !== null && new URLSearchParams(location.search).get('rete') !== 'locale';

const guestKey = () => `fratture.save.${(getGame().selfName || 'ospite').trim().toLowerCase()}`;

function readGuest(): PlayerSave {
  try {
    const raw = localStorage.getItem(guestKey());
    return raw ? normalizeSave(JSON.parse(raw)) : emptySave();
  } catch {
    return emptySave();
  }
}

function writeGuest(save: PlayerSave) {
  try {
    localStorage.setItem(guestKey(), JSON.stringify(save));
  } catch {
    /* storage pieno o bloccato */
  }
}

// --- salvataggio con un piccolo ritardo -------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function persistNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty) return;
  dirty = false;
  const { account, save } = getProgress();
  if (account.status === 'cloud' && account.userId) {
    setProgress({ saving: true });
    try {
      await writeCloudSave(account.userId, save);
    } catch (e) {
      dirty = true;
      toast(`Salvataggio non riuscito: ${(e as Error).message}`);
    } finally {
      setProgress({ saving: false });
    }
  } else if (account.status === 'guest') {
    writeGuest(save);
  }
}

function persistSoon() {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void persistNow(), 1500);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const { account, save } = getProgress();
    if (account.status === 'guest') writeGuest(save);
    else void persistNow();
  });
}

/** Modifica il salvataggio (su una copia) e lo salva poco dopo. */
export function mutate<T>(fn: (s: PlayerSave) => T): T {
  const s: PlayerSave = JSON.parse(JSON.stringify(getProgress().save));
  const out = fn(s);
  setProgress({ save: s });
  persistSoon();
  return out;
}

export function flushSave() {
  return persistNow();
}

// --- account ----------------------------------------------------------------------

/** All'avvio (e quando cambia il nome dell'ospite) carica il salvataggio giusto. */
export async function initAccount() {
  if (!onlineAvailable()) {
    setProgress({ account: { status: 'guest' }, save: readGuest() });
    return;
  }
  try {
    const acc = await currentAccount();
    if (acc) {
      await useCloud(acc.userId, acc.email);
      return;
    }
  } catch {
    /* rete assente: si gioca da ospite */
  }
  setProgress({ account: { status: 'guest' }, save: readGuest() });
}

async function useCloud(userId: string, email: string) {
  let save = await loadCloudSave(userId);
  if (!save) {
    // primo accesso: porta con sé i progressi fatti da ospite su questo dispositivo
    save = readGuest();
    await writeCloudSave(userId, save);
  }
  setProgress({ account: { status: 'cloud', userId, email }, save });
}

export async function login(email: string, password: string, register: boolean): Promise<string | null> {
  try {
    const acc = register ? await signUp(email, password) : await signIn(email, password);
    await useCloud(acc.userId, acc.email);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function logout() {
  await persistNow();
  await signOut();
  setProgress({ account: { status: 'guest' }, save: readGuest() });
}

/** Il nome dell'ospite è cambiato: il suo salvataggio è un altro. */
export function reloadGuest() {
  if (getProgress().account.status === 'guest') setProgress({ save: readGuest() });
}

// --- modificatori per il combattimento ----------------------------------------------

let modsCache: { save: PlayerSave; cls: ClassId | null; mods: Mods } | null = null;

export function modsFor(cls: ClassId | null): Mods {
  const save = getProgress().save;
  if (!modsCache || modsCache.save !== save || modsCache.cls !== cls) modsCache = { save, cls, mods: computeMods(save, cls) };
  return modsCache.mods;
}
