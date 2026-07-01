import React, { useEffect, useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { fetchCabins, saveCabins } from '../utils/vesselCabins';
import './configure-cabins.css';

const DECKS = ['Lower deck · fwd', 'Lower deck · aft', 'Main deck', 'Upper deck', 'Bridge deck', 'Tank deck', 'Crew mess'];
const LINEN = ['—', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PRESETS = { single: ['Single'], double: ['Double'], bunk: ['Upper', 'Lower'], twin: ['Bed A', 'Bed B'] };
let uid = 1;
const mkBeds = (labels) => labels.map((label) => ({ label, _k: uid++ }));

const ConfigureCabinsModal = ({ isOpen, onClose, tenantId, userId, crewAboard = 0, onSaved }) => {
  const [cabins, setCabins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true); setDirty(false);
    (async () => {
      const rows = await fetchCabins(tenantId);
      if (cancelled) return;
      setCabins(rows.map((c) => ({
        id: c.id, name: c.name || '', deck: c.deck || DECKS[0], linen: c.linen_day || '—',
        beds: (c.beds || []).map((b) => ({ id: b.id, label: b.label, _k: uid++ })), _k: uid++,
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  const totalBeds = cabins.reduce((n, c) => n + c.beds.length, 0);
  const diff = totalBeds - crewAboard;
  const fit = diff === 0 ? ['ok', 'Fully bunked']
    : diff > 0 ? ['spare', `${diff} spare bed${diff === 1 ? '' : 's'}`]
      : ['short', `${-diff} bed${diff === -1 ? '' : 's'} short`];
  const pct = crewAboard ? Math.min(totalBeds / crewAboard, 1) * 100 : (totalBeds ? 100 : 0);
  const over = crewAboard ? Math.min(Math.max(totalBeds - crewAboard, 0) / crewAboard, 0.2) * 100 : 0;

  const mutate = (fn) => { setDirty(true); setCabins((prev) => fn(prev.map((c) => ({ ...c, beds: [...c.beds] })))); };
  const setField = (i, k, v) => mutate((cs) => { cs[i][k] = v; return cs; });
  const setBed = (i, j, v) => mutate((cs) => { cs[i].beds[j] = { ...cs[i].beds[j], label: v }; return cs; });
  const addBed = (i) => mutate((cs) => { cs[i].beds.push({ label: `Bed ${String.fromCharCode(65 + cs[i].beds.length)}`, _k: uid++ }); return cs; });
  const delBed = (i, j) => mutate((cs) => { cs[i].beds.splice(j, 1); return cs; });
  const delCabin = (i) => mutate((cs) => { cs.splice(i, 1); return cs; });
  const addPreset = (kind) => mutate((cs) => { cs.push({ name: `Cabin ${cs.length + 1}`, deck: DECKS[0], linen: '—', beds: mkBeds(PRESETS[kind]), _k: uid++ }); return cs; });

  const decksPresent = DECKS.filter((d) => cabins.some((c) => c.deck === d))
    .concat([...new Set(cabins.map((c) => c.deck))].filter((d) => !DECKS.includes(d)));

  const save = async () => {
    setSaving(true);
    try {
      await saveCabins(tenantId, cabins, userId);
      showToast('Cabins saved', 'success');
      onSaved?.();
      onClose?.();
    } catch (e) {
      showToast(e?.message || 'Could not save cabins', 'error');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} isBusy={saving} isDirty={dirty} panelClassName="cc-panel">
      <div className="cc">
        <aside className="cc-rail">
          <div className="cc-ey">Configure</div>
          <h2>Cabins</h2>
          <div className="cc-vessel">⚓ Crew cabins</div>
          <div className="cc-rule" />
          <div className="cc-dh">Capacity</div>
          <div className="cc-cap">
            <div className="cc-big"><span className="n">{totalBeds}</span><span className="u">beds</span></div>
            <div className="cc-sub">{crewAboard ? `for ${crewAboard} crew aboard` : 'no crew aboard this month'}</div>
            <div className="cc-capbar">
              <i style={{ width: `${pct}%`, background: diff < 0 ? '#E8956A' : '#7FCBA6' }} />
              {over > 0 && <i style={{ width: `${over}%`, background: 'rgba(255,255,255,.25)' }} />}
            </div>
            {!!crewAboard && <span className={`cc-fit ${fit[0]}`}><span className="d" />{fit[1]}</span>}
          </div>
          <div className="cc-quick">
            <div className="cc-dh">Quick add</div>
            <div className="cc-presets">
              <button type="button" className="cc-preset" onClick={() => addPreset('single')}><span className="t">Single</span><span className="s">1 bed</span></button>
              <button type="button" className="cc-preset" onClick={() => addPreset('double')}><span className="t">Double</span><span className="s">1 double bed</span></button>
              <button type="button" className="cc-preset" onClick={() => addPreset('bunk')}><span className="t">Bunk</span><span className="s">upper · lower</span></button>
              <button type="button" className="cc-preset" onClick={() => addPreset('twin')}><span className="t">Twin</span><span className="s">2 single beds</span></button>
            </div>
          </div>
        </aside>

        <div className="cc-main">
          <div className="cc-body">
            {loading ? (
              <div className="cc-empty">Loading cabins…</div>
            ) : cabins.length === 0 ? (
              <div className="cc-empty">No cabins yet — use <b>Quick add</b> to build the vessel's cabins.</div>
            ) : decksPresent.map((dk) => {
              const inDeck = cabins.map((c, i) => ({ c, i })).filter((x) => x.c.deck === dk);
              const beds = inDeck.reduce((n, x) => n + x.c.beds.length, 0);
              return (
                <React.Fragment key={dk}>
                  <div className="cc-group"><span className="sq" /><span className="gt">{dk}</span><span className="gl" /><span className="gc">{inDeck.length} cabin{inDeck.length === 1 ? '' : 's'} · {beds} bed{beds === 1 ? '' : 's'}</span></div>
                  {inDeck.map(({ c, i }) => (
                    <div className="cc-cab" key={c._k}>
                      <div className="cc-r1">
                        <span className="cc-drag">⋮⋮</span>
                        <span className="cc-nm"><input value={c.name} placeholder="Cabin name / number" onChange={(e) => setField(i, 'name', e.target.value)} /></span>
                        <span className="cc-bedcount">{c.beds.length} bed{c.beds.length === 1 ? '' : 's'}</span>
                        <button type="button" className="cc-trash" title="Remove cabin" onClick={() => delCabin(i)}>✕</button>
                      </div>
                      <div className="cc-meta">
                        <span className="cc-field"><span className="fk">Deck</span>
                          <select value={c.deck} onChange={(e) => setField(i, 'deck', e.target.value)}>{DECKS.map((d) => <option key={d}>{d}</option>)}</select>
                        </span>
                        <span className="cc-field"><span className="fk">Linen</span>
                          <select value={c.linen} onChange={(e) => setField(i, 'linen', e.target.value)}>{LINEN.map((d) => <option key={d}>{d}</option>)}</select>
                        </span>
                      </div>
                      <div className="cc-beds"><span className="bk">Beds</span>
                        {c.beds.map((b, j) => (
                          <span className="cc-bed" key={b._k}>
                            <span className="ic">🛏</span>
                            <input value={b.label} onChange={(e) => setBed(i, j, e.target.value)} />
                            <button type="button" className="bx" title="Remove bed" onClick={() => delBed(i, j)}>×</button>
                          </span>
                        ))}
                        <button type="button" className="cc-addbed" onClick={() => addBed(i)}>+ bed</button>
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
            {!loading && <button type="button" className="cc-addcab" onClick={() => addPreset('single')}>+ Add cabin</button>}
          </div>
          <div className="cc-foot">
            <span className="cc-hint">Name can be a number (“3”) or a word (“VIP”). Linen day = when interior strips &amp; remakes. Laundry number/colour is per crew in Issued Kit.</span>
            <div className="cc-btns">
              <button type="button" className="cc-ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="cc-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save cabins'}</button>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default ConfigureCabinsModal;
