import { describe, expect, it } from 'vitest';
import { ClockOffset, SnapshotBuffer, lerpAngle } from '../src/net/interpolation';
import { generateRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET } from '../src/net/code';

const snap = (x: number) => ({ p: [x, 0, 0] as [number, number, number], r: 0, a: 'run' as const, s: 6 });

describe('interpolazione', () => {
  it('interpola a metà tra due istantanee', () => {
    const b = new SnapshotBuffer();
    // orologio remoto 1000 avanti, latenza 50 ms
    b.push(1000, 50, snap(0));
    b.push(1050, 100, snap(1));
    const s = b.sample(75)!;
    expect(s.p[0]).toBeCloseTo(0.5);
    expect(s.extrapolated).toBe(false);
  });

  it('scarta i pacchetti arrivati fuori ordine', () => {
    const b = new SnapshotBuffer();
    expect(b.push(100, 10, snap(0))).toBe(true);
    expect(b.push(200, 20, snap(2))).toBe(true);
    expect(b.push(150, 30, snap(1))).toBe(false);
    expect(b.size).toBe(2);
  });

  it('oltre l’ultima istantanea prevede, ma per un tempo limitato', () => {
    const b = new SnapshotBuffer(100);
    b.push(0, 0, snap(0));
    b.push(50, 50, snap(1));
    expect(b.sample(100)!.p[0]).toBeCloseTo(2); // +50ms → +1
    expect(b.sample(10_000)!.p[0]).toBeCloseTo(3); // fermo dopo 100 ms
    expect(b.sample(10_000)!.extrapolated).toBe(true);
  });

  it('il jitter di rete non sposta i tempi: vale il pacchetto più veloce', () => {
    const c = new ClockOffset(0);
    c.update(0, 80);
    c.update(50, 110); // arrivato prima: latenza minore
    c.update(100, 190);
    expect(c.value).toBe(60);
  });

  it('gli angoli girano dalla parte più corta', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(lerpAngle(0.1, -0.1, 0.5)).toBeCloseTo(0);
  });
});

describe('codici stanza', () => {
  it('genera 4 caratteri validi', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(4);
      expect(normalizeRoomCode(c)).toBe(c);
    }
  });

  it('accetta minuscole e spazi, rifiuta caratteri ambigui', () => {
    expect(normalizeRoomCode(' ab 2c ')).toBe('AB2C');
    expect(normalizeRoomCode('AB0C')).toBeNull();
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01IOL]/);
  });
});
