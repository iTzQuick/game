// Interfaccia di gioco sopra il canvas.

import { useState } from 'react';
import { CLASSES, CLASS_IDS, EMOTES, INTERACT_KEY_LABEL, type ClassId } from '../game/constants';
import { inviteLink, leaveRoom } from '../game/session';
import { advanceDialog, setGame, updateSettings, useGame, type Quality } from '../game/store';
import { getRoom } from '../net/room';
import { StatsPanel, linkLabel } from './Stats';
import { CombatHud, TopStatus } from './CombatHud';
import { Icon } from './Icon';
import { ProgressPanels } from './ProgressPanels';
import { VotePanel, useCittaStory } from './CittaPanel';
import { BoonPanel, useBoonOffers } from './BoonPanel';
import { isStandalone } from './AppShell';
import { runRequest } from '../world/layout';

export function Hud({ touch }: { touch: boolean }) {
  const showStats = useGame((s) => s.settings.showStats);
  const classPicker = useGame((s) => s.classPicker);
  const settingsOpen = useGame((s) => s.settingsOpen);
  const helpOpen = useGame((s) => s.helpOpen);
  const dialog = useGame((s) => s.dialog);
  const pointerLocked = useGame((s) => s.pointerLocked);
  const anyMenu = classPicker || settingsOpen || helpOpen || dialog !== null;
  useCittaStory();
  useBoonOffers();

  return (
    <div className="hud">
      {/* a sinistra: stanza, poi i messaggi (bottino, esperienza…) piccoli */}
      <div className="top-left">
        <RoomPanel />
        <Toasts />
        {showStats && <StatsPanel />}
      </div>
      <TopButtons touch={touch} />
      <SideButtons />
      <CombatHud touch={touch} />
      {/* al centro, in alto: solo lo stato della Frattura, il boss e le combo */}
      <div className="top-center">
        <TopStatus />
      </div>
      {!touch && pointerLocked && !anyMenu && <div className="crosshair" />}
      {!touch && !pointerLocked && !anyMenu && <div className="lock-hint">Clicca sul gioco per muovere la visuale con il mouse</div>}
      {!touch && <PromptHint />}
      {dialog && <DialogBox />}
      {classPicker && <ClassPicker />}
      {settingsOpen && <SettingsPanel />}
      {helpOpen && <HelpPanel touch={touch} />}
      <ProgressPanels />
      <VotePanel />
      <BoonPanel />
      {/* dall'icona in Home c'è già la schermata "gira il telefono" (AppShell) */}
      {touch && !isStandalone() && <OrientationHint />}
    </div>
  );
}

