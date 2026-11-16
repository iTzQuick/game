# Le Fratture

Action-RPG cooperativo 3D nel browser (PC e telefono), fino a 4 giocatori su invito.

Questo è il **prototipo della tappa 3** della roadmap: il Crocevia online, fino a 4
giocatori. Serve a verificare che in 4 il gioco resti fluido prima di costruire il
combattimento (tappa 4).

## Cosa c'è

- **Il Crocevia**: isola di pietra sospesa nel vuoto con i 4 portali spenti (Città
  Sommersa, Foresta dei Sussurri, Metropoli Spenta, Deserto degli Specchi), il Custode
  Muto al centro e gli altari delle classi.
- **Stanze fino a 4 giocatori**: si crea una partita e si invita con un link o un
  codice di 4 caratteri. Il quinto giocatore resta fuori.
- **Host con passaggio automatico**: chi crea la partita è l'host, cioè decide le
  regole condivise (oggi le classi, dalla tappa 4 nemici e bottino). Se l'host esce,
  il ruolo passa a chi è entrato subito dopo, senza interrompere la partita.
- **4 classi uniche per stanza**: Guardiano, Lama d'Ombra, Tessitore di Portali,
  Custode della Luce. Si scelgono dal pannello (tasto C) o avvicinandosi agli altari.
- **Movimento in terza persona** con fisica (Rapier): corsa, schivata con capriola,
  attacco base (combo da 3 in mischia, dardo a distanza). Per ora gli attacchi sono
  solo animazione: i danni arrivano con la tappa 4.
- **Ping "guarda qui" ed emote**, visibili a tutti.
- **Controlli PC e telefono** come nel documento di design, qualità grafica bassa,
  media o alta, e un pannello con FPS e latenza (Impostazioni → Statistiche).
- **Avatar di riserva**: eroi cartoon fatti di forme semplici, con il segno luminoso
  sul polso. Gli avatar dalla foto arrivano con la tappa 5.

### Comandi

| Azione | PC | Telefono |
| --- | --- | --- |
| Muoversi | WASD | Joystick a sinistra |
| Telecamera | Mouse (clicca per catturarlo) | Trascina a destra |
| Attacco | Click sinistro | Pulsante grande |
| Schivata | Spazio | Pulsante sopra l'attacco |
| Interagire | G | Pulsante che compare vicino all'oggetto |
| Ping | Click centrale | Doppio tocco sul mondo |
| Emote | 1–4 | Pulsante emote |
| Classe | C | Pulsante "Classe" |

Q, E, R e F (abilità e Ultra) sono già indicati nelle schede delle classi, ma si
attivano con il combattimento.

## Provarlo subito (senza account)

```bash
npm install
npm run dev
```

Apri l'indirizzo che compare. Senza Supabase il gioco parte in **modalità locale**:
le stanze funzionano tra più schede (o finestre) dello stesso browser. Crea una
partita in una scheda e apri il link di invito in un'altra.

## Giocare online, da case diverse

Serve un progetto Supabase (il piano gratuito basta) e un hosting statico qualsiasi.

1. Crea un progetto su [supabase.com](https://supabase.com). Non servono tabelle: per
   ora si usa solo Realtime (Presence e Broadcast).
2. Copia `.env.example` in `.env.local` e inserisci `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` (Project Settings → API). La chiave anon/publishable è
   pubblica per natura. Non mettere mai qui la `service_role` né la chiave di Anthropic.
3. In Supabase, Realtime deve accettare i canali pubblici (è l'impostazione predefinita).
4. `npm run build` e pubblica la cartella `dist/` (Vercel, Netlify, Cloudflare Pages,
   GitHub Pages…). La build usa percorsi relativi, quindi funziona anche in una sottocartella.

### Come viaggiano i dati, e perché

Il documento di design prevedeva Supabase Realtime per tutto il traffico di gioco.
Facendo i conti con i limiti del piano gratuito non regge:

- ogni messaggio in broadcast conta 1 volta per chi lo invia più 1 per ogni ricevente;
- 4 giocatori × 15–20 posizioni al secondo × 4 ≈ 240–320 messaggi al secondo;
- il piano gratuito ne permette 100 al secondo e 2 milioni al mese: sarebbe sopra il
  limite al secondo, e con 4 giocatori la quota mensile finirebbe in circa 2 ore di gioco.

Fonti: [limiti Realtime](https://supabase.com/docs/guides/realtime/limits),
[come si contano i messaggi](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages).

Per questo il prototipo divide il traffico:

- **Supabase Realtime** fa solo da "sala d'attesa": chi c'è nella stanza (Presence) e
  pochi messaggi (stretta di mano WebRTC, classi). Sono poche decine di messaggi a partita.
- **WebRTC peer-to-peer** porta il traffico continuo direttamente tra i giocatori
  (al massimo 6 collegamenti con 4 giocatori): posizioni a 20 Hz su un canale veloce
  "senza garanzia", eventi (attacchi, emote, ping, classi) su un canale affidabile.
  Costo zero e latenza più bassa.
- **Riserva**: se due giocatori non riescono a collegarsi in P2P (alcune reti mobili
  lo bloccano), il traffico tra loro passa da Supabase a 5 Hz. Per evitarlo si può
  aggiungere un server TURN (`VITE_TURN_*` in `.env.example`). Il piano B del
  documento (un piccolo server dedicato) resta valido se servirà.

Il pannello Statistiche mostra per ogni giocatore se il collegamento è `P2P` o `relay`
e la latenza: è il dato da guardare per la verifica di fine tappa 3.

## Sviluppo

```bash
npm run dev         # server di sviluppo
npm run typecheck   # controllo dei tipi
npm test            # test delle regole (stanza, host, classi, interpolazione)
npm run build
npm run test:e2e    # dopo la build: 4–5 giocatori veri in Chromium headless
```

Parametri utili nell'URL:

- `?rete=locale` forza la modalità locale anche con Supabase configurato;
- `?rete=locale&p2p=1` usa WebRTC anche in locale (per provare il P2P su un computer solo).

### Struttura

```
src/
  game/      costanti (classi, mondi, movimento, rete), stato, input, sessione
  net/       stanza (host, classi, traffico), WebRTC, Supabase, interpolazione
  player/    giocatore locale (fisica e telecamera), altri giocatori, avatar
  world/     il Crocevia e le interazioni
  fx/        dardi, fendenti, ping
  ui/        menu, interfaccia, controlli touch, statistiche
tests/       test unitari (vitest)
scripts/     test end-to-end multigiocatore (Playwright)
```

Le regole della stanza (`src/net/roomLogic.ts`) sono funzioni pure: ogni dispositivo
le calcola sulla stessa lista di presenti e arriva alla stessa conclusione su chi è
l'host e chi è entrato, senza un server.

## Prossima tappa

Tappa 4, il combattimento: abilità Q/E/R e Ultra per le 4 classi, nemici calcolati
dall'host, mira automatica, caduta e rianimazione, combo di coppia e la prima Frattura.
