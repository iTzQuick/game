// Input unificato: tastiera e mouse su PC, joystick e pulsanti su telefono.
// Il ciclo di gioco legge da qui a ogni frame.

import { INTERACT_KEY } from './constants';
import { controlsBlocked, getGame, setGame } from './store';

export type Action =
  | 'attack'
  | 'dodge'
  | 'interact'
  | 'abQ'
  | 'abE'
  | 'abR'
  | 'abF'
  | 'potion'
  | 'emote0'
  | 'emote1'
  | 'emote2'
  | 'emote3';

export const input = {
  keys: new Set<string>(),
  joy: { x: 0, y: 0 },
  look: { dx: 0, dy: 0 },
  zoom: 0,
  pressed: new Set<Action>(),
  /** Richiesta di ping in coordinate schermo normalizzate (-1..1). */
  ping: null as { x: number; y: number } | null,
};

export function press(a: Action) {
  input.pressed.add(a);
}

export function consume(a: Action): boolean {
  return input.pressed.delete(a);
}

export function requestPing(x: number, y: number) {
  input.ping = { x, y };
}

/** Direzione di movimento (x = destra, y = avanti), lunghezza massima 1. */
export function moveVector(): { x: number; y: number } {
  if (controlsBlocked()) return { x: 0, y: 0 };
  const k = input.keys;
  let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  x += input.joy.x;
  y += input.joy.y;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

export function consumeLook(): { dx: number; dy: number } {
  const l = { ...input.look };
  input.look.dx = 0;
  input.look.dy = 0;
  return l;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** Collega tastiera e mouse alla finestra e al canvas. Restituisce la funzione di pulizia. */
export function installDesktopInput(canvas: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const s = getGame();
    if (e.code === 'Escape') {
      if (s.classPicker || s.settingsOpen || s.helpOpen || s.dialog || s.panel) {
        setGame({ classPicker: false, settingsOpen: false, helpOpen: false, dialog: null, panel: null });
      }
      return;
    }
    if ((e.code === 'KeyP' || e.code === 'KeyI') && !e.repeat) {
      const want = e.code === 'KeyP' ? 'personaggio' : 'zaino';
      setGame({ panel: s.panel === want ? null : want, classPicker: false });
      if (s.panel !== want) document.exitPointerLock?.();
      return;
    }
    if (e.code === 'KeyC' && !e.repeat) {
      setGame({ classPicker: !s.classPicker });
      if (!s.classPicker) document.exitPointerLock?.();
      return;
    }
    if (controlsBlocked()) {
      if ((e.code === 'Space' || e.code === 'Enter' || e.code === INTERACT_KEY) && s.dialog && !e.repeat) {
        e.preventDefault();
        press('interact');
      }
      return;
    }
    input.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      press('dodge');
    } else if (e.code === INTERACT_KEY) press('interact');
    else if (e.code === 'KeyQ') press('abQ');
    else if (e.code === 'KeyE') press('abE');
    else if (e.code === 'KeyR') press('abR');
    else if (e.code === 'KeyF') press('abF');
    else if (e.code === 'KeyH') press('potion');
    else if (e.code >= 'Digit1' && e.code <= 'Digit4') press(`emote${Number(e.code.slice(5)) - 1}` as Action);
  };
  const onKeyUp = (e: KeyboardEvent) => input.keys.delete(e.code);
  const onBlur = () => input.keys.clear();

  const onMouseDown = (e: MouseEvent) => {
    if (controlsBlocked()) return;
    const locked = document.pointerLockElement === canvas;
    if (e.button === 1) {
      e.preventDefault();
      if (locked) requestPing(0, 0);
      else {
        const r = canvas.getBoundingClientRect();
        requestPing(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      }
      return;
    }
    if (e.button !== 0) return;
    if (!locked) {
      // Il primo click cattura il mouse per la telecamera.
      void canvas.requestPointerLock?.()?.catch?.(() => {});
      return;
    }
    press('attack');
  };
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    input.look.dx += e.movementX;
    input.look.dy += e.movementY;
  };
  const onWheel = (e: WheelEvent) => {
    input.zoom += Math.sign(e.deltaY);
  };
  const onLockChange = () => setGame({ pointerLocked: document.pointerLockElement === canvas });
  const onAux = (e: MouseEvent) => e.button === 1 && e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('auxclick', onAux);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('auxclick', onAux);
    canvas.removeEventListener('wheel', onWheel);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
    input.keys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  };
}
