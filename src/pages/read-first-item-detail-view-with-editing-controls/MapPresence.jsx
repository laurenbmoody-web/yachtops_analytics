// "On the vessel map" — the reverse of a photo tag. Every pin whose photos
// carry a tag for this item lists here, deep-linking back into the 3D room
// with that pin's inspector open. Renders nothing when the item is untagged.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../../contexts/TenantContext';
import { findItemOnMap } from '../vessel-map/utils/inventory';
import './map-presence.css';

export default function MapPresence({ itemId }) {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const [places, setPlaces] = useState(null);

  useEffect(() => {
    if (!activeTenantId || !itemId) return undefined;
    let cancelled = false;
    (async () => {
      const { places: found } = await findItemOnMap(activeTenantId, itemId);
      if (!cancelled) setPlaces(found || []);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId, itemId]);

  if (!places || places.length === 0) return null;

  return (
    <div className="mpz">
      <p className="mpz-label">On the vessel map</p>
      {places.map((p) => (
        <div key={p.hotspotId} className="mpz-row">
          <span className="mpz-pin">{p.label}</span>
          <span className="mpz-scan">{p.scanName}</span>
          {p.spots > 1 && <span className="mpz-count">{p.spots} tagged spots</span>}
          {p.placed && p.spots === 0 && <span className="mpz-count">stock here</span>}
          <button
            className="mpz-go"
            onClick={() => navigate(`/vessel/map?scan=${p.scanId}&pin=${p.hotspotId}`)}
          >
            View on map →
          </button>
        </div>
      ))}
    </div>
  );
}
