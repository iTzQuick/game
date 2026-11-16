import { lazy, Suspense, useEffect } from 'react';
import { leaveRoom } from './game/session';
import { useGame } from './game/store';
import { Menu } from './ui/Menu';
import { initAccount } from './progress/store';

void initAccount();

// Il gioco 3D (three.js + fisica) è pesante: si carica a parte, così il menu
// si apre subito anche sul telefono.
const loadGame = () => import('./game/Game');
const Game = lazy(() => loadGame().then((m) => ({ default: m.Game })));

export function App() {
  const screen = useGame((s) => s.screen);
  const status = useGame((s) => s.room.status);

  // Se la stanza ci butta fuori (piena o connessione persa) si torna al menu.
  useEffect(() => {
    if (screen === 'game' && (status === 'full' || status === 'error')) leaveRoom();
  }, [screen, status]);

  // Inizia a scaricare il gioco mentre si scrive il nome.
  useEffect(() => {
    void loadGame();
  }, []);

  return screen === 'game' ? (
    <Suspense fallback={<div className="menu"><div className="loading">Il Crocevia ti sta forgiando…</div></div>}>
      <Game />
    </Suspense>
  ) : (
    <Menu />
  );
}
