import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { getVesselGallery } from '../../locations-management-settings/utils/locationsGalleryStorage';
import { getVesselLayout } from '../../locations-management-settings/utils/locationsLayoutStorage';
import '../../locations-management-settings/location-gallery.css';
import './deckPlanPicker.css';

// Pure geometry helpers — copied verbatim from DeckPlanView so a room renders in
// exactly the same place on the plan.
const shapeToPath = (shape) => {
  const nodes = shape?.nodes || [];
  if (nodes.length < 2) return '';
  const P = (n) => `${(n.x * 100).toFixed(2)} ${(n.y * 100).toFixed(2)}`;
  let d = `M ${P(nodes[0])}`;
  const seg = (a, b) => ((a.h2 && b.h1) ? ` C ${P(a.h2)} ${P(b.h1)} ${P(b)}` : ` L ${P(b)}`);
  for (let i = 1; i < nodes.length; i += 1) d += seg(nodes[i - 1], nodes[i]);
  if (shape?.closed) { d += seg(nodes[nodes.length - 1], nodes[0]); d += ' Z'; }
  return d;
};
const boxAspectOf = (crop, dims) => (crop.w * dims.w) / (crop.h * dims.h) || 3;
const cropBg = (crop, url) => ({
  backgroundImage: `url("${url}")`,
  backgroundSize: `${100 / crop.w}% ${100 / crop.h}%`,
  backgroundPosition: `${crop.w < 1 ? (crop.x / (1 - crop.w)) * 100 : 0}% ${crop.h < 1 ? (crop.y / (1 - crop.h)) * 100 : 0}%`,
  backgroundRepeat: 'no-repeat',
});
const spacesOf = (deck) => (deck.zones || []).flatMap((z) => z.spaces || []);

// Visual room picker over the vessel's deck plan. Tap a traced room (or its pin)
// → onSelect(spaceId, spaceName). spaceId is the vessel_locations id.
const DeckPlanPicker = ({ selectedId = null, onSelect, onClose }) => {
  const [layout, setLayout] = useState(null);
  const [decks, setDecks] = useState([]);
  const [gaDims, setGaDims] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('plan'); // plan | list
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const [lay, gal] = await Promise.all([getVesselLayout().catch(() => null), getVesselGallery().catch(() => ({ decks: [] }))]);
      if (!live) return;
      const ds = gal?.decks || [];
      setLayout(lay); setDecks(ds);
      setActiveId((ds.find((d) => d.planCrop) || ds[0])?.id || null);
      setMode(ds.some((d) => d.planCrop) ? 'plan' : 'list'); // no traced plan → straight to the list
      setLoading(false);
      if (lay?.gaImageUrl) { const img = new Image(); img.onload = () => { if (live) setGaDims({ w: img.naturalWidth, h: img.naturalHeight }); }; img.src = lay.gaImageUrl; }
    })();
    return () => { live = false; };
  }, []);

  const deck = decks.find((d) => d.id === activeId);
  const crop = deck?.planCrop;
  const spaces = deck ? spacesOf(deck) : [];
  const ready = layout?.gaImageUrl && crop && gaDims;
  const plansExist = decks.some((d) => d.planCrop);
  const pick = (s) => onSelect?.(s);

  // Every room across every deck, grouped and searchable — the reliable path when
  // the GA isn't (fully) traced.
  const q = query.trim().toLowerCase();
  const listGroups = decks
    .map((d) => ({ deck: d, spaces: spacesOf(d).filter((s) => s.id && (!q || (s.name || '').toLowerCase().includes(q) || (d.name || '').toLowerCase().includes(q))) }))
    .filter((g) => g.spaces.length);

  return (
    <div className="dpp-overlay" role="dialog" aria-modal="true" aria-label="Pick on the deck plan" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="dpp-panel">
        <div className="dpp-head">
          <div><span className="dpp-eyebrow">Deck plan</span><h2 className="dpp-title">{mode === 'list' ? 'Pick a room' : 'Tap a room'}</h2></div>
          {plansExist && (
            <div className="dpp-toggle" role="tablist" aria-label="View">
              <button type="button" className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>Plan</button>
              <button type="button" className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>List</button>
            </div>
          )}
          <button type="button" className="dpp-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {mode === 'plan' && decks.length > 1 && (
          <div className="dpp-decks">
            {decks.map((d) => (
              <button type="button" key={d.id} className={`dpp-deck${d.id === activeId ? ' on' : ''}`} onClick={() => setActiveId(d.id)}>{d.name}</button>
            ))}
          </div>
        )}

        {mode === 'list' ? (
          <div className="dpp-liststage">
            <div className="dpp-search"><Icon name="Search" size={15} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rooms across all decks…" /></div>
            <div className="dpp-list">
              {loading ? <div className="dpp-empty">Loading rooms…</div>
                : listGroups.length === 0 ? <div className="dpp-empty">{decks.length ? 'No rooms match.' : 'No locations set up yet — add them under Locations settings.'}</div>
                  : listGroups.map((g) => (
                    <div className="dpp-list-grp" key={g.deck.id}>
                      <div className="dpp-list-deck">{g.deck.name}</div>
                      {g.spaces.map((s) => (
                        <button type="button" key={s.id} className={`dpp-list-row${s.id === selectedId ? ' on' : ''}`} onClick={() => pick(s)}>
                          <Icon name="MapPin" size={15} /><span>{s.name}</span>
                          {s.id === selectedId && <Icon name="Check" size={15} className="dpp-list-check" />}
                        </button>
                      ))}
                    </div>
                  ))}
            </div>
          </div>
        ) : (
        <div className="dpp-stage">
          {loading ? (
            <div className="dpp-empty">Loading the plan…</div>
          ) : ready ? (
            <div className="dp-plan" style={{ width: '100%', aspectRatio: String(boxAspectOf(crop, gaDims)) }}>
              <div className="dp-plan-bg" style={cropBg(crop, layout.gaImageUrl)} />
              <svg className="dp-shapes" viewBox="0 0 100 100" preserveAspectRatio="none">
                {spaces.map((s) => {
                  if (!s.planShape) return null;
                  const d = shapeToPath(s.planShape);
                  if (!d) return null;
                  const on = s.id === selectedId;
                  return (
                    <g key={s.id} className="dpp-room" onClick={() => pick(s)} style={{ cursor: 'pointer' }}>
                      <path className="dp-shape-halo" d={d} />
                      <path d={d} style={{ stroke: on ? '#C65A1A' : '#1C1B3A', strokeWidth: 0.7, fill: on ? 'rgba(198,90,26,0.20)' : 'rgba(28,27,58,0.06)', pointerEvents: 'auto' }} />
                    </g>
                  );
                })}
              </svg>
              {spaces.map((s) => ((s.planX != null && s.planY != null) ? (
                <button type="button" key={s.id} className={`dpp-pin${s.id === selectedId ? ' on' : ''}`} style={{ left: `${s.planX * 100}%`, top: `${s.planY * 100}%` }} onClick={() => pick(s)}>
                  <span className="dpp-pin-dot" />
                  <span className="dpp-pin-lbl">{s.name}</span>
                </button>
              ) : null))}
            </div>
          ) : (
            <div className="dpp-empty">
              This deck isn’t traced on the plan yet. Switch to <b>List</b> above to pick a room by name, or set up the plan under <b>Locations</b> settings.
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

export default DeckPlanPicker;
