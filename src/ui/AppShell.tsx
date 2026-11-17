// Il gioco come "app" sul telefono:
// - aperto dall'icona in Home: schermata d'apertura con il logo e solo in orizzontale;
// - alla prima apertura nel browser del telefono: come aggiungerlo alla Home.

import { useEffect, useState } from 'react';
import { isTouchDevice } from '../game/store';

const BASE = import.meta.env.BASE_URL;
const HINT_KEY = 'fratture.installa';

/** Aperto dall'icona in Home (o installato su Android), non in una scheda del browser. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    false
  );
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function readSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === 'visto';
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(HINT_KEY, 'visto');
  } catch {
    /* ignorato */
  }
}

/** Evento di Chrome su Android: permette di mostrare la richiesta d'installazione da un pulsante. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}
let deferred: InstallPrompt | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
  });
}

/** Schermata d'apertura (solo dall'icona in Home) e blocco in orizzontale. */
export function AppShell() {
  const standalone = isStandalone();
  const [splash, setSplash] = useState(standalone);
  useEffect(() => {
    if (!standalone) return;
    document.documentElement.classList.add('standalone');
    // su Android il blocco funziona; su iPhone no (lo copre la schermata "gira il telefono")
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
    const t = setTimeout(() => setSplash(false), 1900);
    return () => clearTimeout(t);
  }, [standalone]);
  if (!standalone) return null;
  return (
    <>
      {splash && (
        <div className="app-splash" aria-hidden>
          <img src={`${BASE}ui/app/icona-512.png`} alt="" className="app-splash-icon" />
          <img src={`${BASE}ui/logo.webp`} alt="Le Fratture" className="app-splash-logo" />
        </div>
      )}
      <div className="rotate-lock" role="alert">
        <div className="rotate-phone" aria-hidden />
        <b>Gira il telefono</b>
        <span>Le Fratture si gioca in orizzontale.</span>
      </div>
    </>
  );
}

/** Alla prima apertura nel browser del telefono: come salvare il gioco nella Home. */
export function InstallHint() {
  const [open, setOpen] = useState(() => !isStandalone() && isTouchDevice() && !readSeen());
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  useEffect(() => {
    if (!open) return;
    const on = () => setCanPrompt(!!deferred);
    window.addEventListener('beforeinstallprompt', on);
    const t = setTimeout(on, 1500);
    return () => {
      window.removeEventListener('beforeinstallprompt', on);
      clearTimeout(t);
    };
  }, [open]);
  if (!open) return null;
  const close = () => {
    markSeen();
    setOpen(false);
  };
  const ios = isIOS();
  return (
    <div className="modal-wrap install-wrap" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal install-hint">
        <div className="install-head">
          <img src={`${BASE}ui/app/icona-192.png`} alt="" width={56} height={56} />
          <div>
            <b>Mettilo nella Home</b>
            <span>Si apre a tutto schermo, in orizzontale, come un’app.</span>
          </div>
        </div>
        {ios ? (
          <ol>
            <li>
              Tocca <ShareIcon /> <b>Condividi</b> (in basso in Safari, o in alto vicino all’indirizzo)
            </li>
            <li>
              Scorri e scegli <PlusIcon /> <b>Aggiungi alla schermata Home</b>
            </li>
            <li>
              Tocca <b>Aggiungi</b>, poi apri Le Fratture dall’icona
            </li>
          </ol>
        ) : canPrompt ? (
          <p>Basta un tocco: il telefono ti chiede di installarlo.</p>
        ) : (
          <ol>
            <li>
              Tocca il menu <b>⋮</b> del browser, in alto a destra
            </li>
            <li>
              Scegli <b>Aggiungi a schermata Home</b> (o <b>Installa app</b>)
            </li>
            <li>Apri Le Fratture dall’icona</li>
          </ol>
        )}
        <div className="modal-actions spread">
          <button onClick={close}>Non ora</button>
          {!ios && canPrompt ? (
            <button
              className="primary"
              onClick={() => {
                void deferred?.prompt();
                deferred = null;
                close();
              }}
            >
              Installa
            </button>
          ) : (
            <button className="primary" onClick={close}>
              Ho capito
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Il tasto Condividi di iPhone: un quadrato con la freccia in su. */
function ShareIcon() {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" width="20" height="20" aria-label="Condividi">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" width="20" height="20" aria-label="Aggiungi">
      <rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
