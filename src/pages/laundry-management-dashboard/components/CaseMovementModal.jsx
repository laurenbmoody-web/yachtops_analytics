import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import OwSelect from './OwSelect';
import { getCaseById, updateCase, CaseStatus } from '../utils/laundryCases';
import { loadLaundryItemsByCase, setLaundryItemsCase, setLaundryItemsWardrobe, updateLaundryItem } from '../utils/laundryStorage';
import { resolveLaundryPhotos } from '../utils/laundryPhotos';
import './ownerWardrobe.css';

const STATE = {
  open: { label: 'Packing', cls: 'stored' }, packed: { label: 'Packed', cls: 'stored' },
  sent: { label: 'Sent — away', cls: 'away' }, received: { label: 'Received', cls: 'prog' }, closed: { label: 'Closed', cls: 'stored' },
};

// Drive a case through its movement: pack (elsewhere) → SEND (check every item
// out) → RECEIVE (check each back in, flag anything missing) → UNPACK into a
// chosen wardrobe. Self-contained: loads its own case + contents.
const CaseMovementModal = ({ caseId, wardrobes = [], onChanged, onClose }) => {
  const [cs, setCs] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('view'); // view | send | receive | unpack
  const [checks, setChecks] = useState(() => new Set()); // ticked item ids
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [c, its] = await Promise.all([getCaseById(caseId), loadLaundryItemsByCase(caseId)]);
    const resolved = await resolveLaundryPhotos(its).catch(() => its);
    setCs(c); setItems(resolved); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [caseId]);

  const st = STATE[cs?.status] || STATE.open;
  const ids = items.map((i) => i.id);
  const toggle = (id) => setChecks((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const startSend = () => { setChecks(new Set(ids)); setMode('send'); };
  const startReceive = () => { setChecks(new Set()); setMode('receive'); };
  const startUnpack = () => { setDest(items.find((i) => i.wardrobeId)?.wardrobeId || wardrobes[0]?.id || ''); setMode('unpack'); };

  const confirmSend = async () => {
    setBusy(true);
    const leaving = ids.filter((id) => checks.has(id));
    const notGoing = ids.filter((id) => !checks.has(id));
    if (notGoing.length) await setLaundryItemsCase(notGoing, null); // pulled back out before it leaves
    await updateCase(caseId, { status: CaseStatus.SENT });
    setBusy(false); setMode('view'); onChanged?.(); load();
  };
  const confirmReceive = async () => {
    setBusy(true);
    const missing = ids.filter((id) => !checks.has(id));
    for (const id of missing) {
      // eslint-disable-next-line no-await-in-loop
      await updateLaundryItem(id, { flag: 'missing', flagNote: `Not returned in ${cs?.name || 'case'}` });
    }
    await updateCase(caseId, { status: CaseStatus.RECEIVED });
    setBusy(false); setMode('view'); onChanged?.(); load();
  };
  const confirmUnpack = async () => {
    if (!ids.length) { onClose?.(); return; }
    setBusy(true);
    if (dest) await setLaundryItemsWardrobe(ids, dest);
    await setLaundryItemsCase(ids, null);
    await updateCase(caseId, { status: CaseStatus.CLOSED });
    setBusy(false); onChanged?.(); onClose?.();
  };
  const removeItem = async (id) => { setBusy(true); await setLaundryItemsCase([id], null); setBusy(false); onChanged?.(); load(); };

  const checking = mode === 'send' || mode === 'receive';
  const heading = mode === 'send' ? 'Confirm what’s leaving the vessel'
    : mode === 'receive' ? 'Tick each garment back in — anything unticked is flagged missing'
      : mode === 'unpack' ? 'Where should these be unpacked?' : null;

  return (
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Case movement" onClick={onClose}>
      <div className="ow-full ow-case" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ow-full-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>

        <div className="ow-case-head">
          <span className={`ow-full-state ${st.cls}`}>{st.label}</span>
          <h2 className="ow-full-nm"><Icon name="Package" size={20} /> {cs?.name || 'Case'}</h2>
          {cs?.destination && <p className="ow-full-brand">To {cs.destination}</p>}
          {heading && <div className="ow-case-note">{heading}</div>}
        </div>

        <div className="ow-case-body">
          {loading ? <p className="ow-hist-empty">Loading…</p>
            : items.length === 0 ? <p className="ow-hist-empty">This case is empty. Pack garments into it from a wardrobe.</p>
              : mode === 'unpack' ? (
                <div className="ow-case-unpack">
                  <label className="ow-l">Wardrobe</label>
                  <OwSelect value={dest} onChange={setDest} placeholder={wardrobes.length ? 'Choose a wardrobe' : 'No wardrobes yet'} options={wardrobes.map((w) => ({ value: w.id, label: [w.name, w.locationName].filter(Boolean).join(' · ') }))} />
                  <p className="ow-case-unpack-note">{items.length} garment{items.length === 1 ? '' : 's'} will be placed here and the case closed.</p>
                </div>
              ) : (
                <ul className="ow-case-list">
                  {items.map((it) => {
                    const photo = (Array.isArray(it.photos) && it.photos[0]) || it.photo || '';
                    const ticked = checks.has(it.id);
                    return (
                      <li className={`ow-case-row${checking ? ' pick' : ''}${checking && ticked ? ' on' : ''}`} key={it.id} onClick={checking ? () => toggle(it.id) : undefined}>
                        {checking && <span className="ow-case-check"><Icon name={ticked ? 'CheckSquare' : 'Square'} size={18} /></span>}
                        <span className="ow-case-thumb">{photo ? <img src={photo} alt="" /> : <Icon name="Shirt" size={16} />}</span>
                        <div className="ow-case-main">
                          <span className="ow-card-nm">{it.description || 'Garment'}</span>
                          <span className="ow-card-sub">{[it.ownerName, it.garmentType].filter(Boolean).join(' · ')}</span>
                        </div>
                        {it.flag === 'missing' && <span className="ow-case-miss">Missing</span>}
                        {!checking && <button type="button" className="ow-case-x" title="Take out of case" onClick={() => removeItem(it.id)}><Icon name="X" size={15} /></button>}
                      </li>
                    );
                  })}
                </ul>
              )}
        </div>

        <div className="ow-full-actions">
          {mode === 'view' ? (
            <>
              <span className="ow-case-count">{items.length} garment{items.length === 1 ? '' : 's'}</span>
              <span style={{ flex: 1 }} />
              {(cs?.status === 'open' || cs?.status === 'packed') && items.length > 0 && <button type="button" className="ow-btn primary" onClick={startSend}><Icon name="Send" size={15} /> Send off</button>}
              {cs?.status === 'sent' && <button type="button" className="ow-btn primary" onClick={startReceive}><Icon name="ClipboardCheck" size={15} /> Receive</button>}
              {(cs?.status === 'received' || cs?.status === 'sent') && items.length > 0 && <button type="button" className="ow-btn ghost" onClick={startUnpack}><Icon name="PackageOpen" size={15} /> Unpack</button>}
            </>
          ) : mode === 'send' ? (
            <>
              <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="ow-btn primary" disabled={busy} onClick={confirmSend}>{busy ? 'Sending…' : `Send ${checks.size} off`}</button>
            </>
          ) : mode === 'receive' ? (
            <>
              <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="ow-btn primary" disabled={busy} onClick={confirmReceive}>{busy ? 'Saving…' : `Receive (${checks.size}/${items.length})`}</button>
            </>
          ) : (
            <>
              <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="ow-btn primary" disabled={busy || !dest} onClick={confirmUnpack}>{busy ? 'Unpacking…' : 'Unpack here'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaseMovementModal;
