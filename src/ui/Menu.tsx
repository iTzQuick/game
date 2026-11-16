// Schermata iniziale: nome, crea una partita, entra con un codice o un link.

import { useEffect, useState } from 'react';
import { generateRoomCode, normalizeRoomCode } from '../net/code';
import { supabaseConfig } from '../net/room';
import { joinRoom, roomFromUrl } from '../game/session';
import { patchRoom, saveName, useGame } from '../game/store';
import { AccountBox } from './AccountBox';
import { reloadGuest } from '../progress/store';

export function Menu() {
  const savedName = useGame((s) => s.selfName);
  const room = useGame((s) => s.room);
  const invited = normalizeRoomCode(roomFromUrl());
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(invited ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const online = supabaseConfig() !== null && new URLSearchParams(location.search).get('rete') !== 'locale';

  useEffect(() => {
    if (room.error) setErr(room.error);
  }, [room.error]);

  const go = async (target: string) => {
    const n = name.trim();
    if (!n) {
      setErr('Scrivi un nome per il tuo personaggio.');
      return;
    }
    saveName(n.slice(0, 16));
    reloadGuest();
    setErr(null);
    patchRoom({ error: undefined });
    setBusy(true);
    const ok = await joinRoom(target);
    setBusy(false);
    if (!ok) setErr(lastRoomError() ?? 'Non è stato possibile entrare nella stanza.');
  };

  const join = () => {
    const c = normalizeRoomCode(code);
    if (!c) {
      setErr('Il codice è di 4 caratteri (lettere e numeri).');
      return;
    }
    void go(c);
  };

  return (
    <div className="menu">
      <div className="menu-card">
        <h1 className="title">
          Le <span>Fratture</span>
        </h1>
        <p className="tagline">I portali si sono spezzati. Vi siete svegliati al Crocevia, con un segno luminoso sul polso.</p>

        <label className="field">
          <span>Il tuo nome</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Come ti chiamano?"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (invited ? join() : void go(generateRoomCode()))}
            autoFocus
          />
        </label>

        {invited && <div className="invite-note">Sei stato invitato nella stanza <b>{invited}</b>.</div>}

        <div className="menu-actions">
          {!invited && (
            <button className="primary" disabled={busy} onClick={() => void go(generateRoomCode())}>
              Crea una partita
            </button>
          )}
          <div className="join-row">
            <input
              className="code-input"
              value={code}
              maxLength={6}
              placeholder="CODICE"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <button className={invited ? 'primary' : ''} disabled={busy} onClick={join}>
              Entra
            </button>
          </div>
        </div>

        <AccountBox />

        {busy && <div className="loading">Il Crocevia vi sta chiamando…</div>}
        {err && <div className="error">{err}</div>}

        <div className={`mode-note ${online ? 'online' : 'local'}`}>
          {online ? (
            <>Online: fino a 4 giocatori da dispositivi diversi, con un link d'invito o un codice.</>
          ) : (
            <>
              Modalità locale: Supabase non è configurato, quindi le stanze funzionano solo tra schede di questo
              browser. Per giocare da case diverse vedi il README.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function lastRoomError(): string | undefined {
  return useGame.getState().room.error;
}
