// Le missioni (tappa 6): obiettivi, avanzamento, ricompense, il capitolo
// della Città Sommersa e le missioni giornaliere di riserva.
//
// Logica pura, senza rete né React: la usa l'host (che conta gli eventi e
// decide quando una missione è compiuta) e la usa la funzione su Supabase
// (`supabase/functions/narratore`) per controllare quello che scrive Claude.
// Le ricompense non le decide mai Claude: si calcolano qui dall'obiettivo.

export type EnemyKind = 'ombra' | 'sciame' | 'riflesso' | 'bruto' | 'velato' | 'eco';

export const SOMMERSA = 'citta-sommersa';
export type WorldId = typeof SOMMERSA;

export type GoalKind = 'uccidi' | 'stanze' | 'boss' | 'fratture' | 'grado' | 'senza-cadute' | 'combo';
export const GOAL_KINDS: GoalKind[] = ['uccidi', 'stanze', 'boss', 'fratture', 'grado', 'senza-cadute', 'combo'];
export const ENEMY_KINDS: EnemyKind[] = ['ombra', 'sciame', 'riflesso', 'bruto', 'velato', 'eco'];

export interface Goal {
  k: GoalKind;
  /** quante volte */
  n: number;
  /** per "uccidi": un tipo di nemico (senza: tutti tranne il boss) */
  nemico?: EnemyKind;
  /** conta solo nelle Fratture di questo mondo */
  mondo?: WorldId;
  /** conta solo dal Grado indicato in su (per "grado" è il Grado da raggiungere) */
  grado?: number;
}

export interface Reward {
  xp: number;
  frammenti: number;
}

export interface Mission {
  id: string;
  tipo: 'storia' | 'giornaliera';
  titolo: string;
  /** cosa dice il narratore quando la missione comincia */
  intro: string[];
  /** cosa dice quando è compiuta (finisce anche nel diario del gruppo) */
  fine: string;
  goal: Goal;
  premio: Reward;
}

/** Cosa succede in partita, dal punto di vista delle missioni. Lo produce l'host. */
export type StoryEvent =
  | { k: 'kill'; nemico: EnemyKind; mondo?: string; grado: number }
  | { k: 'room'; mondo?: string; grado: number }
  | { k: 'close'; mondo?: string; grado: number; wipes: number }
  | { k: 'combo'; mondo?: string; grado: number };

/** Stato delle missioni del gruppo: viaggia nello stato della stanza e si salva con la compagnia. */
export interface StoryState {
  v: 1;
  /** missioni del capitolo già compiute (indice della missione in corso) */
  cap: number;
  /** avanzamento della missione del capitolo in corso */
  capProg: number;
  /** giorno delle giornaliere, AAAA-MM-GG */
  day: string;
  daily: Mission[];
  dailyProg: number[];
  /** chi ha scritto le giornaliere */
  fonte: 'claude' | 'riserva';
}

export const emptyStory = (): StoryState => ({ v: 1, cap: 0, capProg: 0, day: '', daily: [], dailyProg: [], fonte: 'riserva' });

// --- nomi ---------------------------------------------------------------------------------

const ENEMY_NAMES: Record<EnemyKind, [string, string]> = {
  ombra: ['Ombra', 'Ombre'],
  sciame: ['Sciame', 'Sciami'],
  riflesso: ['Riflesso', 'Riflessi'],
  bruto: ['Bruto', 'Bruti'],
  velato: ['Velato', 'Velati'],
  eco: ['Eco della Frattura', 'Echi della Frattura'],
};

const where = (g: Goal) => (g.mondo === SOMMERSA ? ' nella Città Sommersa' : '');
const fromGrado = (g: Goal) => (g.grado && g.k !== 'grado' && g.grado > 1 ? ` (Grado ${g.grado}+)` : '');

