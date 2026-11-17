import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES, MOD_IDS, rng } from '../src/combat/defs';
import { composeWave } from '../src/combat/sim';
import { LORE, missionReward } from '../src/progress/defs';
import { normalizeGroup } from '../src/progress/model';
import {
  MISSIONI_RISERVA,
  MODIFICATORI,
  NEMICI,
  LIMITI,
  daRispostaMissioni,
  difficolta,
  giornoRoma,
  missioneCompiuta,
  missioniRiserva,
  narrazioneRiserva,
  pulisci,
  secondiRimasti,
  testoObiettivo,
  validaIndizio,
  validaMissione,
  validaNarrazione,
} from '../src/narrator/core';
import {
  GIA_NOTO,
  LIMITE_24_ORE,
  MODELLO_BATTUTE,
  MODELLO_STORIE,
  TENTATIVI,
  leggiCompagnia,
  rispondi,
  type Archivio,
  type Claude,
  type Riga,
} from '../src/narrator/server';
// @ts-expect-error script JavaScript senza tipi
import { build } from '../scripts/narratore-funzione.mjs';
import { readFileSync } from 'node:fs';

describe('pezzi delle missioni', () => {
  it('nemici e modificatori sono quelli del combattimento', () => {
    expect([...NEMICI].sort()).toEqual(ENEMY_TYPES.filter((t) => t !== 'eco').sort());
    expect([...MODIFICATORI].sort()).toEqual([...MOD_IDS].sort());
  });

  it('la storia per Claude contiene le pagine della Biblioteca', () => {
    expect(GIA_NOTO).toEqual(LORE.map((l) => l.text));
  });

  it('valida e corregge una missione', () => {
    const m = validaMissione(
      {
        titolo: '  La\u0000 caccia  <b>ai Bruti</b> ',
        racconto: 'Un racconto.',
        obiettivo: { tipo: 'sconfiggi', nemico: 'bruto', quanti: 400 },
        modificatori: ['veloci', 'veloci', 'pesanti', 'frenesia', 'inventato'],
        nemico: 'sciame',
      },
      '2026-11-17-1',
    )!;
    expect(m.titolo).toBe('La caccia b ai Bruti /b');
    expect(m.obiettivo).toEqual({ tipo: 'sconfiggi', nemico: 'bruto', quanti: LIMITI.quanti.bruto[1] });
    expect(m.modificatori).toEqual(['veloci', 'pesanti']);
    // l'obiettivo decide il nemico frequente
    expect(m.nemico).toBe('bruto');
    expect(validaMissione({ titolo: 'x', racconto: 'y', obiettivo: { tipo: 'vola' } }, 'a')).toBeNull();
    expect(validaMissione({ titolo: '', racconto: 'y', obiettivo: { tipo: 'boss' } }, 'a')).toBeNull();
    expect(validaMissione({ titolo: 'x', racconto: 'y', obiettivo: { tipo: 'veloce', minuti: 1 } }, 'a')!.obiettivo).toEqual({ tipo: 'veloce', minuti: 5 });
  });

  it('accorcia i testi lunghi senza spezzare a caso', () => {
    const s = pulisci('Prima frase. '.repeat(10), 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith('.')).toBe(true);
    expect(pulisci('a'.repeat(80), 20)).toHaveLength(20);
  });

  it('dalla risposta di Claude: tre obiettivi diversi, id per posizione', () => {
    const item = (obiettivo: string, extra: object = {}) => ({
      titolo: `Missione ${obiettivo}`,
      racconto: 'Qualcosa cambia.',
      obiettivo,
      nemico_obiettivo: 'nessuno',
      quanti: 0,
      minuti: 0,
      modificatori: [],
      nemico_frequente: 'nessuno',
      ...extra,
    });
    const out = daRispostaMissioni(
      {
        missioni: [
          item('sconfiggi', { nemico_obiettivo: 'riflesso', quanti: 7 }),
          item('sconfiggi', { nemico_obiettivo: 'ombra', quanti: 7 }),
          item('sconfiggi', { nemico_obiettivo: 'nessuno' }),
          item('veloce', { minuti: 9 }),
          item('nessuno_cade'),
          item('boss'),
        ],
      },
      '2026-11-17',
    );
    expect(out.map((m) => m.obiettivo.tipo)).toEqual(['sconfiggi', 'veloce', 'nessuno_cade']);
    expect(out.map((m) => m.id)).toEqual(['2026-11-17-1', '2026-11-17-2', '2026-11-17-3']);
    expect(out[0].obiettivo).toEqual({ tipo: 'sconfiggi', nemico: 'riflesso', quanti: 7 });
    expect(out[1].nemico).toBeNull();
    expect(daRispostaMissioni({ missioni: 'no' }, '2026-11-17')).toEqual([]);
  });

  it('missioni di riserva: uguali per tutti, valide, con obiettivi diversi', () => {
    const a = missioniRiserva('2026-11-17', 'ABC123');
    expect(a).toEqual(missioniRiserva('2026-11-17', 'ABC123'));
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.obiettivo.tipo)).size).toBe(3);
    for (const m of a) expect(validaMissione(m, m.id)).toEqual(m);
    for (const m of MISSIONI_RISERVA) expect(validaMissione(m, 'x')).toEqual({ ...m, id: 'x' });
    // ogni giorno qualcosa cambia
    const days = new Set(Array.from({ length: 10 }, (_, i) => missioniRiserva(`2026-11-${10 + i}`, 'ABC123').map((m) => m.titolo).join()));
    expect(days.size).toBeGreaterThan(3);
  });

  it('una narrazione passa la validazione e mantiene la fonte', () => {
    const n = narrazioneRiserva('2026-11-17', 'G');
    expect(validaNarrazione(n)).toEqual(n);
    expect(validaNarrazione({ ...n, fonte: 'claude' })!.fonte).toBe('claude');
    expect(validaNarrazione({ ...n, giorno: 'ieri' })).toBeNull();
    expect(validaNarrazione({ ...n, missioni: [] })).toBeNull();
  });

  it('indizi validati', () => {
    expect(validaIndizio({ grado: 3, titolo: 'T', testo: 'Testo.' })).toEqual({ grado: 3, titolo: 'T', testo: 'Testo.' });
    expect(validaIndizio({ grado: 0, titolo: 'T', testo: 'Testo.' })).toBeNull();
    expect(validaIndizio({ grado: 2, titolo: '', testo: 'Testo.' })).toBeNull();
  });

  it('il giorno è quello di Roma', () => {
    expect(giornoRoma(new Date('2026-11-17T23:30:00Z'))).toBe('2026-11-18');
    expect(giornoRoma(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
  });
});

