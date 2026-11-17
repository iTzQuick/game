import { describe, expect, it } from 'vitest';
import {
  CHAPTER,
  DAILY_POOL,
  SOMMERSA,
  applyEvent,
  cleanText,
  dailyUntouched,
  emptyStory,
  fallbackDaily,
  goalText,
  normalizeStory,
  progressOf,
  rewardFor,
  sanitizeDaily,
  sanitizeLines,
  today,
  withDaily,
  type StoryState,
} from '../src/story/core';

const kill = (nemico: 'ombra' | 'eco' | 'riflesso', mondo?: string, grado = 1) => ({ k: 'kill' as const, nemico, mondo, grado });

describe('avanzamento degli obiettivi', () => {
  it('conta solo il nemico giusto, e il boss non vale come nemico qualsiasi', () => {
    expect(progressOf({ k: 'uccidi', n: 3, nemico: 'ombra' }, kill('ombra'))).toBe(1);
    expect(progressOf({ k: 'uccidi', n: 3, nemico: 'ombra' }, kill('riflesso'))).toBe(0);
    expect(progressOf({ k: 'uccidi', n: 3 }, kill('riflesso'))).toBe(1);
    expect(progressOf({ k: 'uccidi', n: 3 }, kill('eco'))).toBe(0);
    expect(progressOf({ k: 'boss', n: 1 }, kill('eco'))).toBe(1);
  });

  it('rispetta mondo e Grado', () => {
    const g = { k: 'uccidi' as const, n: 3, mondo: SOMMERSA } as const;
    expect(progressOf(g, kill('ombra'))).toBe(0);
    expect(progressOf(g, kill('ombra', SOMMERSA))).toBe(1);
    expect(progressOf({ k: 'boss', n: 1, grado: 3 }, kill('eco', undefined, 2))).toBe(0);
    expect(progressOf({ k: 'boss', n: 1, grado: 3 }, kill('eco', undefined, 3))).toBe(1);
    expect(progressOf({ k: 'grado', n: 1, grado: 4 }, { k: 'close', grado: 3, wipes: 0 })).toBe(0);
    expect(progressOf({ k: 'grado', n: 1, grado: 4 }, { k: 'close', grado: 5, wipes: 0 })).toBe(1);
    expect(progressOf({ k: 'senza-cadute', n: 1 }, { k: 'close', grado: 1, wipes: 1 })).toBe(0);
  });
});

describe('missioni', () => {
  it('il capitolo avanza una missione alla volta', () => {
    let st = emptyStory();
    expect(CHAPTER[0].goal).toMatchObject({ k: 'stanze', n: 3, mondo: SOMMERSA });
    // fuori dalla Città non conta
    st = applyEvent(st, { k: 'room', grado: 1 }).st;
    expect(st.capProg).toBe(0);
    for (let i = 0; i < 2; i++) st = applyEvent(st, { k: 'room', mondo: SOMMERSA, grado: 1 }).st;
    expect(st.capProg).toBe(2);
    const r = applyEvent(st, { k: 'room', mondo: SOMMERSA, grado: 1 });
    expect(r.done.map((m) => m.id)).toEqual(['cs-1']);
    expect(r.st).toMatchObject({ cap: 1, capProg: 0 });
  });

  it('le giornaliere si completano una volta sola e lo stato non cambia se nulla avanza', () => {
    let st: StoryState = withDaily(emptyStory(), '2026-11-17', fallbackDaily('2026-11-17', 1), 'riserva');
    st = { ...st, cap: CHAPTER.length };
    st.daily = [{ ...st.daily[0], goal: { k: 'combo', n: 2 } }];
    st.dailyProg = [0];
    expect(dailyUntouched(st)).toBe(true);
    const same = applyEvent(st, kill('ombra'));
    expect(same.st).toBe(st);
    st = applyEvent(st, { k: 'combo', grado: 1 }).st;
    const r = applyEvent(st, { k: 'combo', grado: 1 });
    expect(r.done).toHaveLength(1);
    expect(applyEvent(r.st, { k: 'combo', grado: 1 }).done).toHaveLength(0);
    expect(r.st.dailyProg).toEqual([2]);
  });

  it('a capitolo finito non succede nulla', () => {
    const st = { ...emptyStory(), cap: CHAPTER.length };
    expect(applyEvent(st, kill('eco', SOMMERSA, 5)).done).toHaveLength(0);
  });
});

