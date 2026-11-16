import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getGame, useGame } from './game/store';
import { getRoom } from './net/room';
import { getProgress, mutate } from './progress/store';
import './styles.css';

// Accesso di debug per i test automatici e la console del browser.
// (la posizione del giocatore, `local`, si aggiunge quando si carica il gioco)
declare global {
  interface Window {
    __fratture?: Record<string, unknown>;
  }
}
window.__fratture = { store: useGame, getGame, getRoom, getProgress, mutate };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
