// Prova della modalità ONLINE vera: presenza e segnalazione su Supabase,
// collegamento diretto WebRTC tra i giocatori. Tre browser separati (come tre
// dispositivi), sullo stesso computer.
//
// Uso: npm run build && npm run test:online   (serve .env.production configurato)

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4186;
const BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};
const g = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = (page, fn, arg, timeout = 15000) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return proc;
    } catch {
      /* non ancora pronto */
    }
    await sleep(250);
  }
  proc.kill();
  throw new Error('vite preview non è partito');
}

async function player(browser, name, code) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  await page.addInitScript(() => localStorage.setItem('fratture.settings', JSON.stringify({ quality: 'bassa', touch: 'off' })));
  await page.goto(code ? `${BASE}?stanza=${code}` : BASE);
  await page.fill('input[placeholder="Come ti chiamano?"]', name);
  await page.click(code ? 'button:has-text("Entra")' : 'button:has-text("Crea una partita")');
  const ok = await waitFor(page, () => window.__fratture.getGame().room.status === 'joined' && !!window.__fratture.local?.teleport, null, 30000);
  if (!ok) {
    const err = await g(page, () => window.__fratture.getGame().room.error);
    throw new Error(`${name} non è entrato: ${err ?? 'timeout'}`);
  }
  return page;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  try {
    const A = await player(browser, 'Ada');
    const mode = await g(A, () => window.__fratture.getGame().room.mode);
    check(mode === 'online', `modalità ${mode} (Supabase configurato)`);
    const code = await g(A, () => window.__fratture.getGame().room.code);
    const B = await player(browser, 'Bruno', code);
    const C = await player(browser, 'Cleo', code);
    const all = [A, B, C];
    const seen = await Promise.all(all.map((p) => waitFor(p, () => window.__fratture.getGame().room.members.length === 3)));
    check(seen.every(Boolean), 'tre browser separati si trovano nella stessa stanza via Supabase');
    const hosts = await Promise.all(all.map((p) => g(p, () => window.__fratture.getGame().room.hostId)));
    check(new Set(hosts).size === 1, 'tutti concordano sull’host');

    const p2p = await Promise.all(
      all.map((p) =>
        waitFor(p, () => {
          const peers = Object.values(window.__fratture.getGame().room.peers);
          return peers.length === 2 && peers.every((x) => x.link === 'p2p');
        }, null, 25000),
      ),
    );
    check(p2p.every(Boolean), 'collegamento diretto WebRTC tra tutti i giocatori');
    await sleep(2500);
    const rtts = await g(A, () => Object.values(window.__fratture.getGame().room.peers).map((p) => p.rtt));
    check(rtts.every((r) => typeof r === 'number'), `latenza misurata: ${rtts.join(' / ')} ms`);

    // classi e movimento
    await A.click('.class-card:has-text("Guardiano")');
    await B.click(`.class-card:has-text("Lama d'Ombra")`);
    await C.click('.class-card:has-text("Custode")');
    const classes = await Promise.all(all.map((p) => waitFor(p, () => Object.keys(window.__fratture.getGame().room.classes).length === 3)));
    check(classes.every(Boolean), 'classi scelte e viste da tutti');
    for (const p of all) await p.keyboard.press('Escape');
    const bId = await g(B, () => window.__fratture.getGame().selfId);
    await B.keyboard.down('w');
    await sleep(1500);
    await B.keyboard.up('w');
    await sleep(800);
    const bPos = await g(B, () => ({ ...window.__fratture.local.pos }));
    const seenByA = await g(A, (id) => window.__fratture.getRoom().remotes.get(id)?.latest?.p, bId);
    const err = seenByA ? Math.hypot(seenByA[0] - bPos.x, seenByA[2] - bPos.z) : Infinity;
    check(err < 0.15, `Ada vede Bruno dove è davvero (scarto ${err.toFixed(3)} m)`);

    // Frattura
    await g(C, () => window.__fratture.runRequest('start'));
    const opened = await Promise.all(all.map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 15000)));
    check(opened.every(Boolean), 'la Frattura si apre per tutti');
    await sleep(600);
    for (const p of all) {
      await g(p, () => {
        const r = window.__fratture.combat.dungeon.rooms[1];
        window.__fratture.local.teleport(r.doorSouthX, r.rect.z1 - 3);
      });
    }
    const enemies = await Promise.all(all.map((p) => waitFor(p, () => window.__fratture.combat.enemies.size > 0)));
    check(enemies.every(Boolean), 'i nemici dell’host arrivano a tutti');
    await sleep(1000);
    const hpBefore = await g(A, () => [...window.__fratture.combat.enemies.values()].reduce((s, e) => s + e.hp, 0));
    await g(B, () => {
      const c = window.__fratture.combat;
      for (const e of c.enemies.values()) c.queueHit({ e: e.id, d: 15 });
    });
    await sleep(1500);
    const hpAfter = await g(A, () => [...window.__fratture.combat.enemies.values()].reduce((s, e) => s + e.hp, 0));
    check(hpAfter < hpBefore, `i colpi arrivano all’host e tutti vedono la vita scendere (${hpBefore} → ${hpAfter})`);
    const relay = await Promise.all(all.map((p) => g(p, () => window.__fratture.getRoom().stats.sentRelay)));
    const direct = await Promise.all(all.map((p) => g(p, () => window.__fratture.getRoom().stats.sentP2P)));
    check(true, `messaggi in diretta ${direct.join('/')}, passati da Supabase ${relay.join('/')}`);
    await g(A, () => window.__fratture.runRequest('abandon'));
    await sleep(500);
  } finally {
    await browser.close();
    server.kill();
  }
  const relevant = errors.filter((e) => !/favicon|WebGL|GPU stall|ReadPixels/i.test(e));
  check(relevant.length === 0, `nessun errore JavaScript${relevant.length ? ':\n  ' + relevant.join('\n  ') : ''}`);
  console.log(failures ? `\n${failures} controlli falliti` : '\nTutti i controlli superati');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
