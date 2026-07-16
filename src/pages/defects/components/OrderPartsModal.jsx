// Order parts from a defect. Collects the parts you need (free text, with an
// inventory autocomplete so known items snap in), then raises a draft
// provisioning requisition linked back to the defect. If the defect already has
// a linked contractor/supplier, the lines are threaded to that vendor so the
// board groups them for sending.
import React, { useEffect, useRef, useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import { useDefectActor } from '../utils/useDefectActor';
import { createDefectRequisition, searchInventoryItems } from '../utils/defectRequisition';
import './OrderPartsModal.css';

const blankLine = () => ({ name: '', qty: '1', unit: '' });

export default function OrderPartsModal({ defect, onClose, onCreated }) {
  const actor = useDefectActor();
  const [lines, setLines] = useState([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sugg, setSugg] = useState({ i: -1, items: [] });
  const suggReq = useRef(0);

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((_, j) => j !== i)));

  const onName = async (i, v) => {
    setLine(i, { name: v });
    if (!actor?.tenantId || v.trim().length < 2) { setSugg({ i: -1, items: [] }); return; }
    const seq = ++suggReq.current;
    const items = await searchInventoryItems(v.trim(), actor.tenantId);
    if (seq === suggReq.current) setSugg({ i, items: (items || []).slice(0, 6) });
  };
  const pickSugg = (i, it) => {
    setLine(i, { name: it.name, unit: it.unit || '' });
    setSugg({ i: -1, items: [] });
  };

  const submit = async () => {
    const clean = lines.filter((l) => l.name.trim());
    if (!clean.length) { setErr('Add at least one part.'); return; }
    setBusy(true); setErr('');
    try {
      const list = await createDefectRequisition(defect, clean, actor);
      onCreated?.(list);
    } catch (e) {
      setErr(e?.message || 'Could not raise the requisition.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <ModalShell onClose={onClose} panelClassName="op" isBusy={busy}>
      <div className="op-head">
        <div>
          <p className="op-eyebrow">Order parts · {defect.ref}</p>
          <h3>What do you need to fix this?</h3>
        </div>
        <button className="op-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      </div>

      {defect.contractorSupplierId && defect.contractorName && (
        <div className="op-vendor"><Icon name="Wrench" size={13} /> Lines will group to <b>{defect.contractorName}</b> on the board.</div>
      )}

      <div className="op-body">
        {lines.map((l, i) => (
          <div className="op-line" key={i}>
            <div className="op-namewrap">
              <input className="op-input" value={l.name} placeholder="Part or material…"
                onChange={(e) => onName(i, e.target.value)} onBlur={() => setTimeout(() => setSugg({ i: -1, items: [] }), 120)} />
              {sugg.i === i && sugg.items.length > 0 && (
                <div className="op-sugg">
                  {sugg.items.map((it) => (
                    <button type="button" key={it.id} className="op-sugg-opt" onMouseDown={() => pickSugg(i, it)}>
                      <span className="nm">{it.name}</span>
                      {it.brand && <span className="br">{it.brand}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input className="op-input qty" value={l.qty} inputMode="numeric" aria-label="Quantity"
              onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} />
            <input className="op-input unit" value={l.unit} placeholder="unit" aria-label="Unit"
              onChange={(e) => setLine(i, { unit: e.target.value })} />
            <button type="button" className="op-rm" onClick={() => removeLine(i)} aria-label="Remove line"><Icon name="X" size={14} /></button>
          </div>
        ))}
        <button type="button" className="op-add" onClick={addLine}><Icon name="Plus" size={14} /> Add part</button>
      </div>

      {err && <p className="op-err">{err}</p>}
      <div className="op-foot">
        <button className="op-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="op-btn primary" onClick={submit} disabled={busy}>{busy ? 'Raising…' : 'Raise requisition'}</button>
      </div>
    </ModalShell>
  );
}
