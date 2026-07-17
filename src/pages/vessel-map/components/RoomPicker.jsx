import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { reelOrder } from '../utils/deckOrder';

// Room selector — one compact control that stays a single line no matter how
// many rooms are scanned. Shows the current room; opens a searchable list
// grouped by deck (same vessel order as the manage reel).
export default function RoomPicker({ scans, selectedScanId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const current = scans.find((s) => s.id === selectedScanId) || null;

  // Filter by name, keep vessel order, then group by deck (unassigned last).
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? scans.filter((s) => (s.name || '').toLowerCase().includes(needle))
      : scans;
    const ordered = reelOrder(filtered);
    const byDeck = new Map();
    for (const s of ordered) {
      const key = (s.deck || '').trim();
      if (!byDeck.has(key)) byDeck.set(key, []);
      byDeck.get(key).push(s);
    }
    return [...byDeck.entries()]; // already deck-ordered by reelOrder
  }, [scans, q]);

  // Close on outside click / Escape; focus the search when it opens.
  useEffect(() => {
    if (!open) { setQ(''); return undefined; }
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (id) => { onSelect(id); setOpen(false); };

  return (
    <div className="vm-roompick" ref={wrapRef}>
      <button
        type="button"
        className={`vm-roompick-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Switch room"
      >
        <Icon name="MapPin" size={15} />
        <span className="vm-roompick-cur">{current?.name || 'Select a room'}</span>
        <span className="vm-roompick-total">{scans.length}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>

      {open && (
        <div className="vm-roompick-pop" role="listbox">
          <div className="vm-roompick-search">
            <Icon name="Search" size={14} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search rooms…"
              aria-label="Search rooms"
            />
          </div>

          <div className="vm-roompick-list">
            {groups.length === 0 && <p className="vm-roompick-empty">No rooms match “{q}”.</p>}
            {groups.map(([deck, rooms]) => (
              <div className="vm-roompick-grp" key={deck || '_none'}>
                <div className="vm-roompick-deck">{deck || 'No deck'}</div>
                {rooms.map((s) => {
                  const on = s.id === selectedScanId;
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`vm-roompick-row${on ? ' on' : ''}`}
                      onClick={() => pick(s.id)}
                      role="option"
                      aria-selected={on}
                    >
                      <span className="vm-roompick-name">{s.name}</span>
                      {on && <Icon name="Check" size={15} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
