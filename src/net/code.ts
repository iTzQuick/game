// Codici stanza da 4 caratteri, senza lettere che si confondono (0/O, 1/I/L).

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

export function generateRoomCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalizza quello che scrive il giocatore. Restituisce null se non è un codice valido. */
export function normalizeRoomCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const clean = input.toUpperCase().replace(/[\s-]+/g, '');
  if (clean.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of clean) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return clean;
}

/** Id casuale per il giocatore. crypto.randomUUID non esiste fuori da HTTPS, quindi c'è una riserva. */
export function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID().replace(/-/g, '').slice(0, 16);
    } catch {
      /* contesto non sicuro: usa la riserva */
    }
  }
  const bytes = new Uint8Array(8);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
