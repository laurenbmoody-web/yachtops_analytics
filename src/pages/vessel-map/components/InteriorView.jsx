// The inside of a container — a photo of the interior with its own pins on
// top. Opened from a container pin's inspector ("Open · place pins"). Child
// pins carry a 2-D position ({x,y} in 0..1 of the photo) instead of the 3-D
// scan position; everything else (name, category, links, nesting) is the same
// pin machinery as the 3-D scan. Breadcrumb walks back out; nested containers
// push another level on.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { layerColor } from '../layers';

export default function InteriorView({
  scanName, trail, childPins, canManage, placing, selectedId,
  onPlace, onSelectPin, onCrumb,
}) {
  const container = trail[trail.length - 1];
  const path = container?.interior_photo_path || null;
  const [signedUrl, setSignedUrl] = useState(null);
  const [hovered, setHovered] = useState(null);
  const photoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) { setSignedUrl(null); return undefined; }
    (async () => {
      const { data, error } = await supabase.storage.from('vessel-scans').createSignedUrl(path, 3600);
      if (!cancelled) setSignedUrl(error ? null : (data?.signedUrl || null));
    })();
    return () => { cancelled = true; };
  }, [path]);

  const place = (e) => {
    if (!placing || !canManage) return;
    const rect = photoRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onPlace({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  };

  return (
    <div className="vm-iv" role="group" aria-label={`Inside ${container?.label || 'container'}`}>
      <nav className="vm-iv-crumbs" aria-label="Breadcrumb">
        <button className="vm-iv-crumb" onClick={() => onCrumb(-1)}>{scanName}</button>
        {trail.map((c, i) => (
          <React.Fragment key={c.id}>
            <span className="vm-iv-sep" aria-hidden="true">›</span>
            {i === trail.length - 1 ? (
              <span className="vm-iv-crumb vm-iv-crumb-here">{c.label || 'Untitled'}</span>
            ) : (
              <button className="vm-iv-crumb" onClick={() => onCrumb(i)}>{c.label || 'Untitled'}</button>
            )}
          </React.Fragment>
        ))}
      </nav>

      <div className="vm-iv-frame">
        {signedUrl ? (
          <div
            ref={photoRef}
            className={`vm-iv-photo${placing ? ' vm-iv-placing' : ''}`}
            onClick={place}
          >
            <img src={signedUrl} alt={`Inside ${container?.label || ''}`} draggable="false" />
            {childPins.map((p) => {
              const pos = p.position || {};
              const color = p.color || layerColor(p.layer);
              const on = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  className={`vm-iv-pin${p.is_container ? ' vm-iv-pin-box' : ''}${on ? ' on' : ''}`}
                  style={{ left: `${(pos.x ?? 0.5) * 100}%`, top: `${(pos.y ?? 0.5) * 100}%`, '--pin': color }}
                  onClick={(e) => { e.stopPropagation(); onSelectPin(p); }}
                  onMouseEnter={() => setHovered(p.id)}
                  onMouseLeave={() => setHovered((h) => (h === p.id ? null : h))}
                  aria-label={p.label || 'Untitled pin'}
                >
                  {(hovered === p.id || on) && (p.label || p.is_container) && (
                    <span className="vm-iv-pin-tag">{p.label || 'Untitled'}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="vm-iv-missing">This container has no inside photo yet.</div>
        )}
      </div>

      {placing && canManage && (
        <div className="vm-iv-hint">Click on the photo to place a pin<span className="vm-iv-hint-kbd">Esc cancels</span></div>
      )}
    </div>
  );
}
