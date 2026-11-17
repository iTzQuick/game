# Le Fratture

Action-RPG cooperativo 3D nel browser (PC e telefono), fino a 4 giocatori su invito.

Stato: **tappa 5** della roadmap, la progressione (senza gli avatar dalle foto, per
ora). Prima ancora: il combattimento (tappa 4) e il Crocevia online (tappa 3).

## Cosa c'è

### Tappa 5: la progressione

- **Livelli per classe** (fino al 30): esperienza dai nemici, dalle stanze ripulite e
  dalle Fratture richiuse, di più ai Gradi alti. Ogni livello dà un punto talento.
- **Alberi dei talenti** a 3 rami per classe (tasto **P**): bonus a vita, danni,
  critici, ricariche, velocità, cure, carica della Ultra, e poteri che cambiano le
  abilità (Barriera più ampia, Velo più lungo, Dardo con un rimbalzo in più…). I punti
  si azzerano gratis al Crocevia.
- **Bottino** in 5 rarità (comune, raro, epico, leggendario, frattura) con statistiche
  casuali: armi, armature e amuleti. Lo decide l'host: un oggetto a testa per stanza
  ripulita, due dal boss (uno almeno epico). **Zaino** con il tasto **I**.
- **Frammenti**: si guadagnano ripulendo stanze e smontando oggetti; servono a
  potenziare gli oggetti alla Forgia e a costruire la base.
- **La base del Crocevia**, condivisa dalla compagnia: Forgia (potenziamenti),
  Giardino (una pozione a testa per Frattura, tasto **H**), Biblioteca (gli indizi del
  mistero), Sala dei trofei (record del gruppo). L'Osservatorio arriva con gli eventi
  della settimana (tappa 7). Ognuno versa i propri frammenti.
- **Salvataggi**: con un account (email e password) i progressi stanno su Supabase e
  seguono il giocatore su ogni dispositivo; da ospite restano nel browser. Al primo
  accesso i progressi da ospite passano all'account. La compagnia (base, Grado, record,
  diario del gruppo per il futuro narratore) la salva l'host.

Numeri in `src/progress/defs.ts`; regole in `src/progress/model.ts` (testate).

### Tappa 4: il combattimento

- **La Frattura**: una crepa sul bordo del Crocevia. Chiunque abbia una classe può
  aprirla; dopo 5 secondi tutto il gruppo ci entra. È un dungeon generato ogni volta
  (stanza d'ingresso, 3–5 stanze di combattimento, stanza del boss). Entrando in una
  stanza compaiono i nemici, e la porta si apre quando la stanza è ripulita.
- **Grado infinito**: ogni Frattura completata alza il Grado del gruppo. Nemici più
  forti e più numerosi, ondate doppie dal Grado 3, e modificatori (nemici veloci,
  niente cure, colpi pesanti, nebbia di veli, frenesia) dal Grado 3 e 6. Il pannello
  della stanza mostra il Grado e il record del gruppo.
- **Nemici**: Ombra, Sciame, Riflesso (spara), Bruto (schianto ad area), Velato
  (quasi invisibile, prende metà danni finché la Custode non lo rivela). Boss:
  **l'Eco della Frattura**, che chiama rinforzi, spara anelli di proiettili e sotto
  metà vita si infuria. Ogni attacco nemico ha un preavviso rosso a terra.
- **Abilità Q/E/R e Ultra F** delle 4 classi, come nel documento: Colpo di scudo,
  Provocazione, Barriera, Bastione; Scatto d'ombra, Lame vorticanti, Velo, Mille tagli;
  Varco, Trappola del vuoto, Dardo arcano, Collasso; Raggio curativo, Rivelazione,
  Benedizione, Alba. La Ultra si carica colpendo, subendo danni e curando.
- **Le 6 combo di coppia**: Alle spalle (Guardiano + Lama), Varco d'ombra (Tessitore +
  Lama), Implosione (Tessitore + Guardiano), Barriera di luce (Custode + Guardiano:
  rimanda i proiettili), Varco luminoso (Custode + Tessitore: cura chi ci passa),
  Esecuzione (Custode + Lama).
- **Mira automatica** sul nemico più vicino davanti a te: sempre attiva sul telefono,
  disattivabile su PC dalle impostazioni.
