import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { loadCases, createCase, CaseStatusLabels } from '../utils/laundryCases';
import './ownerWardrobe.css';

const STATE_CLS = { open: 'stored', packed: 'stored', sent: 'away', received: 'prog', closed: 'stored' };

// The vessel's cases (movement containers). Open one to drive its send / receive
// / unpack; create a new one to pack into. Counts come from the loaded item set.
const CasesListModal = ({ items = [], onOpenCase, onClose }) => {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => { setCases(await loadCases()); setLoading(false); };
  useEffect(() => { refresh(); }, []);

  const countFor = (id) => items.filter((i) => i.caseId === id).length;
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const c = await createCase({ name: name.trim(), destination: dest.trim() });
    setBusy(false); setCreating(false); setName(''); setDest('');
    if (c) onOpenCase?.(c.id);
  };

  return (
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Cases" onClick={onClose}>
      <div className="ow-chooser" onClick={(e) => e.stopPropagation()}>
        <div className="ow-modal-head">
          <div><span className="ow-eyebrow">Wardrobe</span><h2 className="ow-modal-title">Cases &amp; movements</h2></div>
          <button type="button" className="ow-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ow-wm-list">
          {loading ? <p className="ow-hist-empty" style={{ padding: '8px 4px' }}>Loading…</p>
            : cases.length === 0 && !creating ? <p className="ow-empty-note" style={{ padding: '8px 4px' }}>No cases yet. Create one to pack garments for travel.</p>
              : cases.map((c) => {
                const n = countFor(c.id);
                return (
                  <button type="button" className="ow-wm-row ow-case-open" key={c.id} onClick={() => onOpenCase?.(c.id)}>
                    <span className="ow-wm-ic"><Icon name="Package" size={16} /></span>
                    <div className="ow-wm-main">
                      <span className="ow-wm-nm">{c.name}</span>
                      <span className="ow-wm-sub">{[c.destination ? `To ${c.destination}` : null, `${n} garment${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className={`ow-status sm ${STATE_CLS[c.status] || 'stored'}`}>{CaseStatusLabels[c.status] || c.status}</span>
                    <Icon name="ChevronRight" size={16} className="ow-chooser-chev" />
                  </button>
                );
              })}
          {creating && (
            <div className="ow-case-new">
              <input className="ow-input" autoFocus placeholder="Case name (e.g. Nice → Monaco)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
              <input className="ow-input" placeholder="Destination (optional)" value={dest} onChange={(e) => setDest(e.target.value)} />
              <div className="ow-case-new-acts">
                <button type="button" className="ow-btn ghost" onClick={() => setCreating(false)}>Cancel</button>
                <button type="button" className="ow-btn primary" disabled={!name.trim() || busy} onClick={create}>{busy ? 'Creating…' : 'Create & open'}</button>
              </div>
            </div>
          )}
        </div>

        {!creating && (
          <div className="ow-wm-foot">
            <button type="button" className="ow-btn primary" onClick={() => setCreating(true)}><Icon name="Plus" size={15} /> New case</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CasesListModal;
