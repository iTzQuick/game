// Il narratore (tappa 6): missioni del giorno, battute del Custode e dell'Eco,
// indizi della Biblioteca. Questo file è puro e SENZA import: lo usano sia il
// gioco sia la funzione di Supabase (scripts/narratore-funzione.mjs lo copia
// dentro supabase/functions/narratore/index.ts).
//
// Claude sceglie i pezzi da elenchi chiusi; i numeri veri (quanti nemici,
// ricompense) li decide sempre il gioco, e tutto ciò che arriva da fuori passa
// dalle funzioni `valida…`.

// --- Pezzi con cui si compone una missione --------------------------------------

/** Nemici comuni (il boss, l'Eco, c'è sempre alla fine). Uguali a ENEMY_TYPES di combat/defs.ts. */
export const NEMICI = ['ombra', 'sciame', 'riflesso', 'bruto', 'velato'] as const;
export type NemicoMissione = (typeof NEMICI)[number];

/** Uguali a MOD_IDS di combat/defs.ts (lo controlla un test). */
export const MODIFICATORI = ['veloci', 'senza-cure', 'pesanti', 'velati', 'frenesia'] as const;
export type ModMissione = (typeof MODIFICATORI)[number];

export const OBIETTIVI = ['sconfiggi', 'nessuno_cade', 'senza_pozioni', 'veloce', 'boss'] as const;
export type TipoObiettivo = (typeof OBIETTIVI)[number];

export type Obiettivo =
  | { tipo: 'sconfiggi'; nemico: NemicoMissione; quanti: number }
  | { tipo: 'nessuno_cade' }
  | { tipo: 'senza_pozioni' }
  | { tipo: 'veloce'; minuti: number }
  | { tipo: 'boss' };

export interface Missione {
  /** `<giorno>-<1|2|3>`: la posizione nella giornata, così una missione fatta resta fatta. */
  id: string;
  titolo: string;
  racconto: string;
  obiettivo: Obiettivo;
  modificatori: ModMissione[];
  /** nemico che compare più spesso nella Frattura (null: i soliti) */
  nemico: NemicoMissione | null;
}

export type Fonte = 'claude' | 'riserva';

/** Quello che il narratore prepara per una compagnia, una volta al giorno. */
export interface Narrazione {
  giorno: string;
  missioni: Missione[];
  /** battute del Custode Muto: [gesto, voce] */
  custode: [string, string][];
  /** frasi dell'Eco quando la Frattura si apre */
  eco: string[];
  fonte: Fonte;
}

/** Un indizio della Biblioteca, scritto quando la compagnia raggiunge un nuovo record. */
export interface Indizio {
  grado: number;
  titolo: string;
  testo: string;
}

export const MISSIONI_AL_GIORNO = 3;

// Limiti per i numeri: Claude propone, il gioco tiene dentro questi margini.
export const LIMITI = {
  titolo: 60,
  racconto: 420,
  battuta: 220,
  eco: 140,
  indizioTitolo: 50,
  indizioTesto: 520,
  /** quanti nemici da sconfiggere, per tipo */
  quanti: { ombra: [5, 14], sciame: [8, 20], riflesso: [4, 10], bruto: [2, 5], velato: [4, 10] } as Record<NemicoMissione, [number, number]>,
  minuti: [5, 15] as [number, number],
};

const NOMI: Record<NemicoMissione, [string, string]> = {
  ombra: ['Ombra', 'Ombre'],
  sciame: ['Sciame', 'Sciami'],
  riflesso: ['Riflesso', 'Riflessi'],
  bruto: ['Bruto', 'Bruti'],
  velato: ['Velato', 'Velati'],
};

export const nomeNemico = (n: NemicoMissione, plurale = false) => NOMI[n][plurale ? 1 : 0];