/** L'obiettivo in parole, per l'interfaccia. */
export function goalText(g: Goal): string {
  const n = g.n;
  let s: string;
  switch (g.k) {
    case 'uccidi':
      s = g.nemico ? `Sconfiggi ${n} ${ENEMY_NAMES[g.nemico][n === 1 ? 0 : 1]}` : `Sconfiggi ${n} nemici`;
      break;
    case 'stanze':
      s = `Ripulisci ${n} ${n === 1 ? 'stanza' : 'stanze'}`;
      break;
    case 'boss':
      s = n === 1 ? 'Sconfiggi l’Eco della Frattura' : `Sconfiggi ${n} volte l’Eco della Frattura`;
      break;
    case 'fratture':
      s = n === 1 ? 'Richiudi una Frattura' : `Richiudi ${n} Fratture`;
      break;
    case 'grado':
      s = `Richiudi una Frattura di Grado ${g.grado ?? 1} o più`;
      break;
    case 'senza-cadute':
      s = n === 1 ? 'Richiudi una Frattura senza che cadiate tutti' : `Richiudi ${n} Fratture senza che cadiate tutti`;
      break;
    case 'combo':
      s = n === 1 ? 'Riesci in una combo di coppia' : `Riesci in ${n} combo di coppia`;
      break;
  }
  return s + where(g) + fromGrado(g);
}

// --- avanzamento --------------------------------------------------------------------------

/** Quanto un evento fa avanzare un obiettivo (0 o 1). */
export function progressOf(g: Goal, ev: StoryEvent): number {
  if (g.mondo && ev.mondo !== g.mondo) return 0;
  if (g.k !== 'grado' && g.grado && ev.grado < g.grado) return 0;
  switch (g.k) {
    case 'uccidi':
      if (ev.k !== 'kill') return 0;
      if (g.nemico) return ev.nemico === g.nemico ? 1 : 0;
      return ev.nemico === 'eco' ? 0 : 1;
    case 'stanze':
      return ev.k === 'room' ? 1 : 0;
    case 'boss':
      return ev.k === 'kill' && ev.nemico === 'eco' ? 1 : 0;
    case 'fratture':
      return ev.k === 'close' ? 1 : 0;
    case 'grado':
      return ev.k === 'close' && ev.grado >= (g.grado ?? 1) ? 1 : 0;
    case 'senza-cadute':
      return ev.k === 'close' && ev.wipes === 0 ? 1 : 0;
    case 'combo':
      return ev.k === 'combo' ? 1 : 0;
  }
}

/** Missione del capitolo in corso, o null se il capitolo è finito. */
export function currentChapterMission(st: StoryState): Mission | null {
  return CHAPTER[st.cap] ?? null;
}

/**
 * Applica un evento. Restituisce il nuovo stato (lo stesso oggetto se non
 * cambia nulla) e le missioni appena compiute.
 */
export function applyEvent(st: StoryState, ev: StoryEvent): { st: StoryState; done: Mission[] } {
  const done: Mission[] = [];
  let next = st;
  const cur = currentChapterMission(st);
  if (cur) {
    const add = progressOf(cur.goal, ev);
    if (add) {
      const p = st.capProg + add;
      if (p >= cur.goal.n) {
        done.push(cur);
        next = { ...next, cap: st.cap + 1, capProg: 0 };
      } else next = { ...next, capProg: p };
    }
  }
  let prog: number[] | null = null;
  st.daily.forEach((m, i) => {
    const have = st.dailyProg[i] ?? 0;
    if (have >= m.goal.n) return;
    const add = progressOf(m.goal, ev);
    if (!add) return;
    prog ??= [...st.dailyProg];
    prog[i] = Math.min(m.goal.n, have + add);
    if (prog[i] >= m.goal.n) done.push(m);
  });
  if (prog) next = { ...next, dailyProg: prog };
  return { st: next, done };
}

/** Le giornaliere di un nuovo giorno. */
export function withDaily(st: StoryState, day: string, missions: Mission[], fonte: StoryState['fonte']): StoryState {
  return { ...st, day, daily: missions, dailyProg: missions.map(() => 0), fonte };
}

/** true se nessuna giornaliera è ancora avanzata: si possono sostituire con quelle di Claude. */
export function dailyUntouched(st: StoryState): boolean {
  return st.dailyProg.every((p) => p === 0);
}

export function normalizeStory(raw: unknown): StoryState {
  const base = emptyStory();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<StoryState>;
  const daily = Array.isArray(r.daily) ? r.daily.filter(isMission).slice(0, 4) : [];
  return {
    v: 1,
    cap: clampInt(r.cap, 0, CHAPTER.length, 0),
    capProg: clampInt(r.capProg, 0, 999, 0),
    day: typeof r.day === 'string' ? r.day.slice(0, 10) : '',
    daily,
    dailyProg: daily.map((m, i) => clampInt(Array.isArray(r.dailyProg) ? r.dailyProg[i] : 0, 0, m.goal.n, 0)),
    fonte: r.fonte === 'claude' ? 'claude' : 'riserva',
  };
}

