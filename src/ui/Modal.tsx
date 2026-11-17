// Finestra dei pannelli (personaggio, zaino, base, missioni…).

import { setGame } from '../game/store';

export const closePanel = () => setGame({ panel: null });

export function Modal({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && closePanel()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="small" onClick={closePanel} aria-label="Chiudi">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
