// Entrare e uscire da una stanza.

import { randomId } from '../net/code';
import { RoomClient, setRoom } from '../net/room';
import { getGame, setGame } from './store';

const ROOM_PARAM = 'stanza';

export function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get(ROOM_PARAM);
}

export function inviteLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(ROOM_PARAM, code);
  return url.toString();
}

function setUrlRoom(code: string | null) {
  try {
    const url = new URL(location.href);
    // conserva i parametri di sviluppo (rete=locale, p2p)
    if (code) url.searchParams.set(ROOM_PARAM, code);
    else url.searchParams.delete(ROOM_PARAM);
    history.replaceState(null, '', url.toString());
  } catch {
    /* in alcune pagine incorporate l'URL non si può cambiare: si entra con il codice */
  }
}

export async function joinRoom(code: string): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const selfId = randomId();
  setGame({ selfId });
  const room = new RoomClient({
    code,
    selfId,
    name: getGame().selfName.trim() || 'Senza nome',
    forceLocal: params.get('rete') === 'locale',
    forceP2P: params.has('p2p'),
  });
  setRoom(room);
  const ok = await room.connect();
  if (!ok) {
    setRoom(null);
    return false;
  }
  setUrlRoom(code);
  setGame({ screen: 'game', classPicker: true, dialog: null, prompt: null, pings: [], emotes: {} });
  return true;
}

export function leaveRoom() {
  setRoom(null);
  setUrlRoom(null);
  setGame({
    screen: 'menu',
    classPicker: false,
    settingsOpen: false,
    helpOpen: false,
    emoteWheel: false,
    dialog: null,
    prompt: null,
    pings: [],
    emotes: {},
  });
}
