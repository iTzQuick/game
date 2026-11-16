// Pannelli della progressione: personaggio e talenti, zaino e Forgia,
// edifici della base (contributi, biblioteca, trofei).

import { useState } from 'react';
import { CLASSES, CLASS_IDS, type ClassId } from '../game/constants';
import { setGame, useGame } from '../game/store';
import { CLASS_STATS } from '../combat/defs';
import {
  BUILDINGS,
  LORE,
  MAX_LEVEL,
  MAX_UPGRADE,
  RARITIES,
  SLOTS,
  SLOT_NAMES,
  TREES,
  formatAffix,
  itemStats,
  salvageValue,
  upgradeCost,
  xpToNext,
  type BuildingId,
  type Item,
  type StatKey,
} from '../progress/defs';
import {
  canLearn,
  classProgress,
  computeMods,
  equip,
  isBuilt,
  isEquipped,
  learn,
  pointsAvailable,
  resetTalents,
  salvage,
  unequip,
  unlockedLore,
  upgrade,
} from '../progress/model';
import { mutate, useProgress } from '../progress/store';
import { availableFragments, contributeTo } from '../progress/rewards';

const close = () => setGame({ panel: null });

function Modal({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="small" onClick={close} aria-label="Chiudi">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ProgressPanels() {
  const panel = useGame((s) => s.panel);
  if (panel === 'personaggio') return <CharacterPanel />;
  if (panel === 'zaino' || panel === 'forgia') return <InventoryPanel />;
  if (panel === 'base') return <BasePanel />;
  return null;
}

// --- personaggio e talenti ---------------------------------------------------------------

function CharacterPanel() {
  const save = useProgress((s) => s.save);
  const current = useGame((s) => s.room.classes[s.selfId] ?? null);
  const inRun = useGame((s) => !!s.room.run && s.room.run.phase !== 'countdown');
  const [cls, setCls] = useState<ClassId>(current ?? 'guardiano');
  const p = classProgress(save, cls);
  const points = pointsAvailable(p);
  const need = xpToNext(p.level);
  const mods = computeMods(save, cls);
  const maxHp = Math.round(CLASS_STATS[cls].hp * (1 + mods.hpPct) + mods.hpFlat);
  const shown: StatKey[] = ['dmgPct', 'basicPct', 'abilityPct', 'critChance', 'critDmg', 'cdr', 'speedPct', 'dmgReduction', 'healPct', 'ultraPct'];

  return (
    <Modal title="Personaggio" wide>
      <div className="tabs">
        {CLASS_IDS.map((c) => (
          <button key={c} className={c === cls ? 'on' : ''} style={{ '--cls': CLASSES[c].color } as React.CSSProperties} onClick={() => setCls(c)}>
            {CLASSES[c].icon} {CLASSES[c].name} <small>liv. {classProgress(save, c).level}</small>
          </button>
        ))}
      </div>
      <div className="char-head">
        <div>
          <b style={{ color: CLASSES[cls].color }}>
            {CLASSES[cls].name} · livello {p.level}
            {p.level >= MAX_LEVEL && ' (massimo)'}
          </b>
          {p.level < MAX_LEVEL && (
            <div className="xp-bar" title={`${p.xp}/${need} esperienza`}>
              <div className="xp-fill" style={{ width: `${(p.xp / need) * 100}%` }} />
              <span>
                {p.xp} / {need} esperienza
              </span>
            </div>
          )}
        </div>
        <div className="points">
          <b>{points}</b> {points === 1 ? 'punto' : 'punti'} talento
        </div>
      </div>
      <p className="muted small-text">
        Ogni livello dà un punto. In ogni ramo un talento si sblocca dopo quello sopra. Ogni classe ha i suoi livelli: si sale giocando con quella classe.
      </p>
      <div className="branches">
        {TREES[cls].map((b) => (
          <div className="branch" key={b.id}>
            <h3>{b.name}</h3>
            {b.nodes.map((node) => {
              const rank = p.talents[node.id] ?? 0;
              const ok = canLearn(save, cls, node.id);
              return (
                <button
                  key={node.id}
                  className={`talent${rank ? ' has' : ''}${ok ? ' can' : ''}`}
                  style={{ '--cls': CLASSES[cls].color } as React.CSSProperties}
                  disabled={!ok}
                  onClick={() => mutate((s) => learn(s, cls, node.id))}
                  title={ok ? 'Spendi un punto' : undefined}
                >
                  <span className="t-name">{node.name}</span>
                  <span className="t-desc">{node.desc}</span>
                  <span className="t-rank">
                    {rank}/{node.max}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="char-foot">
        <div className="stat-list">
          <span>
            Vita <b>{maxHp}</b>
          </span>
          {shown
            .filter((k) => mods[k] > 0)
            .map((k) => (
              <span key={k}>{formatAffix({ k, v: mods[k] })}</span>
            ))}
        </div>
        <button className="small" disabled={inRun || !Object.keys(p.talents).length} onClick={() => mutate((s) => resetTalents(s, cls))}>
          Azzera talenti
        </button>
      </div>
    </Modal>
  );
}

// --- zaino e forgia ---------------------------------------------------------------------------

const SLOT_ICON: Record<string, string> = { arma: '⚔', armatura: '🛡', amuleto: '✦' };

function ItemTile({ item, selected, onClick, equipped }: { item: Item; selected: boolean; onClick: () => void; equipped: boolean }) {
  const r = RARITIES[item.rarity];
  return (
    <button className={`item-tile${selected ? ' sel' : ''}`} style={{ '--rar': r.color } as React.CSSProperties} onClick={onClick} title={item.name}>
      <span className="it-icon">{SLOT_ICON[item.slot]}</span>
      <span className="it-name">{item.name}</span>
      <span className="it-meta">
        liv. {item.ilvl}
        {item.up > 0 && ` · +${item.up}`}
      </span>
      {equipped && <span className="it-eq">in uso</span>}
    </button>
  );
}

function InventoryPanel() {
  const save = useProgress((s) => s.save);
  const forge = useGame((s) => isBuilt(s.room, 'forgia'));
  const inRun = useGame((s) => !!s.room.run && s.room.run.phase !== 'countdown');
  const [sel, setSel] = useState<string | null>(null);
  const items = [...save.inventory].sort((a, b) => b.rarity - a.rarity || b.ilvl - a.ilvl || b.up - a.up);
  const item = save.inventory.find((i) => i.id === sel) ?? null;
  const worn = item ? save.inventory.find((i) => i.id === save.equipped[item.slot]) : undefined;
  const commons = save.inventory.filter((i) => i.rarity === 0 && !isEquipped(save, i.id));

  return (
    <Modal title="Zaino" wide>
      <div className="inv-head">
        <span>
          Frammenti: <b className="frags">{save.fragments}</b>
        </span>
        <span className="muted small-text">
          {save.inventory.length}/40 oggetti ·{' '}
          {forge ? (inRun ? 'la Forgia si usa al Crocevia' : 'Forgia pronta: puoi potenziare') : 'costruite la Forgia per potenziare gli oggetti'}
        </span>
      </div>
      <div className="equipped">
        {SLOTS.map((slot) => {
          const it = save.inventory.find((i) => i.id === save.equipped[slot]);
          return (
            <div key={slot} className="eq-slot">
              <small>{SLOT_NAMES[slot]}</small>
              {it ? (
                <ItemTile item={it} selected={sel === it.id} onClick={() => setSel(it.id)} equipped={false} />
              ) : (
                <div className="item-tile empty">vuoto</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="inv-body">
        <div className="inv-grid">
          {items.length === 0 && <p className="muted">Lo zaino è vuoto: il bottino si trova ripulendo le stanze delle Fratture.</p>}
          {items.map((it) => (
            <ItemTile key={it.id} item={it} selected={sel === it.id} onClick={() => setSel(it.id)} equipped={isEquipped(save, it.id)} />
          ))}
        </div>
        {item && (
          <div className="item-detail" style={{ '--rar': RARITIES[item.rarity].color } as React.CSSProperties}>
            <b className="it-title">{item.name}</b>
            <small>
              {RARITIES[item.rarity].name} · {SLOT_NAMES[item.slot]} · livello {item.ilvl}
              {item.up > 0 && ` · potenziato +${item.up}`}
            </small>
            <ul>
              {itemStats(item).map((a, i) => (
                <li key={i}>{formatAffix(a)}</li>
              ))}
            </ul>
            {worn && worn.id !== item.id && (
              <div className="compare">
                <small>Ora indossi: {worn.name}</small>
                <ul>
                  {itemStats(worn).map((a, i) => (
                    <li key={i}>{formatAffix(a)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="item-actions">
              {isEquipped(save, item.id) ? (
                <button onClick={() => mutate((s) => unequip(s, item.slot))}>Togli</button>
              ) : (
                <button className="primary" onClick={() => mutate((s) => equip(s, item.id))}>
                  Indossa
                </button>
              )}
              {forge && !inRun && item.up < MAX_UPGRADE && (
                <button disabled={save.fragments < upgradeCost(item)} onClick={() => mutate((s) => upgrade(s, item.id))}>
                  Potenzia ({upgradeCost(item)} frammenti)
                </button>
              )}
              {!isEquipped(save, item.id) && (
                <button
                  className="danger"
                  onClick={() => {
                    mutate((s) => salvage(s, item.id));
                    setSel(null);
                  }}
                >
                  Smonta (+{salvageValue(item)})
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {commons.length > 1 && (
        <div className="modal-actions">
          <button className="small" onClick={() => mutate((s) => commons.forEach((c) => salvage(s, c.id)))}>
            Smonta tutti i comuni ({commons.length})
          </button>
        </div>
      )}
    </Modal>
  );
}

// --- edifici della base ------------------------------------------------------------------

function BasePanel() {
  const id = useGame((s) => s.building) as BuildingId | null;
  const def = BUILDINGS.find((b) => b.id === id);
  const state = useGame((s) => (id ? s.room.base[id] : undefined));
  const gstats = useGame((s) => s.room.gstats);
  const grado = useGame((s) => s.room.grado);
  const best = useGame((s) => s.room.best);
  const mine = useProgress((s) => s.save.stats);
  useProgress((s) => s.save.fragments);
  if (!def) return null;
  const built = !!state?.u;
  const have = availableFragments();
  const p = state?.p ?? 0;

  return (
    <Modal title={def.name}>
      <p className="muted">{def.desc}</p>
      {def.later ? (
        <p>Non si può ancora costruire: {def.later}.</p>
      ) : !built ? (
        <>
          <div className="xp-bar build">
            <div className="xp-fill" style={{ width: `${(p / def.cost) * 100}%`, background: def.color }} />
            <span>
              {p} / {def.cost} frammenti
            </span>
          </div>
          <p className="small-text muted">Tutto il gruppo può versare i propri frammenti. I tuoi: {have}.</p>
          <div className="modal-actions spread">
            {[10, 50].map((n) => (
              <button key={n} disabled={have < 1} onClick={() => contributeTo(def.id, Math.min(n, have))}>
                Versa {n}
              </button>
            ))}
            <button className="primary" disabled={have < 1} onClick={() => contributeTo(def.id, have)}>
              Versa tutto ({have})
            </button>
          </div>
        </>
      ) : def.id === 'forgia' ? (
        <div className="modal-actions">
          <button className="primary" onClick={() => setGame({ panel: 'zaino' })}>
            Apri lo zaino per potenziare
          </button>
        </div>
      ) : def.id === 'giardino' ? (
        <p>Ogni Frattura parte con una pozione a testa: tasto H (o il pulsante 🧪 sul telefono).</p>
      ) : def.id === 'biblioteca' ? (
        <Library />
      ) : def.id === 'trofei' ? (
        <div className="trophies">
          <div>
            <b>{grado}</b>
            <small>Grado del gruppo</small>
          </div>
          <div>
            <b>{best || '–'}</b>
            <small>record</small>
          </div>
          <div>
            <b>{gstats.fratture}</b>
            <small>Fratture richiuse</small>
          </div>
          <div>
            <b>{gstats.bosses}</b>
            <small>Echi sconfitti</small>
          </div>
          <div>
            <b>{gstats.kills}</b>
            <small>nemici sconfitti</small>
          </div>
          <div>
            <b>{mine.kills}</b>
            <small>sconfitti da te</small>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function Library() {
  const gstats = useGame((s) => s.room.gstats);
  const best = useGame((s) => s.room.best);
  const open = unlockedLore(gstats, best);
  return (
    <div className="lore">
      {open.map((l) => (
        <article key={l.id}>
          <h3>{l.title}</h3>
          <p>{l.text}</p>
        </article>
      ))}
      {open.length < LORE.length && (
        <p className="muted small-text">Altri {LORE.length - open.length} indizi aspettano nelle Fratture più profonde.</p>
      )}
    </div>
  );
}

