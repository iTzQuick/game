// Gli altri giocatori: posizioni interpolate ed eventi (attacchi, schivate,
// emote, ping) ricevuti dalla rete.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CLASSES, NET } from '../game/constants';
import { addPing, getGame, showEmote, useGame } from '../game/store';
import { spawnSlash } from '../fx/effects';
import { remoteBolt } from '../combat/abilities';
import { combat } from '../combat/runtime';
import { onCombat } from '../combat/bus';
import { abilityMove } from './moves';
import { getRoom } from '../net/room';
import { Avatar, newPose, tickPose, type Pose } from './Avatar';
import { NEUTRAL } from './materials';

const poses = new Map<string, Pose>();
const poseOf = (id: string) => {
  let p = poses.get(id);
  if (!p) {
    p = newPose();
    poses.set(id, p);
  }
  return p;
};

export function RemotePlayers() {
  const selfId = useGame((s) => s.selfId);
  const members = useGame((s) => s.room.members);
  const others = members.filter((m) => m.id !== selfId);

  // Eventi dalla rete → effetti e animazioni.
  // le abilità degli altri: anche il loro corpo fa il movimento dell'abilità
  useEffect(
    () =>
      onCombat((from, msg) => {
        if (msg.t !== 'ab' || from === getGame().selfId) return;
        const pose = poseOf(from);
        pose.attackT = 0;
        pose.attackN = 1;
        pose.attackStyle = abilityMove(msg.cls, msg.a);
      }),
    [],
  );

  useEffect(() => {
    const room = getRoom();
    if (!room) return;
    return room.onEvent((from, ev) => {
      const cls = getGame().room.classes[from];
      const color = cls ? CLASSES[cls].color : NEUTRAL;
      const pose = poseOf(from);
      switch (ev.t) {
        case 'act':
          if (ev.a === 'attack') {
            pose.attackT = 0;
            pose.attackN = ev.n;
            pose.attackStyle = cls && CLASSES[cls].ranged ? 'shoot' : 'swing';
            if (cls && CLASSES[cls].ranged) remoteBolt(cls, ev.p, ev.r);
            else spawnSlash(ev.p, ev.r, color, ev.n);
          } else {
            pose.dodgeT = 0;
          }
          break;
        case 'emote':
          showEmote(from, ev.e);
          if (ev.e === 0) pose.waveT = 0;
          break;
        case 'ping':
          addPing(from, ev.p, color);
          break;
      }
    });
  }, []);

  return (
    <>
      {others.map((m) => (
        <RemotePlayer key={m.id} id={m.id} name={m.name} />
      ))}
    </>
  );
}

function RemotePlayer({ id, name }: { id: string; name: string }) {
  const classId = useGame((s) => s.room.classes[id] ?? null);
  const group = useRef<THREE.Group>(null);
  const pose = useMemo(() => poseOf(id), [id]);

  useEffect(() => {
    poses.set(id, pose);
    return () => void poses.delete(id);
  }, [id, pose]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = group.current;
    if (!g) return;
    const buf = getRoom()?.remotes.get(id);
    const s = buf?.sample(performance.now() - NET.interpDelayMs);
    if (!s) {
      g.visible = false; // non abbiamo ancora ricevuto la sua posizione
      return;
    }
    g.visible = true;
    g.position.set(s.p[0], s.p[1], s.p[2]);
    g.rotation.y = s.r;
    pose.speed = s.s;
    pose.anim = s.a;
    pose.flags = getRoom()?.vitals.get(id)?.f ?? 0;
    combat.renderPos.set(id, { x: s.p[0], y: s.p[1], z: s.p[2] });
    tickPose(pose, dt);
  });

  return (
    <group ref={group} visible={false}>
      <Avatar pose={pose} classId={classId} playerId={id} name={name} />
    </group>
  );
}
