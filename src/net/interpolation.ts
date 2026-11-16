// Interpolazione delle posizioni degli altri giocatori.
//
// Ogni giocatore invia la sua posizione ~20 volte al secondo. Chi riceve la
// disegna con un piccolo ritardo (≈110 ms) interpolando tra due istantanee:
// così il movimento resta fluido anche se i pacchetti arrivano irregolari.

export type AnimState = 'idle' | 'run' | 'dodge' | 'fall' | 'down';

export interface Snapshot {
  /** Tempo locale (ms) in cui l'istantanea "vale", già convertito dall'orologio del mittente. */
  t: number;
  p: [number, number, number];
  /** Rotazione sull'asse Y (radianti). */
  r: number;
  a: AnimState;
  /** Velocità orizzontale, per l'animazione della corsa. */
  s: number;
}

export interface Sample {
  p: [number, number, number];
  r: number;
  a: AnimState;
  s: number;
  /** true se stiamo prevedendo oltre l'ultima istantanea ricevuta. */
  extrapolated: boolean;
}

const TWO_PI = Math.PI * 2;

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

/**
 * Stima la differenza tra l'orologio del mittente e il nostro. Prende il
 * valore più basso visto (il pacchetto più veloce) e lo lascia risalire
 * piano, per seguire eventuali derive dell'orologio.
 */
export class ClockOffset {
  value: number | null = null;
  constructor(private drift = 0.005) {}

  update(remoteTs: number, localRecv: number): number {
    const sample = localRecv - remoteTs;
    if (this.value === null || sample < this.value) this.value = sample;
    else this.value += (sample - this.value) * this.drift;
    return this.value;
  }
}

export class SnapshotBuffer {
  private snaps: Snapshot[] = [];
  readonly clock = new ClockOffset();
  private lastRemoteTs = -Infinity;

  constructor(private maxExtrapolateMs = 220) {}

  get size(): number {
    return this.snaps.length;
  }

  get latest(): Snapshot | undefined {
    return this.snaps[this.snaps.length - 1];
  }

  /** Aggiunge un'istantanea. Scarta quelle arrivate fuori ordine (il canale è inaffidabile). */
  push(remoteTs: number, localRecv: number, data: Omit<Snapshot, 't'>): boolean {
    if (remoteTs <= this.lastRemoteTs) return false;
    this.lastRemoteTs = remoteTs;
    const offset = this.clock.update(remoteTs, localRecv);
    this.snaps.push({ ...data, t: remoteTs + offset });
    if (this.snaps.length > 64) this.snaps.splice(0, this.snaps.length - 64);
    return true;
  }

  /** Riposiziona di colpo (per esempio dopo un teletrasporto). */
  clear(): void {
    this.snaps = [];
  }

  sample(renderTime: number): Sample | null {
    const s = this.snaps;
    if (s.length === 0) return null;
    // Tiene solo ciò che serve: un'istantanea prima del tempo di rendering.
    while (s.length > 2 && s[1].t <= renderTime) s.shift();

    const first = s[0];
    if (renderTime <= first.t || s.length === 1) {
      return { p: [...first.p], r: first.r, a: first.a, s: first.s, extrapolated: renderTime > first.t };
    }

    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (renderTime >= a.t && renderTime <= b.t) {
        const k = b.t === a.t ? 1 : (renderTime - a.t) / (b.t - a.t);
        return {
          p: [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k],
          r: lerpAngle(a.r, b.r, k),
          a: k < 0.5 ? a.a : b.a,
          s: a.s + (b.s - a.s) * k,
          extrapolated: false,
        };
      }
    }

    // Oltre l'ultima istantanea: prosegue un po' nella stessa direzione, poi si ferma.
    const b = s[s.length - 1];
    const a = s[s.length - 2];
    const dt = b.t - a.t;
    const ahead = Math.min(renderTime - b.t, this.maxExtrapolateMs);
    const k = dt > 0 ? ahead / dt : 0;
    return {
      p: [b.p[0] + (b.p[0] - a.p[0]) * k, b.p[1] + (b.p[1] - a.p[1]) * k, b.p[2] + (b.p[2] - a.p[2]) * k],
      r: b.r,
      a: b.a,
      s: b.s,
      extrapolated: true,
    };
  }
}
