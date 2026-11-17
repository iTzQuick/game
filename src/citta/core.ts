// La Città Sommersa (tappa 6, Atto I): regole pure, si testano da sole.
// Ossigeno e colonne di bolle, le missioni della storia, il frammento di
// verità e il voto della compagnia.

import { rng } from '../combat/defs';
import { inRect, walkable, type Dungeon } from '../combat/dungeon';
import type { Missione } from '../narrator/core';

export const CITTA = 'citta-sommersa' as const;
export type Mondo = typeof CITTA;

/** Il portale della Città si accende quando la compagnia ha richiuso la prima Frattura. */
export const cittaAperta = (stats: { fratture: number }) => stats.fratture >= 1;

// --- Ossigeno ---------------------------------------------------------------------

export const OSSIGENO = {
  max: 100,
  /** calo al secondo durante la Frattura (da pieno a vuoto in poco più di un minuto) */
  calo: 1.5,
  /** ricarica al secondo dentro una colonna di bolle */
  ricarica: 45,
  /** raggio di una colonna di bolle */
  raggio: 1.8,
  /** senza ossigeno: frazione della vita persa al secondo */
  danno: 0.06,
  /** sotto questa soglia l'interfaccia avvisa */
  avviso: 30,
};

/** Un passo dell'ossigeno di un giocatore: quanto ne resta e quanta vita perde. */
export function passoOssigeno(o: number, dt: number, inBolle: boolean, maxHp: number): { o: number; danno: number } {
  if (inBolle) return { o: Math.min(OSSIGENO.max, o + OSSIGENO.ricarica * dt), danno: 0 };
  const next = Math.max(0, o - OSSIGENO.calo * dt);
  return { o: next, danno: next <= 0 ? maxHp * OSSIGENO.danno * dt : 0 };
}

export interface Colonna {
  x: number;
  z: number;
  room: number;
}

/**
 * Le colonne di bolle della Frattura: una nella stanza d'ingresso, due nelle
 * stanze di combattimento, tre in quella del boss. Dal seme: uguali per tutti.
 */
export function colonneBolle(d: Dungeon): Colonna[] {
  const rand = rng(d.seed ^ 0x0b011e);
  const out: Colonna[] = [];
  for (const r of d.rooms) {
    const want = r.kind === 'start' ? 1 : r.kind === 'boss' ? 3 : 2;
    let placed = 0;
    for (let tries = 0; tries < 80 && placed < want; tries++) {
      const x = r.rect.x0 + 3 + rand() * (r.w - 6);
      const z = r.rect.z0 + 3 + rand() * (r.d - 6);
      if (!walkable(d, x, z, 2.2)) continue;
      if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 7)) continue;
      out.push({ x, z, room: r.i });
      placed++;
    }
    if (!placed) out.push({ x: r.cx, z: r.cz, room: r.i });
  }
  return out;
}

export function inColonna(colonne: Colonna[], x: number, z: number): boolean {
  return colonne.some((c) => Math.hypot(c.x - x, c.z - z) <= OSSIGENO.raggio);
}

/** La colonna più vicina (per la freccia quando l'ossigeno sta finendo). */
export function colonnaVicina(d: Dungeon, colonne: Colonna[], x: number, z: number): Colonna | null {
  let best: Colonna | null = null;
  let bd = Infinity;
  for (const c of colonne) {
    const room = d.rooms[c.room];
    if (!inRect(room.rect, x, z, 6)) continue;
    const dd = Math.hypot(c.x - x, c.z - z);
    if (dd < bd) {
      bd = dd;
      best = c;
    }
  }
  return best;
}

// --- Atto I: la storia ------------------------------------------------------------------

export interface Capitolo extends Missione {
  /** ciò che il narratore racconta a missione compiuta */
  fine: string[];
  /** chi aspetta in fondo alla Frattura */
  boss: 'eco' | 'campana';
}