/** La regola della missione in parole semplici (la scrive il gioco, non Claude). */
export function testoObiettivo(o: Obiettivo): string {
  switch (o.tipo) {
    case 'sconfiggi':
      return `Sconfiggete ${o.quanti} ${nomeNemico(o.nemico, o.quanti !== 1)} e richiudete la Frattura`;
    case 'nessuno_cade':
      return 'Richiudete la Frattura senza che nessuno cada a terra';
    case 'senza_pozioni':
      return 'Richiudete la Frattura senza bere pozioni';
    case 'veloce':
      return `Richiudete la Frattura in meno di ${o.minuti} minuti`;
    case 'boss':
      return 'Richiudete la Frattura';
  }
}

/** Quanto è difficile, da 0 a 4: decide la ricompensa. */
export function difficolta(m: Pick<Missione, 'obiettivo' | 'modificatori'>): number {
  const base = { sconfiggi: 1, nessuno_cade: 2, senza_pozioni: 1, veloce: 2, boss: 0 }[m.obiettivo.tipo];
  return Math.min(4, base + m.modificatori.length);
}

/** Lo stato di una missione durante la Frattura (vedi MissioneInCorso in net/roomLogic.ts). */
export interface Avanzamento {
  obiettivo: Obiettivo;
  conta: number;
  fallita: boolean;
  inizio: number;
}

/** A Frattura richiusa: la missione è compiuta? */
export function missioneCompiuta(m: Avanzamento, adesso: number): boolean {
  if (m.fallita) return false;
  switch (m.obiettivo.tipo) {
    case 'sconfiggi':
      return m.conta >= m.obiettivo.quanti;
    case 'veloce':
      return m.inizio > 0 && adesso - m.inizio <= m.obiettivo.minuti * 60_000;
    default:
      return true;
  }
}

/** Ancora in tempo? (obiettivo "veloce"): secondi rimasti, oppure null. */
export function secondiRimasti(m: Avanzamento, adesso: number): number | null {
  if (m.obiettivo.tipo !== 'veloce' || !m.inizio) return null;
  return Math.max(0, Math.ceil((m.inizio + m.obiettivo.minuti * 60_000 - adesso) / 1000));
}

// --- Il giorno ------------------------------------------------------------------------

/** Data di oggi a Roma (AAAA-MM-GG): le missioni cambiano a mezzanotte italiana. */
export function giornoRoma(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function semeDi(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function casuale(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Validazione di ciò che arriva da fuori ---------------------------------------------

/** Testo pulito: niente caratteri di controllo né markup, spazi normali, lunghezza massima. */
export function pulisci(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('» '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = stop > max * 0.6 ? cut.slice(0, stop + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
  }
  return s;
}

const tra = (v: unknown, [lo, hi]: [number, number], dflt: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
};

const unoDi = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

function validaObiettivo(o: unknown): Obiettivo | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  switch (unoDi(OBIETTIVI, r.tipo)) {
    case 'sconfiggi': {
      const nemico = unoDi(NEMICI, r.nemico);
      if (!nemico) return null;
      const lim = LIMITI.quanti[nemico];
      return { tipo: 'sconfiggi', nemico, quanti: tra(r.quanti, lim, lim[0]) };
    }
    case 'veloce':
      return { tipo: 'veloce', minuti: tra(r.minuti, LIMITI.minuti, 10) };
    case 'nessuno_cade':
      return { tipo: 'nessuno_cade' };
    case 'senza_pozioni':
      return { tipo: 'senza_pozioni' };
    case 'boss':
      return { tipo: 'boss' };
    default:
      return null;
  }
}

/** Una missione già nel formato del gioco (arriva dalla funzione o dallo stato della stanza). */
export function validaMissione(raw: unknown, id: string): Missione | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const titolo = pulisci(r.titolo, LIMITI.titolo);
  const racconto = pulisci(r.racconto, LIMITI.racconto);
  const obiettivo = validaObiettivo(r.obiettivo);
  if (!titolo || !racconto || !obiettivo) return null;
  const mods: ModMissione[] = [];
  for (const m of Array.isArray(r.modificatori) ? r.modificatori : []) {
    const id2 = unoDi(MODIFICATORI, m);
    if (id2 && !mods.includes(id2) && mods.length < 2) mods.push(id2);
  }
  // l'obiettivo "uccidi i Bruti" porta i Bruti nella Frattura
  const nemico = obiettivo.tipo === 'sconfiggi' ? obiettivo.nemico : unoDi(NEMICI, r.nemico);
  return { id, titolo, racconto, obiettivo, modificatori: mods, nemico };
}

export function validaNarrazione(raw: unknown): Narrazione | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const giorno = typeof r.giorno === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.giorno) ? r.giorno : null;
  if (!giorno) return null;
  const lista = Array.isArray(r.missioni) ? r.missioni : [];
  const missioni: Missione[] = [];
  for (let i = 0; i < lista.length && missioni.length < MISSIONI_AL_GIORNO; i++) {
    const m = validaMissione(lista[i], `${giorno}-${missioni.length + 1}`);
    if (m) missioni.push(m);
  }
  if (!missioni.length) return null;
  return {
    giorno,
    missioni,
    custode: validaBattute(r.custode),
    eco: validaEco(r.eco),
    fonte: r.fonte === 'claude' ? 'claude' : 'riserva',
  };
}