describe('missione in corso', () => {
  const base = { conta: 0, fallita: false, inizio: 1_000 };

  it('obiettivi e testi', () => {
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'sconfiggi', nemico: 'bruto', quanti: 3 }, conta: 2 }, 0)).toBe(false);
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'sconfiggi', nemico: 'bruto', quanti: 3 }, conta: 3 }, 0)).toBe(true);
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'nessuno_cade' }, fallita: true }, 0)).toBe(false);
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'senza_pozioni' } }, 0)).toBe(true);
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'veloce', minuti: 5 } }, 1_000 + 5 * 60_000)).toBe(true);
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'veloce', minuti: 5 } }, 1_001 + 5 * 60_000)).toBe(false);
    expect(missioneCompiuta({ ...base, obiettivo: { tipo: 'veloce', minuti: 5 }, inizio: 0 }, 2_000)).toBe(false);
    expect(secondiRimasti({ ...base, obiettivo: { tipo: 'veloce', minuti: 5 } }, 61_000)).toBe(240);
    expect(testoObiettivo({ tipo: 'sconfiggi', nemico: 'bruto', quanti: 3 })).toBe('Sconfiggete 3 Bruti e richiudete la Frattura');
  });

  it('più è difficile, più si guadagna', () => {
    expect(difficolta({ obiettivo: { tipo: 'boss' }, modificatori: [] })).toBe(0);
    expect(difficolta({ obiettivo: { tipo: 'veloce', minuti: 8 }, modificatori: ['veloci', 'pesanti'] })).toBe(4);
    expect(missionReward(0, 1)).toEqual({ frags: 10, minRarity: null });
    expect(missionReward(1, 1).minRarity).toBe(1);
    expect(missionReward(4, 1)).toEqual({ frags: 50, minRarity: 2 });
  });

  it('il nemico della missione compare davvero nelle ondate', () => {
    const plain = composeWave(7, rng(5), []);
    expect(composeWave(7, rng(5), [], undefined)).toEqual(plain);
    const focused = composeWave(7, rng(5), [], { type: 'bruto', min: 3, share: 0.25 });
    expect(focused.filter((t) => t === 'bruto').length).toBeGreaterThanOrEqual(3);
  });

  it('il gruppo salvato tiene missioni fatte e indizi validi', () => {
    const g = normalizeGroup({
      missioni: { giorno: '2026-11-17', fatte: ['2026-11-17-1', 7] },
      indizi: [{ grado: 2, titolo: 'T', testo: 'X.' }, { grado: 'no' }],
    });
    expect(g.missioni).toEqual({ giorno: '2026-11-17', fatte: ['2026-11-17-1'] });
    expect(g.indizi).toEqual([{ grado: 2, titolo: 'T', testo: 'X.' }]);
    expect(normalizeGroup({}).missioni).toEqual({ giorno: '', fatte: [] });
  });
});