export const ATTO1: Capitolo[] = [
  {
    id: 'atto1-1',
    titolo: 'Il rumore dell’acqua',
    racconto:
      'Il portale della Città Sommersa si è acceso da solo, la notte in cui avete richiuso la vostra prima Frattura. Laggiù l’aria finisce in fretta: restate vicini alle colonne di bolle per respirare.',
    obiettivo: { tipo: 'boss' },
    modificatori: [],
    nemico: 'annegato',
    boss: 'eco',
    fine: [
      'Strade allagate, campanili coperti d’alghe, finestre che respirano bolle.',
      '«Laggiù qualcuno conta i respiri» dice il Custode, senza muovere le labbra. «Adesso conta anche i vostri.»',
    ],
  },
  {
    id: 'atto1-2',
    titolo: 'Quelli che non risalgono',
    racconto:
      'Gli Annegati camminano sul fondo come se tornassero a casa da un turno di pesca durato troppo. Quando vi afferrano, vi rubano il fiato.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'annegato', quanti: 8 },
    modificatori: [],
    nemico: 'annegato',
    boss: 'eco',
    fine: [
      'L’ultimo Annegato si ferma e alza gli occhi verso la superficie, lontanissima.',
      'Sul suo polso, sotto le alghe, c’è un segno spento. Uguale al vostro.',
    ],
  },
  {
    id: 'atto1-3',
    titolo: 'Respiri contati',
    racconto:
      'La marea della Città sale a ogni rintocco che nessuno sente. Attraversatela prima che il conto finisca: non c’è tempo per fermarsi a guardare.',
    obiettivo: { tipo: 'veloce', minuti: 12 },
    modificatori: [],
    nemico: null,
    boss: 'eco',
    fine: [
      'Arrivate in fondo senza fiato. Per un attimo, il conto si ferma.',
      'Poi una voce, sott’acqua, riprende da dove eravate rimasti: «…quattro».',
    ],
  },
  {
    id: 'atto1-4',
    titolo: 'Ombre che nuotano',
    racconto:
      'Le Anguille d’ombra girano attorno al campanile più alto della Città. Scattano all’improvviso, in linea retta: spostatevi di lato, non indietro.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'anguilla', quanti: 8 },
    modificatori: ['veloci'],
    nemico: 'anguilla',
    boss: 'eco',
    fine: [
      'Senza le anguille, il campanile resta in silenzio. Dentro non c’è nessuna campana.',
      '«È scesa più giù» dice il Custode. «E vi sta aspettando.»',
    ],
  },
  {
    id: 'atto1-5',
    titolo: 'La Campana',
    racconto:
      'In fondo alla Città c’è una campana enorme che suona da sola. A ogni rintocco l’acqua trema e l’aria vi scappa dai polmoni. Fatela tacere.',
    obiettivo: { tipo: 'boss' },
    modificatori: [],
    nemico: 'annegato',
    boss: 'campana',
    fine: ['La Campana si inclina, rintocca un’ultima volta e tace.', 'Dentro il bronzo, qualcosa brilla.'],
  },
];

export const capitoloAtto = (id: string) => ATTO1.find((c) => c.id === id);

export interface ProgressoAtto {
  /** missioni della storia compiute (in ordine) */
  fatte: number;
  /** scelta della compagnia dopo la Campana (indice in VOTO.opzioni) */
  scelta: 0 | 1 | null;
}

export const progressoVuoto = (): ProgressoAtto => ({ fatte: 0, scelta: null });

export function normalizzaAtto(raw: unknown): ProgressoAtto {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fatte = typeof r.fatte === 'number' && Number.isFinite(r.fatte) ? Math.max(0, Math.min(ATTO1.length, Math.floor(r.fatte))) : 0;
  const scelta = r.scelta === 0 || r.scelta === 1 ? r.scelta : null;
  return { fatte, scelta };
}

/** Si può giocare la prossima missione, o rigiocare quelle già fatte. */
export function puoPartire(id: string, p: ProgressoAtto): boolean {
  const i = ATTO1.findIndex((c) => c.id === id);
  return i >= 0 && i <= p.fatte;
}

/** Compiuta per la prima volta: la storia va avanti. */
export function avanzaAtto(p: ProgressoAtto, id: string): ProgressoAtto {
  const i = ATTO1.findIndex((c) => c.id === id);
  return i === p.fatte ? { ...p, fatte: p.fatte + 1 } : p;
}

// --- Il frammento di verità e il voto ---------------------------------------------------------

export const VERITA = {
  titolo: 'Il nome nel bronzo',
  testo: [
    'Dentro la Campana, inciso nel bronzo, c’è un segno uguale a quelli sui vostri polsi. Accanto, quattro nomi graffiati e poi cancellati.',
    'Sotto, una riga che non è stata cancellata: «Suonerà quando torneranno. Noi non ci saremo più».',
    'La Campana non chiamava aiuto. Chiamava voi.',
  ],
};

export const VOTO = {
  domanda: 'La Campana ora tace. Cosa ne fa la compagnia?',
  opzioni: [
    {
      titolo: 'Portarla al Crocevia',
      desc: 'Suonerà per chi si è perso nelle Fratture. Ma chiamerà anche chi non vogliamo trovare.',
    },
    {
      titolo: 'Lasciarla al fondo',
      desc: 'Nessuno verrà più chiamato. Nemmeno chi aspettava solo quel suono per tornare.',
    },
  ],
} as const;

/** Il voto della compagnia, nello stato della stanza (lo tiene l'host). */
export interface Voto {
  id: 'atto1';
  aperto: boolean;
  /** voti per giocatore: indice dell'opzione */
  voti: Record<string, 0 | 1>;
  /** fine del voto (Date.now dell'host) */
  scade: number;
  esito: 0 | 1 | null;
}

/** Quanto resta aperto il voto (ms) se qualcuno non vota. */
export const TEMPO_VOTO = 90_000;

/**
 * Esito del voto: vince la maggioranza; in parità decide il primo della
 * stanza che ha votato (l'ordine d'ingresso, quindi di solito l'host).
 */
export function esitoVoto(voti: Record<string, 0 | 1>, ordine: string[]): 0 | 1 {
  let a = 0;
  let b = 0;
  for (const v of Object.values(voti)) v === 0 ? a++ : b++;
  if (a !== b) return a > b ? 0 : 1;
  for (const id of ordine) if (voti[id] === 0 || voti[id] === 1) return voti[id];
  return 0;
}