export function validaBattute(raw: unknown): [string, string][] {
  const out: [string, string][] = [];
  for (const b of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    const pair = Array.isArray(b) ? b : b && typeof b === 'object' ? [(b as Record<string, unknown>).gesto, (b as Record<string, unknown>).voce] : [];
    const gesto = pulisci(pair[0], LIMITI.battuta);
    const voce = pulisci(pair[1], LIMITI.battuta);
    if (gesto && voce) out.push([gesto, voce]);
  }
  return out;
}

export function validaEco(raw: unknown): string[] {
  const out: string[] = [];
  for (const e of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    const s = pulisci(e, LIMITI.eco);
    if (s) out.push(s);
  }
  return out;
}

export function validaIndizio(raw: unknown): Indizio | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const titolo = pulisci(r.titolo, LIMITI.indizioTitolo);
  const testo = pulisci(r.testo, LIMITI.indizioTesto);
  const grado = typeof r.grado === 'number' && Number.isInteger(r.grado) && r.grado >= 1 && r.grado < 1000 ? r.grado : 0;
  return titolo && testo && grado ? { grado, titolo, testo } : null;
}

// --- Il formato in cui risponde Claude (JSON Schema degli output strutturati) -----------

/**
 * Lo schema è piatto e senza limiti numerici (non supportati): i numeri e le
 * lunghezze li sistema `daRispostaMissioni`.
 */
export const SCHEMA_MISSIONI = {
  type: 'object',
  properties: {
    missioni: {
      type: 'array',
      description: `Esattamente ${MISSIONI_AL_GIORNO} missioni, con obiettivi diversi tra loro.`,
      items: {
        type: 'object',
        properties: {
          titolo: { type: 'string', description: 'Al massimo 6 parole.' },
          racconto: { type: 'string', description: 'Da 2 a 4 frasi, al massimo 400 caratteri.' },
          obiettivo: { type: 'string', enum: [...OBIETTIVI] },
          nemico_obiettivo: {
            type: 'string',
            enum: [...NEMICI, 'nessuno'],
            description: 'Solo per l’obiettivo "sconfiggi": quale nemico. Altrimenti "nessuno".',
          },
          quanti: { type: 'integer', description: 'Solo per "sconfiggi": quanti nemici. Altrimenti 0.' },
          minuti: { type: 'integer', description: 'Solo per "veloce": il tempo limite in minuti. Altrimenti 0.' },
          modificatori: { type: 'array', items: { type: 'string', enum: [...MODIFICATORI] }, description: 'Da 0 a 2.' },
          nemico_frequente: { type: 'string', enum: [...NEMICI, 'nessuno'] },
        },
        required: ['titolo', 'racconto', 'obiettivo', 'nemico_obiettivo', 'quanti', 'minuti', 'modificatori', 'nemico_frequente'],
        additionalProperties: false,
      },
    },
  },
  required: ['missioni'],
  additionalProperties: false,
} as const;

