import { describe, expect, it } from 'vitest';
import { ABILITY_MOVES, MOVE_DURATION, bodyOffset, dodgeOffset, type MoveStyle } from '../src/player/moves';
import { CLASS_IDS } from '../src/game/constants';

const styles = Object.keys(MOVE_DURATION) as MoveStyle[];
const wrap = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));

describe('movimenti del corpo', () => {
  it('ogni abilità di ogni classe ha un movimento', () => {
    for (const c of CLASS_IDS) for (const s of ['Q', 'E', 'R', 'F'] as const) expect(styles).toContain(ABILITY_MOVES[c][s]);
  });

  it('si parte e si finisce a riposo, senza scatti (anche dopo le giravolte)', () => {
    for (const st of styles) {
      for (const n of [1, 2, 3]) {
        expect(bodyOffset(st, n, 0)).toEqual({ rx: 0, ry: 0, y: 0, z: 0, s: 1 });
        expect(bodyOffset(st, n, 1)).toEqual({ rx: 0, ry: 0, y: 0, z: 0, s: 1 });
        const end = bodyOffset(st, n, 0.995);
        expect(Math.abs(end.rx)).toBeLessThan(0.05);
        expect(wrap(end.ry)).toBeLessThan(0.05);
        expect(Math.abs(end.y)).toBeLessThan(0.05);
        expect(Math.abs(end.z)).toBeLessThan(0.05);
        const start = bodyOffset(st, n, 0.005);
        expect(Math.abs(start.rx) + wrap(start.ry) + Math.abs(start.y) + Math.abs(start.z)).toBeLessThan(0.15);
      }
    }
  });

  it('nessun salto brusco tra un fotogramma e l’altro', () => {
    for (const st of styles) {
      let prev = bodyOffset(st, 2, 0);
      for (let k = 0.01; k < 1; k += 0.01) {
        const o = bodyOffset(st, 2, k);
        expect(Math.abs(o.y - prev.y)).toBeLessThan(0.12);
        expect(Math.abs(o.z - prev.z)).toBeLessThan(0.12);
        expect(Math.abs(o.rx - prev.rx)).toBeLessThan(0.15);
        prev = o;
      }
    }
  });

  it('i tre colpi della combo si muovono in modo diverso', () => {
    const a = bodyOffset('swing', 1, 0.4);
    const b = bodyOffset('swing', 2, 0.4);
    const c = bodyOffset('swing', 3, 0.4);
    expect(Math.sign(a.ry)).not.toBe(Math.sign(b.ry));
    expect(c.z).toBeGreaterThan(a.z);
  });

  it('la schivata è uno scatto chinato, non una capriola', () => {
    for (let k = 0; k <= 1; k += 0.1) expect(Math.abs(dodgeOffset(k).rx)).toBeLessThanOrEqual(0.5);
  });
});
