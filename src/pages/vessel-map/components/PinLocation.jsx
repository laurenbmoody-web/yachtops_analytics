// "In this cupboard" — a pin links to an inventory location (the row's
// existing storage_location_id), and its contents render LIVE from
// inventory with deep links to /inventory/item/{id}. Nobody retypes lists:
// when inventory changes, every pin is already correct.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import {
  searchInventoryLocations, getInventoryLocation, itemsAtLocation, locationLabel,
} from '../utils/inventory';

const SHOW_MAX = 12;

export default function PinLocation({ hotspot, canManage, tenantId, onLocationChanged }) {
  const [location, setLocation] = useState(null);
  const [items, setItems] = useState(null); // null = loading
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const debounce = useRef(null);
  const navigate = useNavigate();

  // Load the linked location + its live contents.
  useEffect(() => {
    let cancelled = false;
    setLocation(null);
    setItems(null);
    setError(null);
    setPicking(false);
    setShowAll(false);
    if (!hotspot?.storage_location_id) return undefined;
    (async () => {
      const { location: loc, error: locError } = await getInventoryLocation(hotspot.storage_location_id);
      if (cancelled) return;
      if (locError) { setError(locError); setItems([]); return; }
      setLocation(loc);
      const { items: found, error: itemsError } = await itemsAtLocation(tenantId, loc);
      if (cancelled) return;
      if (itemsError) { setError(itemsError); setItems([]); return; }
      setItems(found);
    })();
    return () => { cancelled = true; };
  }, [hotspot?.id, hotspot?.storage_location_id, tenantId]);

  // Debounced location search while picking.
  useEffect(() => {
    if (!picking) return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { locations, error: searchError } = await searchInventoryLocations(tenantId, query);
      if (searchError) setError(searchError);
      else setResults(locations || []);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [picking, query, tenantId]);

  const saveLink = async (locationId) => {
    setError(null);
    const { error: writeError } = await supabase
      .from('scan_hotspots')
      .update({ storage_location_id: locationId })
      .in('id', [hotspot.id]);
    if (writeError) {
      console.error('[pin-location] link save error:', writeError);
      setError(writeError.message || 'Could not save the link.');
      return;
    }
    setPicking(false);
    setQuery('');
    setResults([]);
    onLocationChanged(hotspot.id, locationId);
  };

  return (
    <div className="vm-cupboard">
      <p className="vm-label vm-cupboard-label">
        In this cupboard
        {location && canManage && (
          <button className="vm-cupboard-unlink" onClick={() => saveLink(null)} aria-label="Unlink location">
            Unlink
          </button>
        )}
      </p>

      {!hotspot?.storage_location_id && !picking && (
        canManage ? (
          <button className="vm-btn-ghost vm-cupboard-linkbtn" onClick={() => setPicking(true)}>
            Link an inventory location
          </button>
        ) : (
          <p className="vm-payload-empty">Not linked to inventory yet.</p>
        )
      )}

      {picking && (
        <div className="vm-cupboard-picker">
          <input
            className="vm-check-input"
            placeholder="Search locations — “bridge pantry”…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {results.map((r) => (
            <button key={r.id} className="vm-cupboard-result" onClick={() => saveLink(r.id)}>
              {locationLabel(r)}
            </button>
          ))}
          <button className="vm-cupboard-cancel" onClick={() => { setPicking(false); setQuery(''); }}>Cancel</button>
        </div>
      )}

      {location && (
        <>
          <p className="vm-cupboard-loc">{locationLabel(location)}</p>
          {items === null && <p className="vm-payload-empty">Loading contents…</p>}
          {items !== null && items.length === 0 && <p className="vm-payload-empty">Nothing recorded here in inventory.</p>}
          {items !== null && items.length > 0 && (
            <div className="vm-cupboard-items">
              {(showAll ? items : items.slice(0, SHOW_MAX)).map((i) => (
                <button key={i.id} className="vm-cupboard-item" onClick={() => navigate(`/inventory/item/${i.id}`)}>
                  <span className="vm-cupboard-item-name">{i.name}</span>
                  <span className="vm-cupboard-item-qty">
                    {i.quantity != null ? `${i.quantity}${i.unit ? ` ${i.unit}` : ''}` : ''}
                  </span>
                  <span className="vm-cupboard-item-go" aria-hidden="true">›</span>
                </button>
              ))}
              {items.length > SHOW_MAX && !showAll && (
                <button className="vm-cupboard-more" onClick={() => setShowAll(true)}>
                  and {items.length - SHOW_MAX} more…
                </button>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="vm-payload-error">{error}</p>}
    </div>
  );
}