export const SCHEMA_DIALOGHI = {
  type: 'object',
  properties: {
    custode: {
      type: 'array',
      description: 'Esattamente 4 battute del Custode Muto.',
      items: {
        type: 'object',
        properties: {
          gesto: { type: 'string', description: 'Cosa fa il Custode, in terza persona. Una frase.' },
          voce: { type: 'string', description: 'Ciò che la sua voce dice dentro la testa, tra « ». Una o due frasi.' },
        },
        required: ['gesto', 'voce'],
        additionalProperties: false,
      },
    },
    eco: { type: 'array', items: { type: 'string' }, description: 'Esattamente 5 frasi brevi dell’Eco, tra « ».' },
  },
  required: ['custode', 'eco'],
  additionalProperties: false,
} as const;

export const SCHEMA_INDIZIO = {
  type: 'object',
  properties: {
    titolo: { type: 'string', description: 'Al massimo 5 parole.' },
    testo: { type: 'string', description: 'Da 2 a 4 frasi, al massimo 480 caratteri.' },
  },
  required: ['titolo', 'testo'],
  additionalProperties: false,
} as const;

/** Dalla risposta di Claude (formato piatto) alle missioni del gioco. */
export function daRispostaMissioni(raw: unknown, giorno: string): Missione[] {
  const lista = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).missioni) ? ((raw as Record<string, unknown>).missioni as unknown[]) : [];
  const out: Missione[] = [];
  const tipi = new Set<string>();
  for (const item of lista) {
    if (out.length >= MISSIONI_AL_GIORNO || !item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const m = validaMissione(
      {
        titolo: r.titolo,
        racconto: r.racconto,
        obiettivo: { tipo: r.obiettivo, nemico: r.nemico_obiettivo, quanti: r.quanti, minuti: r.minuti },
        modificatori: r.modificatori,
        nemico: r.nemico_frequente,
      },
      `${giorno}-${out.length + 1}`,
    );
    // tre obiettivi diversi: un doppione si scarta
    if (m && !tipi.has(m.obiettivo.tipo)) {
      tipi.add(m.obiettivo.tipo);
      out.push(m);
    }
  }
  return out;
}

// --- Contenuti di riserva (senza Claude: ospiti, compagnie locali, rete assente) ---------

type Modello = Omit<Missione, 'id'>;

