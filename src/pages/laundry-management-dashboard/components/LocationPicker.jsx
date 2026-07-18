import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { getAllDecks, getAllZones, getAllSpaces } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import DeckPlanPicker from './DeckPlanPicker';
import MapPickerModal from '../../vessel-map/components/MapPickerModal';
import './locationPicker.css';

// Reusable "pick a vessel location" combobox — leaf spaces grouped under their
// deck (the same shape the laundry intake uses). Value is the vessel_locations
// id; onChange gets ({ id, name, label }) or (null) when cleared.
const LocationPicker = ({ value, valueLabel = '', onChange, placeName = 'Storage locker', placeholder = 'Search deck, zone or cabin…' }) => {
  const [locations, setLocations] = useState([]);
  const [query, setQuery] = useState(valueLabel || '');
  const [open, setOpen] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [scanPlace, setScanPlace] = useState(null); // scan id to open in the 3D picker

  useEffect(() => { setQuery(valueLabel || ''); }, [valueLabel]);

  useEffect(() => {
    (async () => {
      try {
        const [decks, zones, spaces] = await Promise.all([getAllDecks(), getAllZones(), getAllSpaces()]);
        const deckName = new Map((decks || []).map((d) => [d?.id, d?.name]));
        const zoneById = new Map((zones || []).map((z) => [z?.id, z]));
        setLocations((spaces || []).map((s) => {
          const z = zoneById.get(s?.zoneId);
          const deck = (z ? deckName.get(z?.deckId) : '') || '';
          const zone = z?.name || '';
          const name = s?.name || '';
          return { id: s?.id, name, deck, zone, label: [deck, zone, name].filter(Boolean).join(' → ') };
        }));
      } catch { setLocations([]); }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? locations.filter((l) => l.label.toLowerCase().includes(q)) : locations;
    const order = []; const byDeck = new Map();
    list.forEach((loc) => { const d = loc.deck || 'Elsewhere'; if (!byDeck.has(d)) { byDeck.set(d, []); order.push(d); } byDeck.get(d).push(loc); });
    return order.map((deck) => ({ deck, items: byDeck.get(deck) }));
  }, [locations, query]);

  const pick = (loc) => { onChange?.({ id: loc.id, name: loc.name, label: loc.label }); setQuery(loc.name); setOpen(false); };
  const clear = () => { onChange?.(null); setQuery(''); };

  return (
    <div className="lp">
      <div className="lp-field">
        <Icon name="MapPin" size={15} className="lp-ic" />
        <input
          type="text" value={query} placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {(value || query) && <button type="button" className="lp-clear" onMouseDown={(e) => e.preventDefault()} onClick={clear} aria-label="Clear"><Icon name="X" size={14} /></button>}
      </div>
      {open && filtered.length > 0 && (
        <div className="lp-menu">
          {filtered.map((g) => (
            <div key={g.deck} className="lp-group">
              <div className="lp-deck">{g.deck}</div>
              {g.items.map((loc) => (
                <button key={loc.id} type="button" className="lp-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(loc)}>
                  <span className="lp-name">{loc.name || loc.label}</span>
                  {loc.zone && loc.zone !== loc.name && <span className="lp-zone">{loc.zone}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="lp-onmap" onClick={() => setShowPlan(true)}><Icon name="Map" size={14} /> Pick on the deck plan</button>
      {showPlan && (
        <DeckPlanPicker
          selectedId={value}
          onSelect={(space) => {
            setShowPlan(false);
            if (space?.scan?.id) { setScanPlace(space.scan.id); return; }
            // Room has no 3-D scan — fall back to the room itself as the location.
            onChange?.({ id: space.id, name: space.name, label: space.name });
            setQuery(space.name);
          }}
          onClose={() => setShowPlan(false)}
        />
      )}
      {scanPlace && (
        <MapPickerModal
          initialScanId={scanPlace}
          placingStorage={{ name: placeName }}
          onPlaced={(res) => { if (res?.locationId) { onChange?.({ id: res.locationId, name: res.name || placeName, label: res.name || placeName }); setQuery(res.name || placeName); } }}
          onClose={() => setScanPlace(null)}
        />
      )}
    </div>
  );
};

export default LocationPicker;
