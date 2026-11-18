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
/** File dei modelli 3D scaricati (nome giocatore, file, stato HTTP). */
const modelLoads = [];
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
    if (m.type() === 'error' || /Modello 3D non caricato|osso .* non trovato/.test(m.text())) errors.push(`${name} console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/models/')) modelLoads.push({ name, file: r.url().split('/').pop(), status: r.status() });
  });
  await page.addInitScript((q) => {
    localStorage.setItem('fratture.settings', JSON.stringify({ quality: q, touch: 'off' }));
    // dopo ogni stanza ripulita si sceglie un potere: qui si prende il primo, come farebbe un giocatore
    window.__poteriScelti = 0;
    setInterval(() => {
      const card = document.querySelector('.boon-card');
      if (card) {
        card.click();
        window.__poteriScelti++;
      }
    }, 400);
  }, quality);
  // Senza scheda video, le finestre con i modelli 3D scendono a pochi fotogrammi al
  // secondo e si bloccano mentre li preparano: qui si usano le forme semplici, e i
  // modelli si provano a parte, in una finestra sola (modelsTest).
  const q = new URLSearchParams({ rete: 'locale', modelli: '0', ...extra });
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
  // chi è appena stato rialzato ha 1,5 s di invulnerabilità (voluta): qui la togliamo, altrimenti
  // resta in piedi e rialza gli altri, e la sconfitta di gruppo non arriva mai
  for (const p of [A, B, C]) {
    await g(p, () => {
      const c = window.__fratture.combat;
      c.me.invulnUntil = 0;
      c.damageMe(99999, performance.now());
    });
  }
  const wiped = await Promise.all([A, B, C].map((p) => waitFor(p, (w) => window.__fratture.getGame().room.run?.wipes > w, wipes0, 10000)));
  await sleep(800);
  const afterWipe = await Promise.all([A, B, C].map((p) => g(p, () => ({ alive: window.__fratture.combat.alive, hp: window.__fratture.combat.me.hp, max: window.__fratture.combat.me.maxHp }))));
  check(
    wiped.every(Boolean) && afterWipe.every((v) => v.alive && v.hp === v.max),
    `cadono tutti: si riparte dal checkpoint con la vita piena${wiped.every(Boolean) && afterWipe.every((v) => v.alive && v.hp === v.max) ? '' : ` (${JSON.stringify({ wiped, afterWipe })})`}`,
  );

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

  // poteri della Frattura: dopo la stanza ognuno ne sceglie uno (qui lo sceglie lo script)
  const boons = await Promise.all(
    [B, C].map((p) => waitFor(p, () => window.__poteriScelti >= 1 && Object.keys(window.__fratture.myBoons()).length + (window.__fratture.combat.me.potions > 0 ? 1 : 0) > 0, null, 6000)),
  );
  check(boons.every(Boolean), 'a stanza ripulita ognuno sceglie un potere della Frattura');

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
    // qui si provano le abilità, non la resistenza: chi è a terra si rialza e per un attimo non subisce colpi
    const wasDown = await g(p, () => {
      const c = window.__fratture.combat;
      const down = !c.alive;
      c.reviveMe(1);
      c.me.hp = c.me.maxHp;
      c.me.invulnUntil = performance.now() + 4000;
      c.me.ultra = 100;
      return down;
    });
    if (wasDown) {
      console.log('  (era a terra prima della prova: rialzato)');
      // il gioco deve prima rimetterlo in piedi (animazione, stato): poi si provano i tasti
      await sleep(500);
      await g(p, () => {
        const c = window.__fratture.combat;
        c.me.invulnUntil = performance.now() + 4000;
        c.me.ultra = 100;
      });
    }
    // con 4 finestre aperte il gioco va lento: un tasto premuto mentre parte l'abilità di prima
    // può andare perso. Ogni tasto si controlla subito dopo; se non è partito si ripreme (fino a 3 volte)
    let all = true;
    for (const k of ['q', 'e', 'r', 'f']) {
      let ok = false;
      for (let tries = 0; tries < 3 && !ok; tries++) {
        await p.keyboard.press(k);
        ok = await waitFor(
          p,
          (k) => {
            const me = window.__fratture.combat.me;
            return k === 'f' ? me.ultra < 100 : me.cd[k.toUpperCase()] > performance.now();
          },
          k,
          tries < 2 ? 700 : 1500,
        );
      }
      all &&= ok;
    }
    used.push(all);
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

// ---------------- Narratore: missioni del giorno ----------------

async function missionsTest(browser) {
  const ctx = await browser.newContext();
  const A = await openPlayer(ctx, 'Ada');
  await waitJoined(A);
  const code = (await state(A)).code;
  const B = await openPlayer(ctx, 'Bruno', { code });
  await waitJoined(B);
  await Promise.all([A, B].map((p) => waitMembers(p, 2)));
  await A.click('.class-card:has-text("Guardiano")');
  await B.click('.class-card:has-text("Custode")');
  await Promise.all([A, B].map((p) => p.waitForFunction(() => Object.keys(window.__fratture.getGame().room.classes).length === 2, null, { timeout: 8000 })));
  for (const p of [A, B]) await p.keyboard.press('Escape');

  // senza account: le missioni di riserva del giorno, uguali per tutti
  const ready = await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.narrazione?.missioni.length === 3, null, 8000)));
  const nA = await g(A, () => window.__fratture.getGame().room.narrazione);
  const nB = await g(B, () => window.__fratture.getGame().room.narrazione);
  check(ready.every(Boolean) && nA.fonte === 'riserva' && JSON.stringify(nA) === JSON.stringify(nB), 'tre missioni del giorno (di riserva, senza account), uguali per tutti');
  const why = await g(B, () => window.__fratture.getGame().room.statoNarratore);
  check(/account/.test(why), `il pannello spiega perché sono di riserva: "${why}"`);

  // missioni di prova, decise dall'host (come se le avesse scritte il narratore)
  await g(A, () => {
    const day = window.__fratture.getGame().room.narrazione.giorno;
    const n = {
      giorno: day,
      fonte: 'claude',
      missioni: [
        { id: `${day}-1`, titolo: 'Caccia di prova', racconto: 'Le Ombre di prova marciano.', obiettivo: { tipo: 'sconfiggi', nemico: 'ombra', quanti: 1 }, modificatori: ['veloci'], nemico: 'ombra' },
        { id: `${day}-2`, titolo: 'Tutti in piedi', racconto: 'Nessuno deve cadere.', obiettivo: { tipo: 'nessuno_cade' }, modificatori: [], nemico: null },
        { id: `${day}-3`, titolo: 'Senza sete', racconto: 'Niente pozioni.', obiettivo: { tipo: 'senza_pozioni' }, modificatori: [], nemico: 'bruto' },
      ],
      custode: [['Il Custode di prova alza la mano.', '«Questa è una battuta del narratore.»']],
      eco: ['«Eco di prova.»'],
    };
    window.__fratture.getRoom().updateRoom((s) => ({ ...s, narrazione: n, fatte: [], statoNarratore: '' }));
  });
  await waitFor(B, () => window.__fratture.getGame().room.narrazione?.fonte === 'claude', null, 5000);

  // il Custode usa le battute del giorno
  await waitFor(B, () => typeof window.__fratture.local?.teleport === 'function', null, 15000);
  await g(B, () => window.__fratture.local.teleport(0, 2.5));
  await sleep(400);
  await B.keyboard.press('g');
  const custode = await waitFor(B, () => (window.__fratture.getGame().dialog?.lines ?? []).join(' ').includes('battuta del narratore'), null, 4000);
  const hint = await g(B, () => (window.__fratture.getGame().dialog?.lines ?? []).some((l) => l.includes('tasto M')));
  check(custode && hint, 'il Custode dice le battute del narratore e ricorda le missioni');
  await g(B, () => window.__fratture.store.setState({ dialog: null }));

  // pannello (tasto M) e partenza da chi non è host
  await B.keyboard.press('m');
  await B.waitForSelector('.mission', { timeout: 4000 }).catch(() => {});
  const cards = await B.locator('.mission').count();
  check(cards === 3, `il pannello Missioni (tasto M) mostra ${cards} missioni`);
  await B.setViewportSize({ width: 1280, height: 720 });
  await sleep(300);
  await B.screenshot({ path: `${SHOTS}/missioni.png` });
  await B.click('.mission:has-text("Caccia di prova") button:has-text("Parti")');
  const counting = await waitFor(B, () => window.__fratture.getGame().room.run?.missione?.titolo === 'Caccia di prova', null, 6000);
  const ecoShown = await B.waitForSelector('.eco-line', { timeout: 3000 }).then(
    () => true,
    () => false,
  );
  await B.screenshot({ path: `${SHOTS}/missione-apertura.png` });
  const run0 = await runOf(B);
  check(counting && run0.mods.join() === 'veloci', 'la missione apre la Frattura con i suoi modificatori');
  check(ecoShown, 'all’apertura parla l’Eco');
  await B.setViewportSize({ width: 480, height: 270 });

  await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 12000)));
  await sleep(600);
  await enterRoom(A, 1);
  await enterRoom(B, 1);
  await waitFor(A, () => window.__fratture.combat.enemies.size > 0, null, 8000);
  await sleep(500);
  const ombre = await g(A, () => [...window.__fratture.director.debug.sim.enemies.values()].filter((e) => e.type === 'ombra').length);
  check(ombre >= 1, `il nemico della missione è nella stanza (${ombre} Ombre)`);
  for (let i = 0; i < 20; i++) {
    if ((await runOf(A)).cleared >= 2) break;
    await strikeAll(A, 500);
    await sleep(350);
  }
  const counted = await waitFor(B, () => window.__fratture.getGame().room.run?.missione?.conta >= 1, null, 5000);
  check(counted, 'le Ombre sconfitte contano per la missione, per tutti');
  await B.waitForSelector('.mission-line', { timeout: 3000 }).then(
    () => check(true, 'la riga della missione è in alto durante la Frattura'),
    () => check(false, 'la riga della missione è in alto durante la Frattura'),
  );

  // salto al boss e vittoria
  await g(A, () => {
    const d = window.__fratture.director.debug.dungeon;
    window.__fratture.getRoom().updateRoom((s) => ({ ...s, run: { ...s.run, cleared: d.rooms.length - 1, fight: -1, wave: 0 } }));
  });
  await sleep(500);
  const last = await g(A, () => window.__fratture.combat.dungeon.rooms.length - 1);
  await enterRoom(A, last);
  await enterRoom(B, last);
  await waitFor(A, () => [...window.__fratture.combat.enemies.values()].some((e) => e.type === 'eco'), null, 8000);
  const frags0 = await g(B, () => window.__fratture.getProgress().save.fragments);
  for (let i = 0; i < 30; i++) {
    if ((await runOf(A)).phase === 'complete') break;
    await strikeAll(A, 600);
    await sleep(350);
  }
  const done = await waitFor(B, () => window.__fratture.getGame().room.run?.missione?.esito === 'compiuta', null, 6000);
  check(done, 'boss sconfitto: missione compiuta');
  const fatte = await waitFor(B, (id) => window.__fratture.getGame().room.fatte.includes(id), run0.missione.id, 5000);
  check(fatte, 'la missione compiuta resta segnata come fatta per oggi');
  const reward = await waitFor(B, (f) => window.__fratture.getProgress().save.fragments > f + 40, frags0, 5000);
  const toastSeen = await g(B, () => window.__fratture.getGame().toasts.some((t) => t.text.includes('Missione «Caccia di prova» compiuta')));
  check(reward && toastSeen, 'ognuno riceve la ricompensa della missione');
  const diary = await waitFor(B, () => window.__fratture.getGame().room.diario.some((d) => d.text.includes('Missione «Caccia di prova» compiuta')), null, 5000);
  check(diary, 'il diario della compagnia registra la missione');
  // non si può ripetere
  await g(B, (id) => window.__fratture.runRequest('leave'), null);
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.run === null, null, 6000)));
  await g(B, (id) => window.__fratture.runRequest('start', id), run0.missione.id);
  await sleep(1200);
  check((await runOf(A)) === null, 'una missione già compiuta non riparte');

  // missione "nessuno cade": basta una caduta per fallirla
  const m2 = await g(A, () => window.__fratture.getGame().room.narrazione.missioni[1].id);
  await g(B, (id) => window.__fratture.runRequest('start', id), m2);
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 12000)));
  await sleep(500);
  await enterRoom(A, 1);
  await enterRoom(B, 1);
  await waitFor(A, () => window.__fratture.combat.enemies.size > 0, null, 8000);
  await g(B, () => window.__fratture.combat.damageMe(99999, performance.now()));
  const failed = await waitFor(B, () => window.__fratture.getGame().room.run?.missione?.fallita === true, null, 6000);
  const failLine = await B.waitForSelector('.mission-line.failed', { timeout: 3000 }).then(
    () => true,
    () => false,
  );
  check(failed && failLine, 'nessuno deve cadere: Bruno cade e la missione fallisce');
  await g(A, () => window.__fratture.runRequest('abandon'));
  await waitFor(A, () => window.__fratture.getGame().room.run === null, null, 6000);
  await ctx.close();
}

// ---------------- Città Sommersa: Atto I, ossigeno, La Campana, voto ----------------

async function cittaTest(browser) {
  const ctx = await browser.newContext();
  const A = await openPlayer(ctx, 'Ada');
  await waitJoined(A);
  const code = (await state(A)).code;
  const B = await openPlayer(ctx, 'Bruno', { code });
  await waitJoined(B);
  await Promise.all([A, B].map((p) => waitMembers(p, 2)));
  await A.click('.class-card:has-text("Guardiano")');
  await B.click('.class-card:has-text("Custode")');
  await Promise.all([A, B].map((p) => p.waitForFunction(() => Object.keys(window.__fratture.getGame().room.classes).length === 2, null, { timeout: 8000 })));
  for (const p of [A, B]) await p.keyboard.press('Escape');
  await waitFor(B, () => typeof window.__fratture.local?.teleport === 'function', null, 15000);

  // portale spento finché la compagnia non ha richiuso una Frattura
  await g(B, () => window.__fratture.local.teleport(0, 14.5));
  await sleep(400);
  await B.keyboard.press('g');
  const closed = await waitFor(B, () => (window.__fratture.getGame().dialog?.lines ?? []).join(' ').includes('prima Frattura'), null, 4000);
  check(closed, 'il portale della Città Sommersa è spento prima della prima Frattura');
  await g(B, () => window.__fratture.store.setState({ dialog: null }));
  await waitFor(A, () => !!window.__fratture.groupKeeper.debug.data, null, 8000);
  await g(A, () => {
    window.__fratture.getRoom().updateRoom((s) => ({ ...s, gstats: { ...(s.gstats ?? { bosses: 0, kills: 0 }), fratture: 1 } }));
  });
  await waitFor(B, () => window.__fratture.getGame().room.gstats.fratture >= 1, null, 5000);
  await sleep(300);
  await B.keyboard.press('g');
  await B.waitForSelector('.mission', { timeout: 4000 }).catch(() => {});
  const cards = await B.locator('.mission').count();
  const locked = await B.locator('.mission.locked').count();
  check(cards === 5 && locked === 4, `dal portale acceso si apre l’Atto I: ${cards} missioni, ${locked} ancora chiuse`);
  await B.setViewportSize({ width: 1280, height: 720 });
  await sleep(300);
  await B.screenshot({ path: `${SHOTS}/citta-atto1.png` });
  await B.setViewportSize({ width: 480, height: 270 });
  await B.click('.mission[data-mission="atto1-1"] button:has-text("Parti")');
  const inCitta = await waitFor(A, () => window.__fratture.getGame().room.run?.mondo === 'citta-sommersa', null, 6000);
  check(inCitta, 'la prima missione apre una Frattura nella Città Sommersa');
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 12000)));
  await sleep(600);

  // ossigeno: cala lontano dalle bolle, si riprende dentro una colonna
  const colonna = await g(B, () => {
    const c = window.__fratture.combat;
    const r = c.dungeon.rooms[1];
    const col = c.colonne.find((x) => x.room === 1);
    window.__fratture.local.teleport(r.doorSouthX ?? r.cx, r.rect.z1 - 2);
    return col;
  });
  await sleep(2500);
  const low = await g(B, () => window.__fratture.combat.me.oxygen);
  check(low < 99, `lontano dalle bolle l’ossigeno cala (${Math.round(low)})`);
  await B.waitForSelector('.oxygen-bar', { timeout: 3000 }).then(
    () => check(true, 'la barra dell’ossigeno è visibile nella Città'),
    () => check(false, 'la barra dell’ossigeno è visibile nella Città'),
  );
  if (colonna) {
    await g(B, () => window.__fratture.combat.me.oxygen = 30);
    await g(B, (c) => window.__fratture.local.teleport(c.x, c.z), colonna);
    const refill = await waitFor(B, () => window.__fratture.combat.me.oxygen > 60, null, 4000);
    check(refill, 'in una colonna di bolle l’ossigeno torna');
  } else check(false, 'c’è una colonna di bolle nella prima stanza');
  await g(B, () => window.__fratture.combat.me.oxygen = 0);
  const hp0 = await g(B, () => window.__fratture.combat.me.hp);
  await g(B, () => {
    const r = window.__fratture.combat.dungeon.rooms[1];
    window.__fratture.local.teleport(r.doorSouthX ?? r.cx, r.rect.z1 - 2);
  });
  await sleep(1500);
  const hp1 = await g(B, () => window.__fratture.combat.me.hp);
  check(hp1 < hp0, `senza ossigeno si perde vita (${Math.round(hp0)} → ${Math.round(hp1)})`);
  await g(B, () => (window.__fratture.combat.me.oxygen = 100));

  // nemici della Città
  await enterRoom(A, 1);
  await waitFor(A, () => window.__fratture.director.debug.sim?.enemies.size > 0, null, 8000);
  const types = await g(A, () => [...new Set([...window.__fratture.director.debug.sim.enemies.values()].map((e) => e.type))]);
  const pool = ['annegato', 'anguilla', 'ombra', 'riflesso', 'sciame'];
  check(types.length > 0 && types.every((t) => pool.includes(t)) && types.some((t) => t === 'annegato' || t === 'anguilla'), `nella Città arrivano Annegati e Anguille (${types.join(', ')})`);
  await sleep(400);
  await B.setViewportSize({ width: 1280, height: 720 });
  await enterRoom(B, 1);
  await sleep(1200);
  await B.screenshot({ path: `${SHOTS}/citta-stanza.png` });
  await B.setViewportSize({ width: 480, height: 270 });

  // via al boss e vittoria: la storia va avanti, il narratore racconta
  const winRun = async (bossType) => {
    await g(A, () => {
      const d = window.__fratture.director.debug.dungeon;
      window.__fratture.director.debug.sim?.clear();
      window.__fratture.getRoom().updateRoom((s) => ({ ...s, run: { ...s.run, cleared: d.rooms.length - 1, fight: -1, wave: 0 } }));
    });
    await sleep(500);
    const last = await g(A, () => window.__fratture.combat.dungeon.rooms.length - 1);
    await enterRoom(A, last);
    await enterRoom(B, last);
    const up = await waitFor(A, (t) => [...window.__fratture.combat.enemies.values()].some((e) => e.type === t), bossType, 8000);
    for (let i = 0; i < 40; i++) {
      if ((await runOf(A)).phase === 'complete') break;
      await strikeAll(A, 700);
      await sleep(300);
    }
    return up && (await waitFor(B, () => window.__fratture.getGame().room.run?.phase === 'complete', null, 6000));
  };
  check(await winRun('eco'), 'in fondo alle prime missioni c’è l’Eco, e cade');
  const advanced = await waitFor(B, () => window.__fratture.getGame().room.atto1.fatte === 1, null, 5000);
  check(advanced, 'missione compiuta: l’Atto I va avanti per tutti');
  const told = await waitFor(B, () => (window.__fratture.getGame().dialog?.lines ?? []).join(' ').includes('Strade allagate'), null, 5000);
  check(told, 'il narratore racconta la fine della missione a chi non è host');
  await g(B, () => window.__fratture.store.setState({ dialog: null }));
  await g(A, () => window.__fratture.store.setState({ dialog: null }));
  await g(A, () => window.__fratture.runRequest('leave'));
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.run === null, null, 6000)));

  // l'ultima missione: La Campana, poi il voto
  await g(A, () => {
    const f = window.__fratture;
    f.groupKeeper.debug.data.atto1 = { fatte: 4, scelta: null };
    f.getRoom().updateRoom((s) => ({ ...s, atto1: { fatte: 4, scelta: null } }));
  });
  await waitFor(B, () => window.__fratture.getGame().room.atto1.fatte === 4, null, 5000);
  await g(B, () => window.__fratture.runRequest('start', 'atto1-5'));
  await Promise.all([A, B].map((p) => waitFor(p, () => window.__fratture.getGame().room.run?.phase === 'active', null, 12000)));
  await sleep(500);
  check((await runOf(A)).boss === 'campana', 'l’ultima missione ha La Campana come boss');
  check(await winRun('campana'), 'La Campana compare e cade');
  await g(B, () => window.__fratture.store.setState({ dialog: null }));
  const voteOpen = await waitFor(B, () => window.__fratture.getGame().room.voto?.aperto === true, null, 6000);
  await sleep(1600);
  await g(B, () => window.__fratture.store.setState({ dialog: null }));
  const panel = await B.waitForSelector('.vote-modal', { timeout: 5000 }).then(
    () => true,
    () => false,
  );
  check(voteOpen && panel, 'dopo la Campana si apre il voto della compagnia, con il frammento di verità');
  await B.setViewportSize({ width: 1280, height: 720 });
  await sleep(300);
  await B.screenshot({ path: `${SHOTS}/citta-voto.png` });
  await B.setViewportSize({ width: 480, height: 270 });
  await B.click('.vote-options button:has-text("Lasciarla al fondo")');
  await g(A, () => window.__fratture.store.setState({ dialog: null }));
  await A.waitForSelector('.vote-modal', { timeout: 5000 }).catch(() => {});
  await A.click('.vote-options button:has-text("Lasciarla al fondo")').catch(() => {});
  const decided = await waitFor(B, () => window.__fratture.getGame().room.atto1.scelta === 1, null, 6000);
  const diary = await waitFor(B, () => window.__fratture.getGame().room.diario.some((d) => d.text.includes('ha deciso della Campana')), null, 5000);
  check(decided && diary, 'votano tutti: la scelta si salva con la compagnia e finisce nel diario');
  await ctx.close();
}

// ---------------- Grafica: modelli 3D, texture, icone ----------------

async function modelsTest(browser) {
  const ctx = await browser.newContext();
  const G = await openPlayer(ctx, 'Gaia', { quality: 'media', extra: { modelli: '1' } });
  await waitJoined(G);
  await G.click('.class-card:has-text("Custode")');
  await G.keyboard.press('Escape');
  const want = ['portale-citta-sommersa.glb', 'custode-muto.glb', 'colonna.glb', 'piedistallo.glb', 'custode.glb', 'bastone.glb'];
  const loaded = () => new Set(modelLoads.filter((m) => m.name === 'Gaia' && m.status === 200).map((m) => m.file));
  for (let i = 0; i < 60 && !want.every((f) => loaded().has(f)); i++) await sleep(500);
  // nella Frattura arrivano i nemici
  await g(G, () => window.__fratture.runRequest('start'));
  await waitFor(G, () => window.__fratture.getGame().room.run?.phase === 'active', null, 15000);
  await enterRoom(G, 1);
  await waitFor(G, () => window.__fratture.combat.enemies.size > 0, null, 15000);
  for (let i = 0; i < 40 && ![...loaded()].some((f) => ['ombra.glb', 'sciame.glb', 'riflesso.glb', 'velato.glb', 'bruto.glb'].includes(f)); i++) await sleep(500);
  await G.setViewportSize({ width: 1280, height: 720 });
  await sleep(1500);
  await G.screenshot({ path: `${SHOTS}/grafica-frattura.png` });
  const got = loaded();
  const bad = modelLoads.filter((m) => m.status !== 200 && m.status !== 304);
  check(want.every((f) => got.has(f)) && bad.length === 0, `i modelli 3D si caricano (${[...got].join(', ') || 'nessuno'})`);
  check([...got].some((f) => ['ombra.glb', 'sciame.glb', 'riflesso.glb', 'velato.glb', 'bruto.glb'].includes(f)), 'nella Frattura arrivano i modelli dei nemici');
  const tex = await g(G, () => performance.getEntriesByType('resource').filter((r) => /textures\/|ui\/icone\//.test(r.name)).length);
  check(tex >= 5, `texture e icone dipinte caricate (${tex} file)`);
  await ctx.close();
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
    await missionsTest(browser);
    await cittaTest(browser);
    await modelsTest(browser);
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