function isMission(m: unknown): m is Mission {
  const x = m as Mission;
  return !!x && typeof x.id === 'string' && typeof x.titolo === 'string' && !!x.goal && GOAL_KINDS.includes(x.goal.k) && x.goal.n > 0;
}

// --- ricompense ----------------------------------------------------------------------------

/** Ricompensa di una missione, calcolata dalla difficoltà dell'obiettivo. */
export function rewardFor(g: Goal, tipo: Mission['tipo']): Reward {
  const per: Record<GoalKind, number> = {
    uccidi: g.nemico === 'bruto' ? 30 : g.nemico === 'eco' ? 400 : 14,
    stanze: 70,
    boss: 400,
    fratture: 380,
    grado: 300 + 60 * (g.grado ?? 1),
    'senza-cadute': 480,
    combo: 70,
  };
  const n = g.k === 'grado' ? 1 : g.n;
  const sommersa = g.mondo === SOMMERSA ? 1.25 : 1;
  const gradoMul = g.grado && g.k !== 'grado' ? 1 + 0.1 * (g.grado - 1) : 1;
  const storia = tipo === 'storia' ? 1.5 : 1;
  const xp = Math.round((per[g.k] * n * sommersa * gradoMul * storia) / 10) * 10;
  return { xp, frammenti: Math.max(5, Math.round(xp / 25)) };
}

// --- testi di Claude: controllo ----------------------------------------------------------

/** Limiti degli obiettivi che Claude può proporre (le quantità fuori misura si riportano dentro). */
export const GOAL_LIMITS: Record<GoalKind, [number, number]> = {
  uccidi: [5, 40],
  stanze: [2, 12],
  boss: [1, 3],
  fratture: [1, 3],
  grado: [1, 1],
  'senza-cadute': [1, 2],
  combo: [1, 6],
};

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}

/** Testo pulito: niente tag, niente a capo strani, lunghezza massima. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

/** Forma degli obiettivi come li scrive Claude (vedi lo schema nella funzione). */
export interface RawGoal {
  tipo?: unknown;
  quantita?: unknown;
  nemico?: unknown;
  grado?: unknown;
  mondo?: unknown;
}

export interface RawMission {
  titolo?: unknown;
  intro?: unknown;
  fine?: unknown;
  obiettivo?: RawGoal;
}

/**
 * Controlla un obiettivo scritto da Claude. `best` è il Grado più alto
 * raggiunto dal gruppo: l'obiettivo "grado" non può chiedere troppo di più.
 */
export function sanitizeGoal(raw: RawGoal | undefined, best: number, sommersaOpen: boolean): Goal | null {
  if (!raw || typeof raw !== 'object') return null;
  const k = raw.tipo as GoalKind;
  if (!GOAL_KINDS.includes(k)) return null;
  const [lo, hi] = GOAL_LIMITS[k];
  const g: Goal = { k, n: clampInt(raw.quantita, lo, hi, lo) };
  if (k === 'uccidi' && ENEMY_KINDS.includes(raw.nemico as EnemyKind) && raw.nemico !== 'eco') {
    g.nemico = raw.nemico as EnemyKind;
    // i Bruti e i Velati sono più rari: quantità più piccole
    if (g.nemico === 'bruto') g.n = Math.min(g.n, 8);
    if (g.nemico === 'velato' || g.nemico === 'riflesso') g.n = Math.min(g.n, 20);
  }
  if (raw.mondo === SOMMERSA && sommersaOpen) g.mondo = SOMMERSA;
  const top = Math.max(1, best);
  if (k === 'grado') g.grado = clampInt(raw.grado, Math.max(1, top - 1), top + 1, top);
  else if (typeof raw.grado === 'number' && raw.grado > 1) g.grado = clampInt(raw.grado, 2, top, top);
  return g;
}

