// Controlli per il telefono: joystick virtuale a sinistra, visuale trascinando
// a destra, pulsanti d'azione in basso a destra. Doppio tocco = ping.

import { useEffect, useRef } from 'react';
import { EMOTES } from '../game/constants';
import { input, press, requestPing } from '../game/input';
import { setGame, useGame } from '../game/store';
import { CLASSES } from '../game/constants';
import { abilityState } from '../combat/abilities';
import { SLOTS, abilityName, usePoll } from './CombatHud';
import { combat } from '../combat/runtime';

const JOY_RADIUS = 56;
const TOUCH_LOOK = 2.2;

export function TouchControls() {
  const layer = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const prompt = useGame((s) => s.prompt);
  const emoteWheel = useGame((s) => s.emoteWheel);
  const blocked = useGame((s) => s.dialog !== null || s.classPicker || s.settingsOpen || s.helpOpen);

  useEffect(() => {
    const el = layer.current!;
    let joyId: number | null = null;
    let joyOrigin = { x: 0, y: 0 };
    let lookId: number | null = null;
    let last = { x: 0, y: 0 };
    let down = { x: 0, y: 0, t: 0 };
    let lastTap = { x: -999, y: -999, t: 0 };

    const showJoy = (x: number, y: number, kx: number, ky: number, on: boolean) => {
      const b = base.current!;
      const k = knob.current!;
      b.style.opacity = on ? '1' : '0.35';
      b.style.transform = `translate(${x - JOY_RADIUS}px, ${y - JOY_RADIUS}px)`;
      k.style.transform = `translate(${kx}px, ${ky}px)`;
    };
    const restJoy = () => {
      const r = el.getBoundingClientRect();
      showJoy(r.left + 110, r.bottom - 120, 0, 0, false);
    };
    restJoy();

    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      const leftSide = e.clientX < window.innerWidth * 0.42;
      if (leftSide && joyId === null) {
        joyId = e.pointerId;
        joyOrigin = { x: e.clientX, y: e.clientY };
        showJoy(e.clientX, e.clientY, 0, 0, true);
      } else if (lookId === null) {
        lookId = e.pointerId;
        last = { x: e.clientX, y: e.clientY };
        down = { x: e.clientX, y: e.clientY, t: performance.now() };
      } else return;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === joyId) {
        let dx = e.clientX - joyOrigin.x;
        let dy = e.clientY - joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) {
          dx = (dx / len) * JOY_RADIUS;
          dy = (dy / len) * JOY_RADIUS;
        }
        input.joy.x = dx / JOY_RADIUS;
        input.joy.y = -dy / JOY_RADIUS;
        showJoy(joyOrigin.x, joyOrigin.y, dx, dy, true);
      } else if (e.pointerId === lookId) {
        input.look.dx += (e.clientX - last.x) * TOUCH_LOOK;
        input.look.dy += (e.clientY - last.y) * TOUCH_LOOK;
        last = { x: e.clientX, y: e.clientY };
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === joyId) {
        joyId = null;
        input.joy.x = 0;
        input.joy.y = 0;
        restJoy();
      } else if (e.pointerId === lookId) {
        lookId = null;
        const now = performance.now();
        const isTap = now - down.t < 250 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14;
        if (isTap) {
          if (now - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
            const r = el.getBoundingClientRect();
            requestPing(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
            lastTap = { x: -999, y: -999, t: 0 };
          } else lastTap = { x: e.clientX, y: e.clientY, t: now };
        }
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', restJoy);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', restJoy);
      input.joy.x = 0;
      input.joy.y = 0;
    };
  }, []);

  const btn = (action: Parameters<typeof press>[0]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    press(action);
  };

  return (
    <div className={`touch-layer${blocked ? ' hidden' : ''}`} ref={layer}>
      <div className="joy-base" ref={base}>
        <div className="joy-knob" ref={knob} />
      </div>
      <div className="action-cluster">
        {prompt && (
          <button className="tbtn interact" onPointerDown={btn('interact')}>
            {prompt.label}
          </button>
        )}
        <button className="tbtn dodge" onPointerDown={btn('dodge')} aria-label="Schivata">
          ⤳
        </button>
        <button className="tbtn attack" onPointerDown={btn('attack')} aria-label="Attacco">
          ⚔
        </button>
        <AbilityButtons />
        <PotionButton />
        <button
          className="tbtn emote"
          onPointerDown={(e) => {
            e.stopPropagation();
            setGame((s) => ({ emoteWheel: !s.emoteWheel }));
          }}
          aria-label="Emote"
        >
          ☺
        </button>
        {emoteWheel && (
          <div className="emote-wheel">
            {EMOTES.map((em) => (
              <button
                key={em.id}
                className="tbtn small"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  press(`emote${em.id}` as 'emote0');
                  setGame({ emoteWheel: false });
                }}
              >
                {em.icon}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tre pulsanti ad arco per Q, E, R e il pulsante della Ultra che si illumina quando è carica. */
function AbilityButtons() {
  usePoll(120);
  const cls = useGame((s) => s.room.classes[s.selfId] ?? null);
  if (!cls) return null;
  const now = performance.now();
  return (
    <>
      {SLOTS.map((slot) => {
        const st = abilityState(cls, slot, now);
        return (
          <button
            key={slot}
            className={`tbtn ab ab-${slot}${st.ready ? ' ready' : ''}`}
            style={{ '--cls': CLASSES[cls].color, '--left': st.left } as React.CSSProperties}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              press(`ab${slot}` as 'abQ');
            }}
            aria-label={abilityName(cls, slot)}
          >
            <span className="ab-letter">{slot === 'F' ? '★' : slot}</span>
            {!st.ready && slot !== 'F' && st.seconds > 0 && <span className="ab-cd">{st.seconds}</span>}
          </button>
        );
      })}
    </>
  );
}

function PotionButton() {
  usePoll(250);
  const inRun = useGame((s) => !!s.room.run && s.room.run.phase !== 'countdown');
  if (!inRun || combat.me.potions <= 0) return null;
  return (
    <button
      className="tbtn potion"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        press('potion');
      }}
      aria-label="Pozione"
    >
      🧪
    </button>
  );
}
