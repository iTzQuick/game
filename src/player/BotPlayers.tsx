// I compagni guidati dal computer, come li vede ognuno: posizioni interpolate
// (le manda l'host), animazioni ed effetti dei loro attacchi e abilità.

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CLASSES, NET } from '../game/constants';
import { addBeam, spawnPuff, spawnRing, spawnSlash } from '../fx/effects';
import { remoteBolt } from '../combat/abilities';
import { botListVersion, botName, botViews } from '../combat/bots';
import { combat } from '../combat/runtime';
import { getRoom } from '../net/room';
import { Avatar, newPose, tickPose } from './Avatar';

export function BotPlayers() {
  const [ids, setIds] = useState<string[]>([]);
  const ver = useRef(-1);
  useFrame(() => {
    // l'host ha smesso di mandarli (fine Frattura, cambio di host): spariscono
    const now = performance.now();
    for (const [id, v] of botViews) {
      if (now - v.lastSeen > 2500) {
        botViews.delete(id);
        getRoom()?.vitals.delete(id);
        combat.renderPos.delete(id);
      }
    }
    const v = botListVersion() + botViews.size * 1000;
    if (v !== ver.current) {
      ver.current = v;
      setIds([...botViews.keys()]);
    }
  });
  return (
    <>
      {ids.map((id) => (
        <BotPlayer key={id} id={id} />
      ))}
    </>
  );
}

function BotPlayer({ id }: { id: string }) {
  const cls = botViews.get(id)?.cls ?? 'guardiano';
  const group = useRef<THREE.Group>(null);
  const pose = useMemo(newPose, []);
  const combo = useRef(1);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = group.current;
    const v = botViews.get(id);
    if (!g || !v) return;
    const s = v.buf.sample(performance.now() - NET.interpDelayMs);
    if (!s) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(s.p[0], s.p[1], s.p[2]);
    g.rotation.y = s.r;
    pose.speed = s.s;
    pose.anim = s.a;
    pose.flags = v.flags;
    combat.renderPos.set(id, { x: s.p[0], y: s.p[1], z: s.p[2] });

    const p: [number, number, number] = [s.p[0], s.p[1], s.p[2]];
    const color = CLASSES[v.cls].color;
    if (v.atk !== v.seenAtk) {
      v.seenAtk = v.atk;
      pose.attackT = 0;
      pose.attackStyle = v.style;
      pose.attackSlot = v.slot;
      if (!v.slot) {
        combo.current = (combo.current % 3) + 1;
        pose.attackN = combo.current;
        if (v.style === 'shoot') remoteBolt(v.cls, p, s.r);
        else spawnSlash(p, s.r, color, combo.current);
      } else {
        pose.attackN = 1;
        if (v.style === 'roar') spawnRing(p[0], p[2], '#ffd25a', 7, 0.6);
        else if (v.style === 'spin') for (let k = 0; k < 3; k++) spawnSlash(p, (k / 3) * Math.PI * 2, color, 2);
        else if (v.style === 'bash') spawnSlash(p, s.r, color, 3);
        else if (v.style === 'raise') spawnRing(p[0], p[2], '#ffd86b', 3, 0.5);
      }
    }
    if (v.blink !== v.seenBlink) {
      v.seenBlink = v.blink;
      spawnPuff(p[0], p[1] + 1, p[2], color);
    }
    if (v.beam !== v.seenBeam) {
      v.seenBeam = v.beam;
      if (v.beam) addBeam(id, v.beam, '#ffd86b', 1.2);
    }
    tickPose(pose, dt);
  });

  return (
    <group ref={group} visible={false}>
      <Avatar pose={pose} classId={cls} playerId={id} name={botName(cls)} />
    </group>
  );
}
