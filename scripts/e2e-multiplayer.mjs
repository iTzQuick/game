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

// ---------------- Tappa 4: la Frattura ----------------

const g = (page, fn, arg) => page.evaluate(fn, arg);
const runOf = (page) => g(page, () => window.__fratture.getGame().room.run);
const waitFor = (page, fn, arg, timeout = 10000) =>
  page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );
/** Porta il giocatore dentro una stanza della Frattura. */
const enterRoom = (page, i) =>
  g(page, (idx) => {
    const d = window.__fratture.combat.dungeon;
    const r = d.rooms[idx];
    window.__fratture.local.teleport(r.doorSouthX ?? r.cx, r.rect.z1 - 3);
  }, i);
/** Colpisce tutti i nemici visibili (come farebbero gli attacchi) per `dmg`. */
const strikeAll = (page, dmg) =>
  g(page, (d) => {
    const c = window.__fratture.combat;
    for (const e of c.enemies.values()) c.queueHit({ e: e.id, d });
  }, dmg);

async function fratturaTests(browser) {
  const ctx = await browser.newContext();
  const A = await openPlayer(ctx, 'Ada');
  await waitJoined(A);
  const code = (await state(A)).code;
  const B = await openPlayer(ctx, 'Bruno', { code });
  const C = await openPlayer(ctx, 'Cleo', { code });
  await Promise.all([B, C].map(waitJoined));
  await Promise.all([A, B, C].map((p) => waitMembers(p, 3)));
  await A.click('.class-card:has-text("Guardiano")');
  await B.click(`.class-card:has-text("Lama d'Ombra")`);
  await C.click('.class-card:has-text("Custode")');
  await Promise.all(
    [A, B, C].map((p) => p.waitForFunction(() => Object.keys(window.__fratture.getGame().room.classes).length === 3, null, { timeout: 8000 })),
  );
  for (const p of [A, B, C]) await p.keyboard.press('Escape');

  // chi non è host chiede di aprire la Frattura
  await g(B, () => window.__fratture.runRequest('start'));
  const opened = await Promise.all([A, B, C].map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 12000)));
  check(opened.every(Boolean), 'la Frattura si apre per tutti (richiesta da chi non è host)');
  await sleep(800);
  const starts = await Promise.all([A, B, C].map((p) => g(p, () => ({ ...window.__fratture.local.pos }))));
  check(starts.every((s) => Math.abs(s.z) < 8 && Math.abs(s.x) < 8), 'tutti partono dalla stanza d’ingresso');

  // si entra nella prima stanza: compaiono i nemici, uguali per tutti
  await enterRoom(A, 1);
  await enterRoom(B, 1);
  await enterRoom(C, 1);
  const spawned = await Promise.all([A, B, C].map((p) => waitFor(p, () => window.__fratture.combat.enemies.size > 0, null, 8000)));
  check(spawned.every(Boolean), 'entrando nella stanza compaiono i nemici, visti da tutti');
  await sleep(600);
  const counts = await Promise.all([A, B, C].map((p) => g(p, () => window.__fratture.combat.enemies.size)));
  check(new Set(counts).size === 1, `stesso numero di nemici per tutti (${counts.join(', ')})`);

  // un colpo di Bruno (non host) arriva all'host
  const before = await g(A, () => [...window.__fratture.director.debug.sim.enemies.values()].reduce((s, e) => s + e.hp, 0));
  await strikeAll(B, 10);
  await sleep(700);
  const afterHit = await g(A, () => [...window.__fratture.director.debug.sim.enemies.values()].reduce((s, e) => s + e.hp, 0));
  check(afterHit < before, `i colpi di chi non è host tolgono vita ai nemici (${before} → ${afterHit})`);

  // combo Guardiano + Lama: Provocazione, poi la Lama colpisce alle spalle
  await g(A, () => {
    const c = window.__fratture.combat;
    for (const e of c.enemies.values()) c.queueHit({ e: e.id, d: 0, tn: 6000 });
  });
  await B.waitForFunction(() => [...window.__fratture.combat.enemies.values()].some((e) => e.flags & 2), null, { timeout: 5000 }).catch(() => {});
  // Bruno si affianca a un nemico provocato e colpisce (riprova se il nemico si sposta)
  for (let i = 0; i < 8; i++) {
    const done = await g(B, () => {
      const f = window.__fratture;
      if (f.getGame().combo?.name === 'Alle spalle') return true;
      const e = [...f.combat.enemies.values()].find((x) => x.flags & 2);
      if (e) {
        f.local.teleport(e.x + 1.1, e.z + 1.1);
        f.press('attack');
      }
      return false;
    });
    if (done) break;
    await sleep(350);
  }
  const comboSeen = await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().combo?.name === 'Alle spalle', null, 4000)));
  check(comboSeen.every(Boolean), 'combo di coppia “Alle spalle” (Guardiano + Lama), vista da entrambi');

  // a terra e rialzati da un compagno
  await g(B, () => window.__fratture.combat.damageMe(99999, performance.now()));
  const downSeen = await waitFor(A, (id) => (window.__fratture.getRoom().vitals.get(id)?.f ?? 0) & 1, (await state(B)).selfId, 5000);
  check(downSeen, 'Bruno va a terra e gli altri lo vedono');
  const bpos = await g(B, () => ({ ...window.__fratture.local.pos }));
  await g(C, (p) => window.__fratture.local.teleport(p.x + 0.8, p.z), bpos);
  const revived = await waitFor(B, () => window.__fratture.combat.alive, null, 9000);
  check(revived, 'Cleo gli resta vicino e lo rialza');

  // sconfitta di gruppo: tutti a terra → checkpoint
  const wipes0 = (await runOf(A)).wipes;
  for (const p of [A, B, C]) await g(p, () => window.__fratture.combat.damageMe(99999, performance.now()));
  const wiped = await Promise.all([A, B, C].map((p) => waitFor(p, (w) => window.__fratture.getGame().room.run?.wipes > w, wipes0, 10000)));
  await sleep(800);
  const afterWipe = await Promise.all([A, B, C].map((p) => g(p, () => ({ alive: window.__fratture.combat.alive, hp: window.__fratture.combat.me.hp, max: window.__fratture.combat.me.maxHp }))));
  check(wiped.every(Boolean) && afterWipe.every((v) => v.alive && v.hp === v.max), 'cadono tutti: si riparte dal checkpoint con la vita piena');

  // l'host esce a metà combattimento: la regia passa al successivo, nemici compresi
  await enterRoom(A, 1);
  await enterRoom(B, 1);
  await enterRoom(C, 1);
  await waitFor(A, () => window.__fratture.director.debug.sim?.enemies.size > 0, null, 8000);
  await sleep(800);
  const ids = await g(B, () => [...window.__fratture.combat.enemies.keys()].sort().join(','));
  await A.close({ runBeforeUnload: true });
  const bHost = await waitFor(B, () => window.__fratture.getRoom().isHost, null, 8000);
  await sleep(1200);
  const adopted = await g(B, () => [...(window.__fratture.director.debug.sim?.enemies.keys() ?? [])].sort().join(','));
  check(bHost && adopted.length > 0 && ids.includes(adopted.split(',')[0]), 'l’host esce: Bruno prende la regia e riprende gli stessi nemici');
  // i due rimasti finiscono la stanza
  for (let i = 0; i < 20; i++) {
    const left = await g(B, () => window.__fratture.combat.enemies.size);
    if (left === 0) break;
    await strikeAll(C, 60);
    await sleep(400);
  }
  const cleared = await waitFor(C, () => window.__fratture.getGame().room.run?.cleared >= 2, null, 8000);
  check(cleared, 'stanza ripulita dopo il cambio di host: la porta si apre');

  // tappa 5: esperienza e bottino (deciso dall'host) per ognuno
  const gotLoot = await Promise.all([B, C].map((p) => waitFor(p, () => window.__fratture.getProgress().save.inventory.length > 0, null, 6000)));
  check(gotLoot.every(Boolean), 'a stanza ripulita ognuno riceve il suo bottino');
  const xp = await Promise.all(
    [B, C].map((p) =>
      g(p, () => {
        const s = window.__fratture.getProgress().save;
        const cls = window.__fratture.getGame().room.classes[window.__fratture.getGame().selfId];
        return s.classes[cls] ? s.classes[cls].xp + s.classes[cls].level * 1000 : 0;
      }),
    ),
  );
  check(xp.every((x) => x > 1000), 'nemici e stanze danno esperienza alla classe in uso');

  // il boss: si salta alla stanza finale
  await g(B, () => {
    const r = window.__fratture.getRoom();
    const d = window.__fratture.director.debug.dungeon;
    r.updateRoom((s) => ({ ...s, run: { ...s.run, cleared: d.rooms.length - 1, fight: -1, wave: 0 } }));
  });
  await sleep(500);
  const last = await g(B, () => window.__fratture.combat.dungeon.rooms.length - 1);
  await enterRoom(B, last);
  await enterRoom(C, last);
  const bossUp = await waitFor(C, () => [...window.__fratture.combat.enemies.values()].some((e) => e.type === 'eco'), null, 8000);
  check(bossUp, 'nella stanza finale compare il boss, l’Eco della Frattura');
  await C.waitForSelector('.boss-bar', { timeout: 4000 }).then(
    () => check(true, 'la barra del boss è visibile'),
    () => check(false, 'la barra del boss è visibile'),
  );
  for (let i = 0; i < 30; i++) {
    const done = await g(C, () => window.__fratture.getGame().room.run?.phase === 'complete');
    if (done) break;
    await strikeAll(C, 400);
    await sleep(400);
  }
  const won = await waitFor(B, () => window.__fratture.getGame().room.run?.phase === 'complete', null, 8000);
  const grado = await g(B, () => window.__fratture.getGame().room.grado);
  check(won && grado === 2, `boss sconfitto: Frattura completata, il gruppo passa al Grado ${grado}`);
  const trophies = await waitFor(C, () => window.__fratture.getGame().room.gstats.fratture >= 1, null, 5000);
  check(trophies, 'la compagnia registra la Frattura richiusa (sala dei trofei)');
  await g(C, () => window.__fratture.runRequest('leave'));
  const home = await Promise.all([B, C].map((p) => waitFor(p, () => window.__fratture.getGame().room.run === null, null, 6000)));
  await sleep(600);
  const homePos = await g(C, () => ({ ...window.__fratture.local.pos }));
  check(home.every(Boolean) && Math.hypot(homePos.x, homePos.z) < 20, 'si torna tutti al Crocevia');
  await C.screenshot({ path: `${SHOTS}/ritorno-crocevia.png` });
  await ctx.close();

  // ---------- tutte le abilità di tutte le classi, senza errori ----------
  const ctx2 = await browser.newContext();
  const P = await openPlayer(ctx2, 'Pia');
  await waitJoined(P);
  const code2 = (await state(P)).code;
  const others = [];
  for (const n of ['Quinto', 'Rita', 'Sara']) others.push(await openPlayer(ctx2, n, { code: code2 }));
  await Promise.all(others.map(waitJoined));
  const four = [P, ...others];
  await Promise.all(four.map((p) => waitMembers(p, 4)));
  const order = ['Guardiano', "Lama d'Ombra", 'Tessitore', 'Custode'];
  for (let i = 0; i < 4; i++) await four[i].click(`.class-card:has-text("${order[i]}")`);
  await Promise.all(four.map((p) => p.waitForFunction(() => Object.keys(window.__fratture.getGame().room.classes).length === 4, null, { timeout: 8000 })));
  for (const p of four) await p.keyboard.press('Escape');
  await g(P, () => window.__fratture.runRequest('start'));
  await Promise.all(four.map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 12000)));
  await sleep(600);
  for (const p of four) await enterRoom(p, 1);
  await waitFor(P, () => window.__fratture.combat.enemies.size > 0, null, 8000);
  await sleep(800);
  const used = [];
  let sawVarco = false;
  for (const p of four) {
    await p.click('canvas').catch(() => {});
    await g(p, () => {
      window.__fratture.combat.me.ultra = 100;
    });
    for (const k of ['q', 'e', 'r', 'f']) {
      await p.keyboard.press(k);
      await sleep(150);
    }
    await sleep(300);
    used.push(
      await g(p, () => {
        const me = window.__fratture.combat.me;
        const now = performance.now();
        return me.cd.Q > now && me.cd.E > now && me.cd.R > now && me.ultra < 100;
      }),
    );
    // il Varco del Tessitore arriva anche all'host
    if (p === others[1]) sawVarco = await waitFor(P, () => [...window.__fratture.combat.zones.values()].some((z) => z.kind === 'varco'), null, 3000);
  }
  check(used.every(Boolean), `ognuna delle 4 classi usa Q, E, R e la Ultra (${used.map((u) => (u ? 'ok' : 'no')).join(', ')})`);
  check(sawVarco, 'le zone delle abilità (il Varco) arrivano agli altri');
  await sleep(1500);
  const shotPage = others[2];
  await shotPage.setViewportSize({ width: 1280, height: 720 });
  await sleep(900);
  await shotPage.screenshot({ path: `${SHOTS}/frattura-4-classi.png` });
  await shotPage.setViewportSize({ width: 480, height: 270 });
  await ctx2.close();
}

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

    await fratturaTests(browser);
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
