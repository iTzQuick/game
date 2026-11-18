// Dati di gioco condivisi. I valori di bilanciamento sono provvisori: il
// documento di design dice che si tarano nei test.

export type ClassId = 'guardiano' | 'lama' | 'tessitore' | 'custode';

export interface ClassInfo {
  id: ClassId;
  name: string;
  role: string;
  /** Colore principale dell'outfit: saturo, in contrasto con il mondo cupo. */
  color: string;
  accent: string;
  icon: string;
  abilities: [string, string, string];
  ultra: string;
  ranged: boolean;
}

export const CLASSES: Record<ClassId, ClassInfo> = {
  guardiano: {
    id: 'guardiano',
    name: 'Guardiano',
    role: 'Difesa, corpo a corpo',
    color: '#3f8cff',
    accent: '#ffd25a',
    icon: '🛡️',
    abilities: ['Colpo di scudo', 'Provocazione', 'Barriera'],
    ultra: 'Bastione',
    ranged: false,
  },
  lama: {
    id: 'lama',
    name: "Lama d'Ombra",
    role: 'Danni rapidi, furtività',
    color: '#b04dff',
    accent: '#ff4d8d',
    icon: '🗡️',
    abilities: ["Scatto d'ombra", 'Lame vorticanti', 'Velo'],
    ultra: 'Mille tagli',
    ranged: false,
  },
  tessitore: {
    id: 'tessitore',
    name: 'Tessitore di Portali',
    role: 'Magia, controllo',
    color: '#19d3c5',
    accent: '#7a5cff',
    icon: '🌀',
    abilities: ['Varco', 'Trappola del vuoto', 'Dardo arcano'],
    ultra: 'Collasso',
    ranged: true,
  },
  custode: {
    id: 'custode',
    name: 'Custode della Luce',
    role: 'Cura, supporto, rivelazione',
    color: '#ffb02e',
    accent: '#fff3b0',
    icon: '✨',
    abilities: ['Raggio curativo', 'Rivelazione', 'Benedizione'],
    ultra: 'Alba',
    ranged: true,
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

export interface WorldInfo {
  id: string;
  name: string;
  /** Tinta debole del portale spento. */
  tint: string;
  whisper: string;
}

/** I 4 mondi dei primi atti, nell'ordine dei portali intorno al Crocevia. */
export const WORLDS: WorldInfo[] = [
  {
    id: 'citta-sommersa',
    name: 'Città Sommersa',
    tint: '#2fd6a0',
    whisper: 'Dal fondo del portale sale un rumore d’acqua. Qualcuno, laggiù, conta i respiri.',
  },
  {
    id: 'foresta-sussurri',
    name: 'Foresta dei Sussurri',
    tint: '#8fd14f',
    whisper: 'Il portale è freddo. Tra le crepe della pietra si sente un fruscio di foglie che non c’è.',
  },
  {
    id: 'metropoli-spenta',
    name: 'Metropoli Spenta',
    tint: '#ff4f9a',
    whisper: 'Una scintilla al neon corre lungo l’arco e muore. Per un istante senti una pioggia lontana.',
  },
  {
    id: 'deserto-specchi',
    name: 'Deserto degli Specchi',
    tint: '#e9e4ff',
    whisper: 'Nella pietra nera del portale vedi il tuo riflesso. Ti guarda un attimo più a lungo del dovuto.',
  },
];

/** Battute del Custode Muto: parla solo attraverso il narratore. Il narratore AI arriva alla tappa 6. */
export const CUSTODE_LINES: string[][] = [
  [
    'Il Custode Muto non apre la bocca. Eppure la sua voce ti arriva da dentro.',
    '«Vi siete svegliati senza ricordi. È giusto così. I ricordi pesano, e il vuoto è profondo.»',
  ],
  [
    'Il Custode solleva una mano verso i portali spenti.',
    '«Una notte si sono spezzati tutti insieme. Non è stato un caso. Non lo è mai.»',
  ],
  [
    'Lo sguardo del Custode si ferma sul segno che brilla sul tuo polso.',
    '«Quella luce non è una ferita. È una serratura che aspetta… o una chiave. Lo capirete.»',
  ],
  [
    'Per un attimo, dietro il Custode, ti sembra di sentire la tua stessa voce.',
    'Il Custode scuote la testa, lentamente. «Non ascoltate l’Eco. Non ancora.»',
  ],
];

// --- Movimento -------------------------------------------------------------

export const MOVE = {
  speed: 6.2,
  accel: 40,
  gravity: 28,
  turnSpeed: 14,
  /** schivata: 0,4 s a 11,5 m/s (4,6 m), quanto la capriola */
  dodgeSpeed: 11.5,
  dodgeTime: 0.4,
  /** Istanti di invulnerabilità durante la schivata. */
  dodgeIFrames: 0.3,
  dodgeCooldown: 0.75,
  attackComboWindow: 0.55,
  attackDuration: 0.32,
  fallRespawnY: -40,
};

export const SPAWN: [number, number, number] = [0, 1.5, 9];

// --- Rete ------------------------------------------------------------------

export const NET = {
  maxPlayers: 4,
  /** Invii di posizione al secondo mentre ci si muove (documento: 15–20). */
  stateHz: 20,
  /** Invii al secondo da fermi, per tenere vivo lo stato. */
  idleHz: 2,
  /** Frequenza ridotta quando un peer passa dal relay di Supabase invece che in P2P. */
  relayHz: 5,
  /** Ritardo di interpolazione per vedere gli altri muoversi in modo fluido. */
  interpDelayMs: 110,
  maxExtrapolateMs: 220,
  roomStateEveryMs: 3000,
  rttEveryMs: 2000,
};

export const INTERACT_KEY = 'KeyG';
export const INTERACT_KEY_LABEL = 'G';

export const EMOTES = [
  { id: 0, icon: '👋', label: 'Ciao' },
  { id: 1, icon: '👍', label: 'Ok' },
  { id: 2, icon: '❗', label: 'Attenzione' },
  { id: 3, icon: '❤️', label: 'Cuore' },
] as const;