- **Caduta**: a zero vita si va a terra; un compagno che resta vicino per 2,5 secondi
  ti rialza. Dopo 20 secondi si è fuori combattimento fino alla fine della stanza. Se
  cadono tutti, si riparte dal checkpoint (l'ingresso della stanza) con la vita piena.
- **Host**: il dispositivo dell'host calcola i nemici. Se esce a metà combattimento,
  il successivo riprende la regia con gli stessi nemici.

Valori, danni e ricariche sono un primo bilanciamento (`src/combat/defs.ts`): il
documento dice che si tarano giocando.

### Tappa 3: il Crocevia online

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
  attacco base (combo da 3 in mischia, dardo a distanza).
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
| Abilità 1–3 | Q, E, R | Tre pulsanti ad arco |
| Ultra | F | Pulsante ★ che si illumina quando è carica |
| Interagire | G | Pulsante che compare vicino all'oggetto |
| Ping | Click centrale | Doppio tocco sul mondo |
| Emote | 1–4 | Pulsante emote |
| Classe | C | Pulsante "Classe" |
| Personaggio e talenti | P | Pulsante 👤 |
| Zaino | I | Pulsante 🎒 |
| Pozione | H | Pulsante 🧪 |

Chi è host vede anche **Abbandona**, che riporta tutti al Crocevia.

## Provarlo subito (senza account)

```bash
npm install
npm run dev
```

Apri l'indirizzo che compare. Senza Supabase il gioco parte in **modalità locale**:
le stanze funzionano tra più schede (o finestre) dello stesso browser. Crea una
partita in una scheda e apri il link di invito in un'altra.

## Giocare online, da case diverse

Il gioco è configurato per il progetto Supabase del gruppo (`.env.production`) e si
pubblica da solo su GitHub Pages a ogni aggiornamento del ramo `main`
(`.github/workflows/pages.yml`, dopo i test).

- Indirizzo: **https://itzquick.github.io/game/**. Il link d'invito porta direttamente
  nella stanza.
- Serve una sola impostazione, da fare una volta: nel repo, *Settings → Pages → Source:
  GitHub Actions*.
- Su Supabase non servono tabelle: per ora si usa solo Realtime (Presence e Broadcast),
  che deve accettare i canali pubblici (è l'impostazione predefinita).
- La chiave in `.env.production` è quella *publishable*, pubblica per natura. Non mettere
  mai lì la `sb_secret_…`/`service_role` né la chiave di Anthropic.
- **Per gli account e i salvataggi** (tappa 5), una volta sola:
  1. nel *SQL Editor* di Supabase esegui `supabase/schema.sql` (crea le tabelle `saves`
     e `groups` con le regole di sicurezza: ognuno vede solo i propri dati e quelli
     della sua compagnia);
  2. in *Authentication → Sign In / Providers → Email* disattiva **Confirm email**
     (altrimenti servirebbe un'email di conferma, e il piano gratuito ne manda pochissime).
  Senza questi passi si gioca lo stesso, da ospite.

Per usare un altro progetto Supabase basta cambiare i due valori in `.env.production`
(o crearne una copia in `.env.local` per lo sviluppo).

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
npm run test:e2e    # dopo la build: 4–5 giocatori in Chromium headless (modalità locale)
npm run test:online # dopo la build: 3 browser separati sul Supabase vero, in WebRTC
```

Parametri utili nell'URL:

- `?rete=locale` forza la modalità locale anche con Supabase configurato;
- `?rete=locale&p2p=1` usa WebRTC anche in locale (per provare il P2P su un computer solo);
- `?modelli=0` usa le forme semplici al posto dei modelli 3D.

### Struttura

```
src/
  game/      costanti (classi, mondi, movimento, rete), stato, input, sessione
  net/       stanza (host, classi, traffico), WebRTC, Supabase, interpolazione
  player/    giocatore locale (fisica e telecamera), altri giocatori, avatar
  combat/    numeri di gioco, Frattura generata, simulazione dei nemici (host),
             regia della Frattura, abilità e combo, stato del combattimento, grafica
  world/     il Crocevia, la Frattura e le interazioni
  fx/        fendenti, anelli, lampi, raggi, ping
  ui/        menu, interfaccia, controlli touch, statistiche
tests/       test unitari (vitest)
scripts/     test end-to-end multigiocatore (Playwright)
```

Le regole della stanza (`src/net/roomLogic.ts`) sono funzioni pure: ogni dispositivo
le calcola sulla stessa lista di presenti e arriva alla stessa conclusione su chi è
l'host e chi è entrato, senza un server.

Nel combattimento ognuno fa la sua parte:

- **l'host** simula i nemici (`src/combat/sim.ts`, logica pura e testata) e manda le
  loro posizioni ~15 volte al secondo, più gli attacchi con il loro preavviso;
- **chi attacca** decide chi ha colpito, sui nemici come li vede, e manda i colpi
  all'host, che aggiorna la vita dei nemici;
- **chi viene attaccato** controlla da sé se il colpo lo prende, contro la propria
  posizione vera: una schivata fatta in tempo vale sempre, anche con un po' di ritardo
  di rete;
- la Frattura si genera da un seme, quindi in rete viaggia solo un numero.

### Modelli 3D (Higgsfield)

I modelli in `public/models` arrivano da Higgsfield (immagine → modello 3D con
scheletro, poi un'animazione per file). Lo stile è il "cartoon morbido".

```bash
# quando arriva il colpo nel clip d'attacco (i clip della libreria hanno lunghe preparazioni)
node scripts/models/strike.mjs attack.glb
# unisce i clip (stesso scheletro), ritaglia l'attacco attorno al colpo,
# riduce le texture a WebP 1024, comprime la geometria
node scripts/models/prepare.mjs public/models/guardiano.glb \
  idle.glb:idle run.glb:run attack.glb:attack@0.72-1.5 down.glb:down --texture 1024
node scripts/models/inspect.mjs public/models/*.glb   # triangoli, texture, clip, misure
```

Per usarne uno nuovo basta aggiungerlo in `src/player/models.tsx` (altezza, nomi
dei clip, velocità della corsa e dell'attacco). Classi e nemici senza modello usano
ancora le forme semplici, e lo stesso succede se un file non si carica.

Quando crea lo scheletro, Higgsfield toglie gli oggetti tenuti in mano. Per questo
armi, sfera, bastone e aureola stanno in `src/player/gear.tsx` e si agganciano alle
ossa (`gear` in `models.tsx`): la posizione si dà nella posa di partenza, in metri, e
poi seguono le animazioni da sole.

Con `?modelli=0` nell'indirizzo si gioca con le forme semplici (dispositivi molto
deboli). Il test end-to-end lo usa in tutte le finestre tranne una, perché senza
scheda video tante finestre con i modelli scendono a pochi fotogrammi al secondo.

## Prossima tappa

- Gli avatar dalle foto (tappa 5, in attesa).
- Tappa 6, il narratore AI: la Città Sommersa con le sue missioni e le missioni
  giornaliere scritte da Claude, che userà il diario del gruppo.