// --- la funzione Supabase, con database e Claude finti -------------------------------------------

const ORA = new Date('2026-11-17T10:00:00Z');

function fakeDb(dati: unknown = { best: 2, grado: 3, stats: { fratture: 4, bosses: 4, kills: 90 }, base: { forgia: { p: 1, u: true } }, diario: [{ at: 1, text: 'Frattura richiusa da Ada.' }] }) {
  const rows = new Map<string, Riga>();
  let recent = 0;
  const db: Archivio & { rows: Map<string, Riga>; setRecent(n: number): void } = {
    rows,
    setRecent: (n) => (recent = n),
    utente: async (t) => (t === 'buono' ? 'u1' : t === 'altro' ? 'u2' : null),
    gruppo: async (c) => (c === 'ABC123' ? { membri: ['u1'], dati } : null),
    leggi: async (g, k) => rows.get(`${g}/${k}`) ?? null,
    crea: async (g, k) => {
      if (rows.has(`${g}/${k}`)) return false;
      rows.set(`${g}/${k}`, { stato: 'in_corso', dati: null, tentativi: 1, aggiornato: ORA.toISOString() });
      recent++;
      return true;
    },
    riprendi: async (g, k, prima, tentativi) => {
      const r = rows.get(`${g}/${k}`);
      if (!r || r.aggiornato !== prima) return false;
      rows.set(`${g}/${k}`, { ...r, stato: 'in_corso', tentativi, aggiornato: ORA.toISOString() });
      recent++;
      return true;
    },
    scrivi: async (g, k, stato, d) => {
      const r = rows.get(`${g}/${k}`)!;
      rows.set(`${g}/${k}`, { ...r, stato, dati: d });
    },
    recenti: async () => recent,
    indizi: async () => [],
  };
  return db;
}

const missioniClaude = {
  missioni: [
    { titolo: 'Vetri', racconto: 'I Riflessi tornano.', obiettivo: 'sconfiggi', nemico_obiettivo: 'riflesso', quanti: 6, minuti: 0, modificatori: [], nemico_frequente: 'riflesso' },
    { titolo: 'In piedi', racconto: 'Nessuno cada.', obiettivo: 'nessuno_cade', nemico_obiettivo: 'nessuno', quanti: 0, minuti: 0, modificatori: ['pesanti'], nemico_frequente: 'ombra' },
    { titolo: 'Corsa', racconto: 'Presto.', obiettivo: 'veloce', nemico_obiettivo: 'nessuno', quanti: 0, minuti: 9, modificatori: ['veloci', 'frenesia'], nemico_frequente: 'nessuno' },
  ],
};
const battute = {
  custode: [
    { gesto: 'Il Custode alza la mano.', voce: '«Ciao.»' },
    { gesto: 'Il Custode guarda il cielo.', voce: '«Presto.»' },
  ],
  eco: ['«Uno.»', '«Due.»'],
};

