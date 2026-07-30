import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchItemKitHolders } from '../../crew-profile/utils/crewKit';

// "With crew" breakdown on an inventory item — units out with crew (in-service
// issued kit), kept SEPARATE from the on-board stock total. Collapsed by default;
// expanded it leads with a compact per-size summary (short no matter how many
// crew hold it) then the who-has-what list, which scrolls once it gets long.
const WithCrewSection = ({ itemId }) => {
  const [holders, setHolders] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHolders([]); setOpen(false);
    if (itemId) fetchItemKitHolders(itemId).then((h) => { if (!cancelled) setHolders(h); });
    return () => { cancelled = true; };
  }, [itemId]);

  const total = holders.reduce((a, h) => a + (Number(h.qty) || 0), 0);
  if (!total) return null;

  const bySize = [...holders.reduce((m, h) => {
    const k = h.size || '';
    m.set(k, (m.get(k) || 0) + (Number(h.qty) || 0));
    return m;
  }, new Map())].map(([size, qty]) => ({ size, qty }));
  const showSizes = bySize.length > 1 || !!bySize[0]?.size;

  return (
    <div className="uv-sec">
      <button type="button" className="uv-crew-h" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="uv-crew-lbl"><Icon name="Users" size={13} /> With crew <span className="uv-crew-note">(separate from stock)</span></span>
        <span className="uv-crew-right"><span className="uv-crew-qty">{total}</span><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} /></span>
      </button>
      {open && (
        <div className="uv-crew-body">
          {showSizes && (
            <div className="uv-crew-sizes">
              {bySize.map((s) => <span className="uv-crew-chip" key={s.size || '_'}>{s.size || 'One size'} <b>×{s.qty}</b></span>)}
              <span className="uv-crew-chip crew">{holders.length} {holders.length === 1 ? 'holder' : 'holders'}</span>
            </div>
          )}
          <div className="uv-crew-list">
            {holders.map((h) => (
              <div className="uv-crew-row" key={`${h.userId}-${h.size}`}>
                <span className="uv-crew-nm">{h.name}</span>
                <span className="uv-crew-meta">{h.size ? <span className="uv-crew-sz">{h.size}</span> : null}<span className="uv-crew-x">×{h.qty}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WithCrewSection;