describe('giornaliere di riserva', () => {
  it('tre diverse, sempre le stesse per lo stesso giorno', () => {
    const a = fallbackDaily('2026-11-17', 3, 'ABCD');
    const b = fallbackDaily('2026-11-17', 3, 'ABCD');
    expect(a).toEqual(b);
    expect(new Set(a.map((m) => m.titolo)).size).toBe(3);
    const days = new Set(Array.from({ length: 10 }, (_, i) => fallbackDaily(`2026-11-${10 + i}`, 1).map((m) => m.titolo).join()));
    expect(days.size).toBeGreaterThan(3);
    expect(DAILY_POOL.length).toBeGreaterThanOrEqual(8);
  });

  it('ricompense più alte per la storia e per obiettivi più difficili', () => {
    const g = { k: 'uccidi' as const, n: 10 };
    expect(rewardFor(g, 'storia').xp).toBeGreaterThan(rewardFor(g, 'giornaliera').xp);
    expect(rewardFor({ k: 'uccidi', n: 20 }, 'giornaliera').xp).toBeGreaterThan(rewardFor(g, 'giornaliera').xp);
    expect(rewardFor(g, 'giornaliera').frammenti).toBeGreaterThan(0);
  });
});

describe('testi scritti da Claude', () => {
  it('tiene solo obiettivi validi, riporta le quantità nei limiti e calcola da sé le ricompense', () => {
    const raw = {
      missioni: [
        { titolo: 'Tante ombre', intro: 'Via!', fine: 'Fatto.', obiettivo: { tipo: 'uccidi', quantita: 999, nemico: 'ombra', grado: null, mondo: null }, premio: 1e9 },
        { titolo: 'Volare', intro: '', fine: '', obiettivo: { tipo: 'vola', quantita: 1 } },
        { titolo: 'Doppione', obiettivo: { tipo: 'uccidi', quantita: 5, nemico: 'ombra' } },
        { titolo: 'Profondo', obiettivo: { tipo: 'grado', quantita: 3, grado: 50, nemico: null, mondo: SOMMERSA } },
        { titolo: '<b>Combo</b>', obiettivo: { tipo: 'combo', quantita: 2 } },
        { titolo: 'Quarta', obiettivo: { tipo: 'stanze', quantita: 4 } },
      ],
    };
    const out = sanitizeDaily(raw, '2026-11-17', 3, false)!;
    expect(out).toHaveLength(3);
    expect(out[0].goal).toEqual({ k: 'uccidi', n: 40, nemico: 'ombra' });
    expect(out[0].premio).toEqual(rewardFor(out[0].goal, 'giornaliera'));
    // il Grado richiesto resta vicino al record; la Città chiusa non si usa
    expect(out[1].goal).toEqual({ k: 'grado', n: 1, grado: 4 });
    expect(out[2].titolo).toBe('Combo');
    expect(out.map((m) => m.id)).toEqual(['g-2026-11-17-0', 'g-2026-11-17-1', 'g-2026-11-17-2']);
    expect(sanitizeDaily({ missioni: [] }, 'x', 1, true)).toBeNull();
    expect(sanitizeDaily('niente', 'x', 1, true)).toBeNull();
  });

  it('battute brevi e pulite', () => {
    expect(sanitizeLines({ righe: ['  Uno\n due ', '', 'tre', 'quattro', 'cinque'] })).toEqual(['Uno due', 'tre', 'quattro']);
    expect(sanitizeLines({ righe: [] })).toBeNull();
    expect(cleanText('a'.repeat(300), 50).length).toBeLessThanOrEqual(50);
  });
});

it('stato salvato: si ripara se è rovinato', () => {
  expect(normalizeStory(null)).toEqual(emptyStory());
  const st = normalizeStory({ cap: 99, capProg: -3, day: '2026-11-17', daily: [{ nope: 1 }], dailyProg: [5] });
  expect(st.cap).toBe(CHAPTER.length);
  expect(st.capProg).toBe(0);
  expect(st.daily).toEqual([]);
  expect(today(new Date(2026, 0, 5))).toBe('2026-01-05');
  expect(goalText({ k: 'uccidi', n: 1, nemico: 'bruto', mondo: SOMMERSA })).toBe('Sconfiggi 1 Bruto nella Città Sommersa');
});