function fakeClaude(answers: Record<string, unknown>, stop = 'end_turn') {
  const calls: Record<string, unknown>[] = [];
  const claude: Claude & { calls: typeof calls } = {
    calls,
    crea: async (p) => {
      calls.push(p);
      const fmt = (p.output_config as { format: { schema: { properties: Record<string, unknown> } } }).format.schema.properties;
      const key = 'missioni' in fmt ? 'missioni' : 'custode' in fmt ? 'dialoghi' : 'indizio';
      return { stop_reason: stop, content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(answers[key] ?? {}) }] };
    },
  };
  return claude;
}

const req = (corpo: unknown, token: string | null = 'buono') => ({ metodo: 'POST', token, corpo });
const ora = () => ORA;

describe('funzione narratore', () => {
  it('controlla accesso e compagnia', async () => {
    const deps = { archivio: fakeDb(), claude: fakeClaude({}), ora };
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }, null), deps)).stato).toBe(401);
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }, 'falso'), deps)).stato).toBe(401);
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }, 'altro'), deps)).stato).toBe(403);
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ZZZ999' }), deps)).stato).toBe(404);
    expect((await rispondi(req({ azione: 'balla', gruppo: 'ABC123' }), deps)).stato).toBe(400);
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'abc 1' }), deps)).stato).toBe(400);
    expect((await rispondi({ metodo: 'GET', token: 'buono', corpo: null }, deps)).stato).toBe(405);
    expect(deps.claude.calls).toHaveLength(0);
  });

  it('scrive la giornata con Opus e Haiku, poi la ripete dalla memoria', async () => {
    const db = fakeDb();
    const claude = fakeClaude({ missioni: missioniClaude, dialoghi: battute });
    const r = await rispondi(req({ azione: 'giorno', gruppo: 'abc123' }), { archivio: db, claude, ora });
    expect(r.stato).toBe(200);
    expect(r.corpo.ok).toBe(true);
    const n = validaNarrazione(r.corpo.narrazione)!;
    expect(n.giorno).toBe('2026-11-17');
    expect(n.fonte).toBe('claude');
    expect(n.missioni.map((m) => m.titolo)).toEqual(['Vetri', 'In piedi', 'Corsa']);
    expect(n.custode[0]).toEqual(['Il Custode alza la mano.', '«Ciao.»']);
    expect(n.eco).toEqual(['«Uno.»', '«Due.»']);

    const [opus, haiku] = claude.calls;
    expect(opus.model).toBe(MODELLO_STORIE);
    expect(opus.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(opus.fallbacks).toBe('default');
    expect(opus.output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
    expect(String((opus.messages as { content: string }[])[0].content)).toContain('Frattura richiusa da Ada.');
    expect(String((opus.messages as { content: string }[])[0].content)).toContain('Edifici costruiti: Forgia.');
    expect(haiku.model).toBe(MODELLO_BATTUTE);
    expect(haiku.betas).toBeUndefined();
    expect(haiku.output_config).toMatchObject({ effort: 'low' });
    expect(String((haiku.messages as { content: string }[])[0].content)).toContain('«Vetri»');
    for (const c of claude.calls) {
      expect(c.temperature).toBeUndefined();
      expect(c.thinking).toBeUndefined();
    }
    expect(db.rows.get('ABC123/giorno-2026-11-17')!.stato).toBe('pronto');

    const again = await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: db, claude, ora });
    expect(again.corpo.narrazione).toEqual(r.corpo.narrazione);
    expect(claude.calls).toHaveLength(2);
  });

  it('se Haiku non risponde restano le battute di riserva', async () => {
    const claude = fakeClaude({ missioni: missioniClaude, dialoghi: { custode: [], eco: 'x' } });
    const r = await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: fakeDb(), claude, ora });
    const n = validaNarrazione(r.corpo.narrazione)!;
    expect(n.custode.length).toBeGreaterThanOrEqual(2);
    expect(n.eco.length).toBeGreaterThanOrEqual(2);
  });

  it('rifiuto o risposta tagliata: errore, si riprova poche volte', async () => {
    const db = fakeDb();
    const claude = fakeClaude({ missioni: missioniClaude }, 'refusal');
    for (let i = 0; i < TENTATIVI; i++) {
      const r = await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: db, claude, ora });
      expect(r.corpo).toEqual({ ok: false, motivo: 'claude' });
    }
    expect(db.rows.get('ABC123/giorno-2026-11-17')!.stato).toBe('errore');
    const r = await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: db, claude, ora });
    expect(r.corpo).toEqual({ ok: false, motivo: 'esaurito' });
    expect(claude.calls).toHaveLength(TENTATIVI);
  });

  it('un lavoro in corso fa aspettare; se è fermo da troppo si riprende', async () => {
    const db = fakeDb();
    db.rows.set('ABC123/giorno-2026-11-17', { stato: 'in_corso', dati: null, tentativi: 1, aggiornato: new Date(ORA.getTime() - 60_000).toISOString() });
    const claude = fakeClaude({ missioni: missioniClaude, dialoghi: battute });
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: db, claude, ora })).corpo).toEqual({ ok: false, motivo: 'attendi' });
    db.rows.set('ABC123/giorno-2026-11-17', { stato: 'in_corso', dati: null, tentativi: 1, aggiornato: new Date(ORA.getTime() - 10 * 60_000).toISOString() });
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: db, claude, ora })).corpo.ok).toBe(true);
  });

  it('tetto giornaliero per tutte le compagnie', async () => {
    const db = fakeDb();
    db.setRecent(LIMITE_24_ORE);
    const claude = fakeClaude({ missioni: missioniClaude });
    expect((await rispondi(req({ azione: 'giorno', gruppo: 'ABC123' }), { archivio: db, claude, ora })).corpo).toEqual({ ok: false, motivo: 'limite' });
    expect(claude.calls).toHaveLength(0);
  });

  it('indizio per il record salvato, una volta sola', async () => {
    const db = fakeDb();
    const claude = fakeClaude({ indizio: { titolo: 'La pietra', testo: 'Ogni pietra ricorda. Ma cosa?' } });
    expect((await rispondi(req({ azione: 'indizio', gruppo: 'ABC123', grado: 3 }), { archivio: db, claude, ora })).corpo).toEqual({ ok: false, motivo: 'presto' });
    const r = await rispondi(req({ azione: 'indizio', gruppo: 'ABC123', grado: 2 }), { archivio: db, claude, ora });
    expect(r.corpo).toEqual({ ok: true, indizio: { grado: 2, titolo: 'La pietra', testo: 'Ogni pietra ricorda. Ma cosa?' } });
    await rispondi(req({ azione: 'indizio', gruppo: 'ABC123', grado: 2 }), { archivio: db, claude, ora });
    expect(claude.calls).toHaveLength(1);
    expect(claude.calls[0].model).toBe(MODELLO_STORIE);
  });

  it('legge la compagnia anche se il salvataggio è strano', () => {
    expect(leggiCompagnia(null)).toMatchObject({ grado: 1, best: 0, edifici: [], diario: [] });
    const c = leggiCompagnia({ grado: 'x', diario: [{ at: 5, text: 'a'.repeat(500) }, 'rotto'] });
    expect(c.diario).toHaveLength(1);
    expect(c.diario[0].text.length).toBeLessThanOrEqual(200);
  });

  it('il file da incollare su Supabase è aggiornato', () => {
    expect(readFileSync('supabase/functions/narratore/index.ts', 'utf8')).toBe(build());
  });
});