function RoomPanel() {
  const room = useGame((s) => s.room);
  const selfId = useGame((s) => s.selfId);
  const showStats = useGame((s) => s.settings.showStats);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = inviteLink(room.code);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Le Fratture', text: `Vieni al Crocevia! Codice ${room.code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copia il link di invito:', link);
    }
  };
  return (
    <div className="panel room-panel">
      <div className="room-head">
        <span className={`mode-dot ${room.mode}`} title={room.mode === 'online' ? 'Online' : 'Locale (solo questo browser)'} />
        <span className="room-code" title="Codice della stanza">
          {room.code}
        </span>
        <span className="room-grado">Grado {room.grado}</span>
        <button className="small invite" onClick={copy} title="Invita: copia o condividi il link">
          {copied ? '✓' : 'Invita'}
        </button>
      </div>
      <ul className="players">
        {room.members.map((m) => {
          const cls = room.classes[m.id];
          const peer = room.peers[m.id];
          return (
            <li key={m.id} className={m.id === selfId ? 'me' : ''}>
              <span className="cls-dot" style={{ background: cls ? CLASSES[cls].color : '#5d5868' }}>
                {cls ? <Icon name={`classe-${cls}`} size={16} /> : '?'}
              </span>
              <span className="pname">{m.name}</span>
              {room.hostId === m.id && (
                <span className="host" title="Host: calcola nemici e bottino">
                  👑
                </span>
              )}
              {showStats && peer && (
                <small className={`link ${peer.link}`}>
                  {linkLabel(peer.link)}
                  {peer.rtt !== null ? ` ${peer.rtt}ms` : ''}
                </small>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopButtons({ touch }: { touch: boolean }) {
  const canFullscreen = touch && typeof document !== 'undefined' && document.fullscreenEnabled;
  return (
    <div className="top-buttons">
      <button onClick={() => setGame({ helpOpen: true })} title="Comandi">
        ?
      </button>
      <button onClick={() => setGame({ settingsOpen: true })} title="Impostazioni">
        ⚙
      </button>
      {canFullscreen && (
        <button
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
          title="Schermo intero"
        >
          ⛶
        </button>
      )}
      <button className="danger" onClick={leaveRoom} title="Esci dalla stanza">
        Esci
      </button>
    </div>
  );
}

/** Personaggio, Zaino e Classe: solo icone, in colonna sotto "Esci". */
function SideButtons() {
  const cls = useGame((s) => s.room.classes[s.selfId] ?? null);
  const isHost = useGame((s) => s.room.hostId === s.selfId);
  const inRun = useGame((s) => !!s.room.run && s.room.run.phase !== 'complete');
  const missionsLeft = useGame((s) => (s.room.narrazione?.missioni ?? []).filter((m) => !s.room.fatte.includes(m.id)).length);
  return (
    <div className="side-buttons">
      <button
        className="icon-btn"
        onClick={() => setGame((s) => ({ panel: s.panel === 'personaggio' ? null : 'personaggio' }))}
        title="Personaggio e talenti (P)"
        aria-label="Personaggio e talenti"
      >
        <span aria-hidden>👤</span>
      </button>
      <button className="icon-btn" onClick={() => setGame((s) => ({ panel: s.panel === 'zaino' ? null : 'zaino' }))} title="Zaino (I)" aria-label="Zaino">
        <span aria-hidden>🎒</span>
      </button>
      <button
        className="icon-btn"
        onClick={() => setGame((s) => ({ panel: s.panel === 'missioni' ? null : 'missioni' }))}
        title="Missioni di oggi (M)"
        aria-label="Missioni di oggi"
      >
        <span aria-hidden>📜</span>
        {missionsLeft > 0 && <i className="dot">{missionsLeft}</i>}
      </button>
      <button className="icon-btn" onClick={() => setGame((s) => ({ classPicker: !s.classPicker }))} title="Classe (C)" aria-label="Classe">
        {cls ? <Icon name={`classe-${cls}`} size={30} /> : <span aria-hidden>✦</span>}
      </button>
      {isHost && inRun && (
        <button
          className="icon-btn danger"
          onClick={() => runRequest('abandon')}
          title="Abbandona la Frattura (solo l'host: tutti tornano al Crocevia)"
          aria-label="Abbandona la Frattura"
        >
          <span aria-hidden>🏳</span>
        </button>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.slice(-3).map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function PromptHint() {
  const prompt = useGame((s) => s.prompt);
  const blocked = useGame((s) => s.dialog !== null || s.classPicker);
  if (!prompt || blocked) return null;
  return (
    <div className="prompt">
      <kbd>{INTERACT_KEY_LABEL}</kbd> {prompt.label}
    </div>
  );
}

function DialogBox() {
  const dialog = useGame((s) => s.dialog)!;
  return (
    <div className="dialog-wrap" onPointerDown={() => advanceDialog()}>
      <div className="dialog">
        <div className="dialog-title">{dialog.title}</div>
        <p key={dialog.index} className="dialog-text">
          {dialog.lines[dialog.index]}
        </p>
        <div className="dialog-next">
          {dialog.index + 1 < dialog.lines.length ? 'tocca o premi G per continuare' : 'tocca o premi G per chiudere'}
        </div>
      </div>
    </div>
  );
}

function ClassPicker() {
  const classes = useGame((s) => s.room.classes);
  const members = useGame((s) => s.room.members);
  const selfId = useGame((s) => s.selfId);
  const mine = classes[selfId] ?? null;
  const holderOf = (c: ClassId) => Object.entries(classes).find(([, x]) => x === c)?.[0] ?? null;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? '…';
  const pick = (c: ClassId) => getRoom()?.requestClass(c);

  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && setGame({ classPicker: false })}>
      <div className="modal class-picker">
        <h2>Scegli la classe</h2>
        <p className="muted">
          Nella stessa stanza ogni classe può esserci una volta sola. Puoi cambiarla quando sei al Crocevia, anche
          avvicinandoti agli altari.
        </p>
        <div className="class-grid">
          {CLASS_IDS.map((c) => {
            const info = CLASSES[c];
            const holder = holderOf(c);
            const takenByOther = holder !== null && holder !== selfId;
            return (
              <button
                key={c}
                className={`class-card${mine === c ? ' selected' : ''}${takenByOther ? ' taken' : ''}`}
                style={{ '--cls': info.color } as React.CSSProperties}
                disabled={takenByOther}
                onClick={() => pick(c)}
              >
                <div className="class-icon">
                  <Icon name={`classe-${c}`} size={44} />
                </div>
                <div className="class-name">{info.name}</div>
                <div className="class-role">{info.role}</div>
                <ul className="class-abilities">
                  {info.abilities.map((a, i) => (
                    <li key={a}>
                      <kbd>{'QER'[i]}</kbd> {a}
                    </li>
                  ))}
                  <li>
                    <kbd>F</kbd> {info.ultra}
                  </li>
                </ul>
                <div className="class-status">
                  {mine === c ? 'La tua classe' : takenByOther ? `Scelta da ${nameOf(holder!)}` : 'Libera'}
                </div>
              </button>
            );
          })}
        </div>
        <p className="muted small-text">
          La Ultra si carica colpendo, subendo danni e curando. La classe si cambia al Crocevia, tra una Frattura e l’altra.
        </p>
        <div className="modal-actions">
          <button onClick={() => setGame({ classPicker: false })}>{mine ? 'Al Crocevia' : 'Scegli più tardi'}</button>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const settings = useGame((s) => s.settings);
  const qualities: Quality[] = ['bassa', 'media', 'alta'];
  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && setGame({ settingsOpen: false })}>
      <div className="modal">
        <h2>Impostazioni</h2>
        <label className="row">
          <span>Qualità grafica</span>
          <div className="seg">
            {qualities.map((q) => (
              <button key={q} className={settings.quality === q ? 'on' : ''} onClick={() => updateSettings({ quality: q })}>
                {q}
              </button>
            ))}
          </div>
        </label>
        <label className="row">
          <span>Sensibilità visuale</span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.1}
            value={settings.sensitivity}
            onChange={(e) => updateSettings({ sensitivity: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>Volume dei suoni</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.sound}
            onChange={(e) => updateSettings({ sound: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          <span>Scossa della telecamera sui colpi forti</span>
          <input type="checkbox" checked={settings.shake} onChange={(e) => updateSettings({ shake: e.target.checked })} />
        </label>
        <label className="row">
          <span>Controlli touch</span>
          <div className="seg">
            {(['auto', 'on', 'off'] as const).map((t) => (
              <button key={t} className={settings.touch === t ? 'on' : ''} onClick={() => updateSettings({ touch: t })}>
                {t === 'auto' ? 'auto' : t === 'on' ? 'sì' : 'no'}
              </button>
            ))}
          </div>
        </label>
        <label className="row">
          <span>Mira automatica (sul telefono è sempre attiva)</span>
          <input type="checkbox" checked={settings.autoAim} onChange={(e) => updateSettings({ autoAim: e.target.checked })} />
        </label>
        <label className="row">
          <span>Statistiche di rete e FPS</span>
          <input type="checkbox" checked={settings.showStats} onChange={(e) => updateSettings({ showStats: e.target.checked })} />
        </label>
        <div className="modal-actions">
          <button onClick={() => setGame({ settingsOpen: false })}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

function HelpPanel({ touch }: { touch: boolean }) {
  const rows: [string, string, string][] = [
    ['Muoversi', 'WASD', 'Joystick a sinistra'],
    ['Telecamera', 'Mouse (clicca per catturarlo)', 'Trascina a destra'],
    ['Attacco', 'Click sinistro', 'Pulsante grande'],
    ['Schivata', 'Spazio', 'Pulsante sopra l’attacco'],
    ['Abilità 1–3', 'Q, E, R', 'Tre pulsanti ad arco'],
    ['Ultra', 'F', 'Pulsante che si illumina quando è carica'],
    ['Interagire', INTERACT_KEY_LABEL, 'Pulsante che compare vicino'],
    ['Ping “guarda qui”', 'Click centrale', 'Doppio tocco sul mondo'],
    ['Emote', '1 2 3 4', 'Pulsante emote'],
    ['Classe', 'C', 'Pulsante Classe in alto'],
    ['Personaggio e talenti', 'P', 'Pulsante 👤'],
    ['Zaino', 'I', 'Pulsante 🎒'],
    ['Pozione', 'H', 'Pulsante 🧪'],
    ['Zoom', 'Rotella', '—'],
  ];
  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && setGame({ helpOpen: false })}>
      <div className="modal">
        <h2>Comandi</h2>
        <table className="controls">
          <thead>
            <tr>
              <th>Azione</th>
              <th className={touch ? '' : 'hl'}>PC</th>
              <th className={touch ? 'hl' : ''}>Telefono</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([a, pc, ph]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>{pc}</td>
                <td>{ph}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small-text">
          Emote: {EMOTES.map((e) => `${e.icon} ${e.label}`).join(' · ')}. La chat vocale non è nel gioco: usate una
          videochiamata o Discord.
        </p>
        <div className="modal-actions">
          <button onClick={() => setGame({ helpOpen: false })}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

function OrientationHint() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="orientation-hint" onClick={() => setDismissed(true)}>
      Gira il telefono in orizzontale per giocare meglio ↻
    </div>
  );
}
