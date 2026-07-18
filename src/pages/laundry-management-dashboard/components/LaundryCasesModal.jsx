import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { loadCases, createCase, updateCase, archiveCase, getCaseById, CASE_FLOW, CaseStatusLabels } from '../utils/laundryCases';
import { setLaundryItemsCase } from '../utils/laundryStorage';
import { printCaseManifest } from '../utils/laundryLabels';
import './laundryCases.css';

const ownerText = (it) => {
  const k = (it?.ownerType || '').toLowerCase();
  if (k === 'other') return 'Other';
  return it?.ownerName || (k === 'guest' ? 'Guest' : k === 'crew' ? 'Crew' : 'Unassigned');
};

// Cases manager: list vessel cases, open one to pack/unpack items, move it
// through its lifecycle, and print its QR label + manifest. Items come from the
// dashboard's already-loaded set so the two stay in sync; membership writes go
// through setLaundryItemsCase and notify the parent to reload.
const LaundryCasesModal = ({ onClose, items = [], initialCaseId = null, onChanged }) => {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDest, setNewDest] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickSel, setPickSel] = useState({});
  // Local mirror of item→case so the UI updates instantly; parent reloads too.
  const [caseOf, setCaseOf] = useState(() => Object.fromEntries(items.map((i) => [i.id, i.caseId || null])));
  useEffect(() => { setCaseOf(Object.fromEntries(items.map((i) => [i.id, i.caseId || null]))); }, [items]);

  const refresh = async () => { setCases(await loadCases()); setLoading(false); };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!initialCaseId) return;
    (async () => { if (!(await getCaseById(initialCaseId))) return; setSelId(initialCaseId); })();
  }, [initialCaseId]);

  const sel = useMemo(() => cases.find((c) => c.id === selId) || null, [cases, selId]);
  const countFor = (cid) => items.filter((i) => (caseOf[i.id] || null) === cid).length;
  const caseItems = useMemo(() => (sel ? items.filter((i) => (caseOf[i.id] || null) === sel.id) : []), [sel, items, caseOf]);
  const looseItems = useMemo(() => items.filter((i) => !(caseOf[i.id] || null)), [items, caseOf]);

  const doCreate = async () => {
    const c = await createCase({ name: newName, destination: newDest });
    if (c) { setNewName(''); setNewDest(''); setCreating(false); await refresh(); setSelId(c.id); }
  };

  const persistMembership = async (ids, caseId) => {
    setCaseOf((prev) => { const n = { ...prev }; ids.forEach((id) => { n[id] = caseId; }); return n; });
    await setLaundryItemsCase(ids, caseId);
    onChanged?.();
  };

  const confirmPack = async () => {
    const ids = Object.keys(pickSel).filter((id) => pickSel[id]);
    if (ids.length && sel) await persistMembership(ids, sel.id);
    setPickSel({}); setPicking(false);
  };

  const setStatus = async (status) => {
    if (!sel) return;
    const u = await updateCase(sel.id, { status });
    if (u) setCases((prev) => prev.map((c) => (c.id === u.id ? u : c)));
  };

  const removeCase = async () => {
    if (!sel) return;
    if (!window.confirm(`Remove “${sel.name}”? Items in it will return to the loose list.`)) return;
    const ids = items.filter((i) => (caseOf[i.id] || null) === sel.id).map((i) => i.id);
    setCaseOf((prev) => { const n = { ...prev }; ids.forEach((id) => { n[id] = null; }); return n; });
    await archiveCase(sel.id);
    onChanged?.();
    setSelId(null);
    await refresh();
  };

  return (
    <div className="lcm-overlay" role="dialog" aria-modal="true" aria-label="Laundry cases" onClick={onClose}>
      <div className="lcm-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lcm-head">
          <div>
            <span className="lcm-eyebrow">Laundry</span>
            <h2 className="lcm-title">{sel ? sel.name : 'Cases'}</h2>
          </div>
          <button type="button" className="lcm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {!sel && (
          <div className="lcm-body">
            {creating ? (
              <div className="lcm-newform">
                <input className="lcm-input" autoFocus placeholder="Case name (e.g. Cabin 3 — resort wear)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <input className="lcm-input" placeholder="Bound for (optional) — e.g. shore laundry" value={newDest} onChange={(e) => setNewDest(e.target.value)} />
                <div className="lcm-newform-actions">
                  <button type="button" className="lcm-btn ghost" onClick={() => { setCreating(false); setNewName(''); setNewDest(''); }}>Cancel</button>
                  <button type="button" className="lcm-btn primary" disabled={!newName.trim()} onClick={doCreate}>Create case</button>
                </div>
              </div>
            ) : (
              <button type="button" className="lcm-new" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New case</button>
            )}

            {loading ? (
              <div className="lcm-empty">Loading cases…</div>
            ) : cases.length === 0 && !creating ? (
              <div className="lcm-empty">No cases yet. Create one to start packing items for sending or receiving.</div>
            ) : (
              <div className="lcm-list">
                {cases.map((c) => (
                  <button type="button" className="lcm-row" key={c.id} onClick={() => setSelId(c.id)}>
                    <div className="lcm-row-main">
                      <span className="lcm-row-nm">{c.name}</span>
                      <span className="lcm-row-sub">{c.destination ? `→ ${c.destination}` : 'On board'}</span>
                    </div>
                    <span className={`lcm-status s-${c.status}`}>{CaseStatusLabels[c.status] || c.status}</span>
                    <span className="lcm-count">{countFor(c.id)}<small>pcs</small></span>
                    <Icon name="ChevronRight" size={16} className="lcm-chev" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {sel && !picking && (
          <div className="lcm-body">
            <button type="button" className="lcm-back" onClick={() => setSelId(null)}><Icon name="ArrowLeft" size={15} /> All cases</button>

            <div className="lcm-flow">
              {CASE_FLOW.map((s) => (
                <button type="button" key={s} className={`lcm-flow-pill${sel.status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
                  {CaseStatusLabels[s]}
                </button>
              ))}
            </div>
            {sel.destination && <div className="lcm-dest"><Icon name="MapPin" size={13} /> Bound for <b>{sel.destination}</b></div>}

            <div className="lcm-sec-head">
              <span>Packed · {caseItems.length}</span>
              <div className="lcm-sec-actions">
                <button type="button" className="lcm-mini" onClick={() => setPicking(true)}><Icon name="Plus" size={14} /> Add items</button>
                <button type="button" className="lcm-mini" onClick={() => printCaseManifest(sel, caseItems)}><Icon name="Printer" size={14} /> Label &amp; manifest</button>
              </div>
            </div>

            {caseItems.length === 0 ? (
              <div className="lcm-empty">Nothing packed. Tap “Add items” to pack this case.</div>
            ) : (
              <div className="lcm-items">
                {caseItems.map((it) => (
                  <div className="lcm-item" key={it.id}>
                    <div className="lcm-item-main">
                      <span className="lcm-item-nm">{it.description || 'Laundry item'}</span>
                      <span className="lcm-item-sub">{ownerText(it)}{it.area ? ` · ${it.area}` : ''}{it.laundryNumber ? ` · No. ${it.laundryNumber}` : ''}</span>
                    </div>
                    <button type="button" className="lcm-remove" onClick={() => persistMembership([it.id], null)} aria-label="Remove from case"><Icon name="X" size={15} /></button>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="lcm-danger" onClick={removeCase}><Icon name="Trash2" size={14} /> Remove case</button>
          </div>
        )}

        {sel && picking && (
          <div className="lcm-body">
            <button type="button" className="lcm-back" onClick={() => { setPicking(false); setPickSel({}); }}><Icon name="ArrowLeft" size={15} /> Back to case</button>
            <div className="lcm-sec-head"><span>Loose items · pick to pack</span></div>
            {looseItems.length === 0 ? (
              <div className="lcm-empty">No loose items — everything is already in a case.</div>
            ) : (
              <div className="lcm-items">
                {looseItems.map((it) => (
                  <label className="lcm-pick" key={it.id}>
                    <input type="checkbox" checked={!!pickSel[it.id]} onChange={(e) => setPickSel((p) => ({ ...p, [it.id]: e.target.checked }))} />
                    <div className="lcm-item-main">
                      <span className="lcm-item-nm">{it.description || 'Laundry item'}</span>
                      <span className="lcm-item-sub">{ownerText(it)}{it.area ? ` · ${it.area}` : ''}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="lcm-pick-actions">
              <button type="button" className="lcm-btn ghost" onClick={() => { setPicking(false); setPickSel({}); }}>Cancel</button>
              <button type="button" className="lcm-btn primary" disabled={!Object.values(pickSel).some(Boolean)} onClick={confirmPack}>
                Pack {Object.values(pickSel).filter(Boolean).length || ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LaundryCasesModal;