export const MISSIONI_RISERVA: Modello[] = [
  {
    titolo: 'La mandria di pietra',
    racconto: 'Qualcosa di pesante cammina nelle stanze della Frattura e le crepe si allargano a ogni passo. Il Custode vuole che quei passi si fermino prima che arrivino al Crocevia.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'bruto', quanti: 3 },
    modificatori: [],
    nemico: 'bruto',
  },
  {
    titolo: 'Specchi che sparano',
    racconto: 'I Riflessi hanno imparato a mirare. Ognuno porta il volto di qualcuno di voi, ma un attimo in ritardo. Rompeteli prima che imparino anche a parlare.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'riflesso', quanti: 6 },
    modificatori: [],
    nemico: 'riflesso',
  },
  {
    titolo: 'Il nido',
    racconto: 'Uno Sciame si è fatto il nido nella Frattura di oggi. Il ronzio arriva fino al Crocevia e copre perfino la voce del Custode.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'sciame', quanti: 12 },
    modificatori: ['veloci'],
    nemico: 'sciame',
  },
  {
    titolo: 'Nessuno resta indietro',
    racconto: 'L’Eco conta chi cade. Ogni volta che uno di voi tocca terra, la sua voce diventa un po’ più vostra. Oggi non dategli niente da contare.',
    obiettivo: { tipo: 'nessuno_cade' },
    modificatori: [],
    nemico: null,
  },
  {
    titolo: 'Sete',
    racconto: 'Il giardino del Crocevia ha bisogno di riposo. Oggi le pozioni restano nelle tasche: si combatte con quello che si ha.',
    obiettivo: { tipo: 'senza_pozioni' },
    modificatori: [],
    nemico: 'ombra',
  },
  {
    titolo: 'Prima che si chiuda da sola',
    racconto: 'Questa Frattura respira in fretta: tra poco si richiuderà con dentro qualcosa che vi appartiene. Arrivate dall’Eco prima di lei.',
    obiettivo: { tipo: 'veloce', minuti: 10 },
    modificatori: [],
    nemico: null,
  },
  {
    titolo: 'La nebbia dei veli',
    racconto: 'I Velati si muovono dove la luce non arriva. Il Custode chiede di stanarli uno per uno: la Rivelazione sarà la vostra lanterna.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'velato', quanti: 6 },
    modificatori: ['velati'],
    nemico: 'velato',
  },
  {
    titolo: 'Colpi che pesano',
    racconto: 'Oggi ogni colpo nemico arriva come una porta che sbatte. Il Custode dice che la Frattura vuole vedere se sapete restare in piedi.',
    obiettivo: { tipo: 'nessuno_cade' },
    modificatori: ['pesanti'],
    nemico: 'ombra',
  },
  {
    titolo: 'Le Ombre in fila',
    racconto: 'Le Ombre di oggi marciano in ordine, come soldati che ricordano una guerra. Spezzate la fila prima che arrivi in fondo.',
    obiettivo: { tipo: 'sconfiggi', nemico: 'ombra', quanti: 8 },
    modificatori: ['frenesia'],
    nemico: 'ombra',
  },
  {
    titolo: 'Una porta in più',
    racconto: 'Una crepa nuova si è aperta senza preavviso. Non c’è nessuna richiesta particolare: entrate, trovate l’Eco e richiudete tutto.',
    obiettivo: { tipo: 'boss' },
    modificatori: [],
    nemico: null,
  },
];

export const CUSTODE_RISERVA: [string, string][] = [
  ['Il Custode Muto non apre la bocca. Eppure la sua voce ti arriva da dentro.', '«Vi siete svegliati senza ricordi. È giusto così. I ricordi pesano, e il vuoto è profondo.»'],
  ['Il Custode solleva una mano verso i portali spenti.', '«Una notte si sono spezzati tutti insieme. Non è stato un caso. Non lo è mai.»'],
  ['Lo sguardo del Custode si ferma sul segno che brilla sul tuo polso.', '«Quella luce non è una ferita. È una serratura che aspetta… o una chiave. Lo capirete.»'],
  ['Per un attimo, dietro il Custode, ti sembra di sentire la tua stessa voce.', 'Il Custode scuote la testa, lentamente. «Non ascoltate l’Eco. Non ancora.»'],
];

export const ECO_RISERVA: string[] = [
  '«Bentornati. Vi ho tenuto il posto.»',
  '«Io ricordo quello che voi avete dimenticato.»',
  '«Ogni porta che chiudete, io la riapro.»',
  '«Sento i vostri passi. Sono i miei.»',
  '«Avete paura di me, o di quello che vi dirò?»',
];

/** Le missioni di riserva del giorno: uguali per tutti i membri della compagnia. */
export function missioniRiserva(giorno: string, gruppo: string): Missione[] {
  const rand = casuale(semeDi(`${giorno}|${gruppo}`));
  const pool = [...MISSIONI_RISERVA];
  const out: Missione[] = [];
  const tipi = new Set<string>();
  while (out.length < MISSIONI_AL_GIORNO && pool.length) {
    const m = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    if (tipi.has(m.obiettivo.tipo)) continue;
    tipi.add(m.obiettivo.tipo);
    out.push({ ...m, id: `${giorno}-${out.length + 1}` });
  }
  return out;
}

export function narrazioneRiserva(giorno: string, gruppo: string): Narrazione {
  return { giorno, missioni: missioniRiserva(giorno, gruppo), custode: CUSTODE_RISERVA, eco: ECO_RISERVA, fonte: 'riserva' };
}
