import { describe, expect, it } from 'vitest';
import {
  admittedMembers,
  applyClassRequest,
  electHost,
  emptyRoomState,
  isAdmitted,
  normalizeRoomState,
  shouldAcceptRoomState,
  hostIsBehind,
  queuedJoinTime,
  type Member,
} from '../src/net/roomLogic';

const m = (id: string, joinedAt: number): Member => ({ id, name: id.toUpperCase(), joinedAt });

describe('host e ammissione', () => {
  it('host = primo entrato, indipendentemente dall’ordine della lista', () => {
    const members = [m('c', 30), m('a', 10), m('b', 20)];
    expect(electHost(members, 4)).toBe('a');
  });

  it('a parità di orario decide l’id, così tutti scelgono lo stesso host', () => {
    expect(electHost([m('z', 5), m('k', 5)], 4)).toBe('k');
  });

  it('se l’host esce, la partita passa al successivo', () => {
    const members = [m('a', 10), m('b', 20), m('c', 30)];
    expect(electHost(members.filter((x) => x.id !== 'a'), 4)).toBe('b');
  });

  it('al massimo 4 giocatori: il quinto resta fuori', () => {
    const members = [m('a', 1), m('b', 2), m('c', 3), m('d', 4), m('e', 5)];
    expect(admittedMembers(members, 4).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(isAdmitted(members, 'e', 4)).toBe(false);
    expect(isAdmitted(members, 'd', 4)).toBe(true);
  });

  it('stanza vuota: nessun host', () => {
    expect(electHost([], 4)).toBeNull();
  });
});

describe('orario d’ingresso', () => {
  it('con l’orologio indietro si mette in coda dopo chi è già dentro', () => {
    const me = m('z', 100);
    expect(queuedJoinTime(me, [{ ...m('a', 500), ok: true }, me])).toBe(501);
  });

  it('non scavalca chi sta entrando nello stesso momento', () => {
    const me = m('b', 200);
    const members = [{ ...m('a', 100), ok: true }, m('c', 300), m('d', 400), me];
    expect(queuedJoinTime(me, members)).toBe(200);
  });
});

describe('classi uniche nella stanza', () => {
  const ids = ['a', 'b', 'c'];

  it('assegna una classe libera e alza la versione', () => {
    const r = applyClassRequest(emptyRoomState(), 'a', 'guardiano', ids);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.classes).toEqual({ a: 'guardiano' });
      expect(r.state.v).toBe(1);
    }
  });

  it('rifiuta una classe già presa', () => {
    const s = { v: 1, classes: { a: 'guardiano' as const } };
    const r = applyClassRequest(s, 'b', 'guardiano', ids);
    expect(r).toEqual({ ok: false, reason: 'taken', holder: 'a' });
  });

  it('cambiare classe libera la precedente', () => {
    let s = emptyRoomState();
    let r = applyClassRequest(s, 'a', 'guardiano', ids);
    if (!r.ok) throw new Error('atteso ok');
    s = r.state;
    r = applyClassRequest(s, 'a', 'lama', ids);
    if (!r.ok) throw new Error('atteso ok');
    s = r.state;
    const r2 = applyClassRequest(s, 'b', 'guardiano', ids);
    expect(r2.ok).toBe(true);
  });

  it('ignora chi non è nella stanza', () => {
    expect(applyClassRequest(emptyRoomState(), 'x', 'lama', ids)).toEqual({ ok: false, reason: 'not-member' });
  });

  it('richiedere la stessa classe non cambia nulla', () => {
    const s = { v: 3, classes: { a: 'lama' as const } };
    const r = applyClassRequest(s, 'a', 'lama', ids);
    expect(r.ok && r.state).toBe(s);
  });
});

describe('pulizia dello stato', () => {
  it('toglie chi è uscito', () => {
    const s = { v: 4, classes: { a: 'lama' as const, b: 'custode' as const } };
    const n = normalizeRoomState(s, ['a']);
    expect(n.classes).toEqual({ a: 'lama' });
    expect(n.v).toBe(5);
  });

  it('risolve i doppioni a favore di chi è entrato prima', () => {
    const s = { v: 2, classes: { b: 'lama' as const, a: 'lama' as const } };
    expect(normalizeRoomState(s, ['a', 'b']).classes).toEqual({ a: 'lama' });
  });

  it('se non cambia nulla restituisce lo stesso oggetto', () => {
    const s = { v: 2, classes: { a: 'lama' as const } };
    expect(normalizeRoomState(s, ['a', 'b'])).toBe(s);
  });

  it('dall’host accetta versioni uguali o nuove, dagli altri solo più nuove', () => {
    const local = { v: 5, classes: {} };
    expect(shouldAcceptRoomState(local, { v: 5, classes: {} }, 'h', 'h')).toBe(true);
    expect(shouldAcceptRoomState(local, { v: 1, classes: {} }, 'h', 'h')).toBe(false);
    expect(shouldAcceptRoomState(local, { v: 5, classes: {} }, 'x', 'h')).toBe(false);
    expect(shouldAcceptRoomState(local, { v: 6, classes: {} }, 'x', 'h')).toBe(true);
  });

  it('riconosce un host rimasto indietro (cambio di host)', () => {
    const local = { v: 7, classes: {} };
    expect(hostIsBehind(local, { v: 3, classes: {} }, 'h', 'h')).toBe(true);
    expect(hostIsBehind(local, { v: 3, classes: {} }, 'x', 'h')).toBe(false);
    expect(hostIsBehind(local, { v: 8, classes: {} }, 'h', 'h')).toBe(false);
  });
});