/** Controlla le giornaliere scritte da Claude. Restituisce null se non ce n'è una buona. */
export function sanitizeDaily(raw: unknown, day: string, best: number, sommersaOpen: boolean): Mission[] | null {
  const list = (raw as { missioni?: RawMission[] } | null)?.missioni;
  if (!Array.isArray(list)) return null;
  const out: Mission[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    if (out.length >= 3) break;
    const goal = sanitizeGoal(m?.obiettivo, best, sommersaOpen);
    const titolo = cleanText(m?.titolo, 48);
    if (!goal || !titolo) continue;
    const key = `${goal.k}:${goal.nemico ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const intro = cleanText(m?.intro, 260);
    out.push({
      id: `g-${day}-${out.length}`,
      tipo: 'giornaliera',
      titolo,
      intro: intro ? [intro] : [],
      fine: cleanText(m?.fine, 200) || `${titolo}: fatto.`,
      goal,
      premio: rewardFor(goal, 'giornaliera'),
    });
  }
  return out.length ? out : null;
}

/** Battute del Custode scritte da Claude: al massimo tre, brevi. */
export function sanitizeLines(raw: unknown): string[] | null {
  const list = (raw as { righe?: unknown[] } | null)?.righe;
  if (!Array.isArray(list)) return null;
  const out = list.map((l) => cleanText(l, 220)).filter((l) => l.length > 0).slice(0, 3);
  return out.length ? out : null;
}

// --- giorno --------------------------------------------------------------------------------

/** Il giorno di oggi (ora locale), AAAA-MM-GG. */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// --- giornaliere di riserva ---------------------------------------------------------------

interface DailyTemplate {
  titolo: string;
  intro: string;
  fine: string;
  goal: (best: number) => Goal;
}

/** Usate quando Claude non risponde (niente chiave, rete assente, limite raggiunto). */
export const DAILY_POOL: DailyTemplate[] = [
  {
    titolo: 'Caccia alle Ombre',
    intro: 'Le Ombre si sono fatte audaci: stanotte qualcuna ha toccato la pietra del Crocevia. Ricacciatele indietro.',
    fine: 'Le Ombre arretrano. Per stanotte il bordo dell’isola resta vostro.',
    goal: () => ({ k: 'uccidi', n: 20, nemico: 'ombra' }),
  },
  {
    titolo: 'Sciami di passaggio',
    intro: 'Un ronzio corre lungo le crepe. Gli Sciami migrano verso qualcosa: meglio che non arrivino.',
    fine: 'Il ronzio tace. Resta solo il vento del vuoto.',
    goal: () => ({ k: 'uccidi', n: 25, nemico: 'sciame' }),
  },
  {
    titolo: 'Specchi rotti',
    intro: 'I Riflessi sparano con le vostre stesse mosse. Rompeteli prima che imparino le prossime.',
    fine: 'Schegge di vetro scuro, e in ognuna un pezzo di voi. Non guardatele troppo.',
    goal: () => ({ k: 'uccidi', n: 10, nemico: 'riflesso' }),
  },
  {
    titolo: 'Pietra contro pietra',
    intro: 'I Bruti scavano. Ogni loro colpo allarga una Frattura. Fermateli.',
    fine: 'La terra smette di tremare. Per un po’.',
    goal: () => ({ k: 'uccidi', n: 5, nemico: 'bruto' }),
  },
  {
    titolo: 'Ciò che non si vede',
    intro: 'I Velati camminano accanto a voi anche quando credete di essere soli. Trovateli.',
    fine: 'Il velo si strappa. Dietro c’era solo paura, e adesso non c’è più.',
    goal: () => ({ k: 'uccidi', n: 8, nemico: 'velato' }),
  },
  {
    titolo: 'Porte da aprire',
    intro: 'Ogni stanza ripulita è una porta che torna a chiudersi bene. Ne servono parecchie.',
    fine: 'Le porte reggono. Il Custode annuisce, appena.',
    goal: () => ({ k: 'stanze', n: 6 }),
  },
  {
    titolo: 'Insieme',
    intro: 'Le combo di coppia lasciano un segno nell’aria, come una firma. Il Custode vuole vederne.',
    fine: 'Le vostre firme brillano ancora sulle pareti della Frattura.',
    goal: () => ({ k: 'combo', n: 3 }),
  },
  {
    titolo: 'Zittire l’Eco',
    intro: 'L’Eco ha ripetuto una frase tutta la notte. Andate a chiudergli la bocca.',
    fine: 'Silenzio. Anche il silenzio, però, ha la vostra voce.',
    goal: () => ({ k: 'boss', n: 1 }),
  },
  {
    titolo: 'Nessuno a terra',
    intro: 'Una Frattura da richiudere senza cadere tutti insieme. Guardatevi le spalle a vicenda.',
    fine: 'Siete tornati tutti in piedi. Il Custode sembra quasi sollevato.',
    goal: () => ({ k: 'senza-cadute', n: 1 }),
  },
  {
    titolo: 'Più in basso',
    intro: 'Il Grado sale e con lui il buio. Spingetevi fin dove siete già arrivati, e oltre.',
    fine: 'Laggiù il buio aveva un fondo. L’avete toccato.',
    goal: (best) => ({ k: 'grado', n: 1, grado: Math.max(1, best) }),
  },
];

/** Tre giornaliere di riserva per un giorno: sempre le stesse per lo stesso giorno e gruppo. */
export function fallbackDaily(day: string, best: number, salt = ''): Mission[] {
  const h = hash(`${day}|${salt}`);
  const picked: number[] = [];
  for (let i = 0; picked.length < 3 && i < 40; i++) {
    const idx = (h + i * 7 + (h >>> (i % 16))) % DAILY_POOL.length;
    if (!picked.includes(idx)) picked.push(idx);
  }
  return picked.map((idx, i) => {
    const t = DAILY_POOL[idx];
    const goal = t.goal(best);
    return { id: `g-${day}-${i}`, tipo: 'giornaliera', titolo: t.titolo, intro: [t.intro], fine: t.fine, goal, premio: rewardFor(goal, 'giornaliera') };
  });
}

// --- il capitolo della Città Sommersa ------------------------------------------------------

function chapter(id: string, titolo: string, intro: string[], fine: string, goal: Goal): Mission {
  return { id, tipo: 'storia', titolo, intro, fine, goal, premio: rewardFor(goal, 'storia') };
}

/** Atto I: la Città Sommersa. Le missioni contano solo nelle Fratture della Città. */
export const CHAPTER: Mission[] = [
  chapter(
    'cs-1',
    'Il rumore dell’acqua',
    [
      'Il portale della Città Sommersa si è acceso da solo, la notte in cui avete richiuso la vostra prima Frattura.',
      '«Laggiù qualcuno conta i respiri» dice il Custode, senza muovere le labbra. «Andate a contare con lui.»',
    ],
    'Strade allagate, campanili coperti di alghe, finestre che respirano bolle. E in fondo a ogni via, lo stesso numero inciso: quattro.',
    { k: 'stanze', n: 3, mondo: SOMMERSA },
  ),
  chapter(
    'cs-2',
    'Chi conta i respiri',
    ['Le Ombre della Città si muovono a tempo, come se qualcuno battesse il ritmo sott’acqua.', 'Spezzate quel ritmo.'],
    'Quando l’ultima Ombra si scioglie, il conteggio si ferma. Poi riprende, più lento. Qualcuno ha sentito che siete arrivati.',
    { k: 'uccidi', n: 15, nemico: 'ombra', mondo: SOMMERSA },
  ),
  chapter(
    'cs-3',
    'Specchi d’acqua',
    [
      'Nella Città i Riflessi non escono dagli specchi: escono dalle pozzanghere.',
      '«Non guardate il vostro riflesso nell’acqua» dice il Custode. «Non ancora. Non vi riconoscerebbe.»',
    ],
    'In una pozzanghera, per un attimo, vedete quattro figure che vi somigliano. Sono vestite come voi. Sono più vecchie.',
    { k: 'uccidi', n: 8, nemico: 'riflesso', mondo: SOMMERSA },
  ),
  chapter(
    'cs-4',
    'La campana annegata',
    [
      'Al centro della Città c’è un campanile senza campana. Il suono però si sente lo stesso, a ogni respiro che manca.',
      'Attraversate la Città fino in fondo, e tornate tutti.',
    ],
    'La campana suona una volta sola, quando uscite. Sul bordo del campanile c’è inciso un nome. È uno dei vostri.',
    { k: 'senza-cadute', n: 1, mondo: SOMMERSA },
  ),
  chapter(
    'cs-5',
    'La marea dell’Eco',
    [
      'L’Eco della Città parla con l’acqua alla gola. Ripete il conto: uno, due, tre, quattro.',
      '«Quattro siete voi» dice il Custode. «Quattro erano loro. Fermatelo prima che arrivi a cinque.»',
    ],
    'L’Eco affonda contando fino a quattro, poi tace. Nella sua ultima bolla c’è una frase: «Siete tornati. Di nuovo». Il portale della Foresta dei Sussurri, al Crocevia, ha un fremito.',
    { k: 'boss', n: 1, mondo: SOMMERSA, grado: 2 },
  ),
];

/** La Città Sommersa si apre dopo la prima Frattura richiusa dal gruppo. */
export function sommersaOpen(stats: { fratture: number }): boolean {
  return stats.fratture >= 1;
}
