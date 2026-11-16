// Prova end-to-end del multigiocatore in un browser headless.
// Apre fino a 5 giocatori in modalità locale (schede dello stesso browser) e
// controlla: ingresso, host, limite di 4, classi uniche, movimento
// sincronizzato, passaggio dell'host, e il collegamento WebRTC peer-to-peer.
//
// Uso: npm run build && npm run test:e2e
// Variabili: SHOTS_DIR=cartella per gli screenshot (default test-results)
//
// Nota: qui il 3D è disegnato dalla CPU (niente GPU), quindi le finestre sono
// piccole per non soffocare il processore; lo screenshot si fa a 1280×720.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || 'test-results';
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failures = 0;

function check(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
}

async function startServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return proc;
    } catch {
      /* non ancora pronto */
    }
    await sleep(250);
  }
  proc.kill();
  throw new Error('vite preview non è partito');
}

async function openPlayer(context, name, { code, quality = 'bassa', extra = {} } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 480, height: 270 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`);
  });
  await page.addInitScript((q) => {
    localStorage.setItem('fratture.settings', JSON.stringify({ quality: q, touch: 'off' }));
  }, quality);
  const q = new URLSearchParams({ rete: 'locale', ...extra });
  if (code) q.set('stanza', code);
  await page.goto(`${BASE}?${q}`);
  await page.fill('input[placeholder="Come ti chiamano?"]', name);
  if (code) await page.click('button:has-text("Entra")');
  else await page.click('button:has-text("Crea una partita")');
  return page;
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__fratture.getGame();
    return {
      status: s.room.status,
      code: s.room.code,
      hostId: s.room.hostId,
      selfId: s.selfId,
      members: s.room.members.map((m) => m.name),
      classes: s.room.classes,
      error: s.room.error,
      peers: s.room.peers,
      screen: s.screen,
    };
  });

const waitJoined = (page) =>
  page.waitForFunction(() => window.__fratture.getGame().room.status === 'joined' && window.__fratture.local, null, {
    timeout: 20000,
  });

const waitMembers = (page, n) =>
  page.waitForFunction((k) => window.__fratture.getGame().room.members.length === k, n, { timeout: 15000 });

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  try {
    // ---------------- 4 giocatori, modalità locale ----------------
    const ctx = await browser.newContext();
    const A = await openPlayer(ctx, 'Ada');
    await waitJoined(A);
    const sa = await state(A);
    check(/^[A-Z2-9]{4}$/.test(sa.code), `stanza creata con codice ${sa.code}`);
    check(sa.hostId === sa.selfId, 'chi crea la partita è l’host');

    const B = await openPlayer(ctx, 'Bruno', { code: sa.code, quality: 'media' });
    const C = await openPlayer(ctx, 'Cleo', { code: sa.code });
    const D = await openPlayer(ctx, 'Dario', { code: sa.code });
    await Promise.all([B, C, D].map(waitJoined));
    await Promise.all([A, B, C, D].map((p) => waitMembers(p, 4)));
    const all = await Promise.all([A, B, C, D].map(state));
    check(all.every((s) => s.members.length === 4), 'tutti vedono 4 giocatori');
    check(all.every((s) => s.hostId === sa.selfId), 'tutti concordano sull’host (Ada)');

    // quinto giocatore: stanza piena
    const E = await openPlayer(ctx, 'Elio', { code: sa.code });
    await E.waitForSelector('.error', { timeout: 15000 });
    const eText = await E.textContent('.error');
    check(/piena/i.test(eText ?? ''), `il quinto giocatore resta fuori: "${eText}"`);
    await E.close();
    await sleep(1200);
    check((await state(A)).members.length === 4, 'dopo il rifiuto la stanza ha ancora 4 giocatori');

    // ---------------- classi uniche ----------------
    await A.click('.class-card:has-text("Guardiano")');
    await Promise.all(
      [A, B, C, D].map((p) =>
        p.waitForFunction((id) => window.__fratture.getGame().room.classes[id] === 'guardiano', sa.selfId, { timeout: 8000 }),
      ),
    );
    check(true, 'Ada sceglie il Guardiano e tutti lo vedono');
    const disabled = await B.locator('.class-card:has-text("Guardiano")').isDisabled();
    check(disabled, 'per Bruno il Guardiano è bloccato (già preso)');
    // anche forzando la richiesta, l'host la rifiuta
    await B.evaluate(() => window.__fratture.getRoom().requestClass('guardiano'));
    await sleep(1500);
    const sbId = (await state(B)).selfId;
    check((await state(A)).classes[sbId] !== 'guardiano', 'l’host rifiuta un Guardiano doppio');
    await B.click(`.class-card:has-text("Lama d'Ombra")`);
    await C.click('.class-card:has-text("Tessitore")');
    await D.click('.class-card:has-text("Custode")');
    await Promise.all(
      [A, B, C, D].map((p) =>
        p.waitForFunction(() => Object.keys(window.__fratture.getGame().room.classes).length === 4, null, { timeout: 8000 }),
      ),
    );
    const cls = (await state(C)).classes;
    check(new Set(Object.values(cls)).size === 4, `4 classi tutte diverse: ${Object.values(cls).join(', ')}`);

    // chiude il pannello classi e si muove
    for (const p of [A, B, C, D]) await p.keyboard.press('Escape');
    await sleep(500);

    // ---------------- movimento sincronizzato ----------------
    const before = await B.evaluate(() => ({ ...window.__fratture.local.pos }));
    await B.keyboard.down('w');
    await B.keyboard.down('d');
    await sleep(2000);
    await B.keyboard.up('w');
    await B.keyboard.up('d');
    await sleep(600);
    const after = await B.evaluate(() => ({ ...window.__fratture.local.pos }));
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    check(moved > 3, `Bruno si muove (${moved.toFixed(2)} m)`);
    const seen = await A.evaluate((id) => window.__fratture.getRoom().remotes.get(id)?.latest?.p, sbId);
    const err = seen ? Math.hypot(seen[0] - after.x, seen[2] - after.z) : Infinity;
    check(err < 0.1, `Ada vede Bruno nella stessa posizione (scarto ${err.toFixed(3)} m)`);

    // un po' di azione per lo screenshot
    await D.keyboard.down('a');
    await sleep(700);
    await D.keyboard.up('a');
    await B.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' })));
    await C.keyboard.press('Space');
    await B.setViewportSize({ width: 1280, height: 720 });
    await sleep(900);
    await B.screenshot({ path: `${SHOTS}/crocevia-4-giocatori.png` });
    await B.setViewportSize({ width: 480, height: 270 });

    // emote e ping arrivano agli altri
    await A.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' }));
    });
    await B.waitForFunction((id) => !!window.__fratture.getGame().emotes[id], sa.selfId, { timeout: 5000 }).then(
      () => check(true, 'l’emote di Ada arriva a Bruno'),
      () => check(false, 'l’emote di Ada arriva a Bruno'),
    );

    // ---------------- l'host esce ----------------
    await A.close({ runBeforeUnload: true });
    await Promise.all([B, C, D].map((p) => waitMembers(p, 3)));
    const hostOk = await Promise.all(
      [B, C, D].map((p) => p.waitForFunction((id) => window.__fratture.getGame().room.hostId === id, sbId, { timeout: 8000 })),
    ).then(
      () => true,
      () => false,
    );
    check(hostOk, 'Ada esce: l’host passa a Bruno, per tutti');
    if (!hostOk) {
      for (const p of [B, C, D]) {
        const st = await state(p);
        const mem = await p.evaluate(() => window.__fratture.getRoom().admittedIds);
        console.log('   ', st.selfId, 'host', st.hostId, 'members', st.members.join(','), mem.join(','));
      }
      console.log('    atteso host', sbId);
    }
    await Promise.all(
      [B, C, D].map((p) =>
        p
          .waitForFunction(() => !Object.values(window.__fratture.getGame().room.classes).includes('guardiano'), null, { timeout: 5000 })
          .catch(() => {}),
      ),
    );
    const after3 = await Promise.all([B, C, D].map(state));
    check(after3.every((s) => !Object.values(s.classes).includes('guardiano')), 'il Guardiano di Ada torna libero');
    check(after3.every((s) => s.status === 'joined'), 'la partita continua senza interruzioni');

    // un nuovo arrivato può prendere il Guardiano
    const F = await openPlayer(ctx, 'Fede', { code: sa.code });
    await waitJoined(F);
    await F.click('.class-card:has-text("Guardiano")');
    const fId = (await state(F)).selfId;
    await B.waitForFunction((id) => window.__fratture.getGame().room.classes[id] === 'guardiano', fId, { timeout: 8000 }).then(
      () => check(true, 'chi entra dopo prende la classe liberata (nuovo host la approva)'),
      () => check(false, 'chi entra dopo prende la classe liberata (nuovo host la approva)'),
    );
    await ctx.close();

    // ---------------- WebRTC peer-to-peer ----------------
    const ctx2 = await browser.newContext();
    const P = await openPlayer(ctx2, 'Pia', { extra: { p2p: '1' } });
    await waitJoined(P);
    const code2 = (await state(P)).code;
    const Q = await openPlayer(ctx2, 'Quinto', { code: code2, extra: { p2p: '1' } });
    await waitJoined(Q);
    const linked = await P.waitForFunction(
      () => Object.values(window.__fratture.getGame().room.peers).some((p) => p.link === 'p2p'),
      null,
      { timeout: 20000 },
    ).then(
      () => true,
      () => false,
    );
    check(linked, 'collegamento WebRTC peer-to-peer aperto');
    await Q.keyboard.press('Escape');
    await Q.keyboard.down('w');
    await sleep(1000);
    await Q.keyboard.up('w');
    await sleep(2500);
    const st = await Q.evaluate(() => ({ ...window.__fratture.getRoom().stats }));
    check(st.sentP2P > st.sentRelay * 3, `le posizioni viaggiano in P2P (P2P ${st.sentP2P}, relay ${st.sentRelay})`);
    const rtt = await P.evaluate(() => Object.values(window.__fratture.getGame().room.peers)[0]?.rtt);
    check(typeof rtt === 'number', `latenza misurata: ${rtt} ms`);
    await ctx2.close();
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
