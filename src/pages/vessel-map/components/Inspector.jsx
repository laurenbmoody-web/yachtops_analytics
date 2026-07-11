// The inspector — right panel, desktop ≥1024px (CSS-gated; the mobile
// variant keeps its floating card). Slides in over 240ms ease-out on pin
// selection, slides away on deselect/Escape. Every pin carries the same
// four rooms — Details / Notes / List / Photos — regardless of layer:
// payloads live on pins, not on the rail. Notes/List/Photos ship as
// furnished-next-update rooms; Details is live.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { LAYERS, layerColor, layerLabel } from '../layers';
import PinPayload from './PinPayload';
import PinLocation from './PinLocation';
import { getInventoryLocation, locationLabel } from '../utils/inventory';
import { uploadInteriorPhoto } from '../utils/photoUpload';

// The container's "inside" — prompt to photograph the interior, then (next
// slice) open it to place child pins on it.
function InteriorSection({ hotspot, tenantId, canManage, onInteriorPhoto }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const path = hotspot.interior_photo_path;

  useEffect(() => {
    let cancelled = false;
    if (!path) { setSignedUrl(null); return undefined; }
    (async () => {
      const { data, error: e } = await supabase.storage.from('vessel-scans').createSignedUrl(path, 3600);
      if (!cancelled) setSignedUrl(e ? null : (data?.signedUrl || null));
    })();
    return () => { cancelled = true; };
  }, [path]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setUploading(true);
    setError(null);
    const { path: newPath, error: upErr } = await uploadInteriorPhoto({ tenantId, hotspotId: hotspot.id, file: f });
    setUploading(false);
    if (upErr) { setError(upErr); return; }
    onInteriorPhoto?.(hotspot.id, newPath);
  };

  return (
    <div className="vm-interior">
      <p className="vm-label">Inside</p>
      {path ? (
        <div className="vm-interior-set">
          <div className="vm-interior-thumb">{signedUrl && <img src={signedUrl} alt="Inside" />}</div>
          <div className="vm-interior-actions">
            <button className="vm-btn-primary vm-interior-open" disabled title="Placing pins inside comes next">Open · place pins</button>
            {canManage && (
              <button className="vm-btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Replace photo'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="vm-interior-empty">
            <span className="vm-interior-empty-ic" aria-hidden="true">＋</span>
            <span>
              <span className="vm-interior-empty-t">Add a photo of the inside</span>
              <span className="vm-interior-empty-s">Then place a pin on each thing — items, defects, jobs. Their contents, links &amp; QR codes live on those pins.</span>
            </span>
          </div>
          {canManage && (
            <button className="vm-btn-primary vm-interior-add" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Take / upload inside photo'}
            </button>
          )}
        </>
      )}
      {error && <p className="vm-payload-error">{error}</p>}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFile} />
    </div>
  );
}

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'notes', label: 'Notes' },
  { key: 'list', label: 'List' },
  { key: 'photos', label: 'Photos' },
];

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function Inspector({ hotspot, creatorName, canManage, onClose, onDelete, onAdjust, onRename, onRelayer, onToggleContainer, onInteriorPhoto, autoFocusName, user, tier, tenantId, names, onDetailSaved, onLocationChanged }) {
  // The panel outlives the selection by one exit animation: `shown` holds
  // the last pin while `hotspot` goes null and the slide-out plays.
  const [shown, setShown] = useState(hotspot);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('details');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const closeTimer = useRef(null);

  useEffect(() => {
    if (hotspot) {
      clearTimeout(closeTimer.current);
      setShown(hotspot);
      // Mount closed, then open on the next frame so the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    } else {
      setOpen(false);
      closeTimer.current = setTimeout(() => setShown(null), 260);
    }
    return () => clearTimeout(closeTimer.current);
  }, [hotspot]);

  // Fresh pin, fresh rooms.
  useEffect(() => {
    setTab('details');
    setConfirming(false);
    setDeleteError(null);
  }, [hotspot?.id]);

  // Name is edited locally and written through on each keystroke, so the field
  // never round-trips through parent state and the caret can't jump.
  const [nameDraft, setNameDraft] = useState(shown?.label || '');
  useEffect(() => { setNameDraft(hotspot?.label || ''); }, [hotspot?.id]);

  // The linked inventory location belongs in the header — visible from
  // every tab, not buried in Details. pickSignal nudges PinLocation's
  // picker open when the header affordance is used on an unlinked pin.
  const [headLoc, setHeadLoc] = useState(null);
  const [pickSignal, setPickSignal] = useState(0);
  const locId = shown?.storage_location_id || null;
  useEffect(() => {
    if (!locId) { setHeadLoc(null); return undefined; }
    let cancelled = false;
    (async () => {
      const { location } = await getInventoryLocation(locId);
      if (!cancelled) setHeadLoc(location || null);
    })();
    return () => { cancelled = true; };
  }, [locId]);

  if (!shown) return null;

  const doDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const failure = await onDelete(shown.id);
    setDeleting(false);
    if (failure) {
      setDeleteError(failure);
      setConfirming(false);
    }
  };

  // Adjust + remove — shared by the details tab and the container view.
  const dangerActions = canManage && (
    <>
      <button className="vm-btn-ghost vm-insp-adjust" onClick={() => onAdjust?.(shown)}>
        Adjust position
      </button>
      <div className="vm-insp-danger">
        {deleteError && <p className="vm-insp-error">{deleteError}</p>}
        {confirming ? (
          <div className="vm-insp-confirm">
            <button className="vm-insp-delete vm-insp-delete-armed" onClick={doDelete} disabled={deleting}>
              {deleting ? 'Removing…' : 'Confirm remove'}
            </button>
            <button className="vm-btn-ghost vm-insp-ghost" onClick={() => setConfirming(false)} disabled={deleting}>
              Keep
            </button>
          </div>
        ) : (
          <button className="vm-insp-delete" onClick={() => setConfirming(true)}>
            Remove pin
          </button>
        )}
      </div>
    </>
  );

  return (
    <aside className={`vm-inspector${open ? ' vm-open' : ''}`} aria-label="Pin inspector">
      <div className="vm-insp-head">
        <button className="vm-side-close" onClick={onClose} aria-label="Close inspector">×</button>
        {canManage ? (
          <>
            <input
              className="vm-input vm-name-input"
              value={nameDraft}
              placeholder="Name this pin"
              autoFocus={autoFocusName}
              onChange={(e) => { setNameDraft(e.target.value); onRename?.(shown.id, e.target.value); }}
            />
            <div className="vm-swatch-row" role="radiogroup" aria-label="Category">
              {LAYERS.map((l) => {
                const on = (shown.layer || 'general') === l.key;
                return (
                  <button
                    key={l.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={l.label}
                    className={`vm-swatch${on ? ' on' : ''}`}
                    style={{ background: l.color, color: l.color }}
                    onClick={() => onRelayer?.(shown.id, l.key)}
                  />
                );
              })}
              <span className="vm-swatch-name">{layerLabel(shown.layer)}</span>
            </div>
            <label className={`vm-ct${shown.is_container ? ' on' : ''}`}>
              <input type="checkbox" checked={!!shown.is_container} onChange={(e) => onToggleContainer?.(shown.id, e.target.checked)} />
              <span className="vm-ct-switch" aria-hidden="true" />
              <span className="vm-ct-text">
                <span className="vm-ct-title">Other pins live inside this one</span>
                <span className="vm-ct-sub">{shown.is_container ? 'Opens a photo of the inside where you place pins' : 'Off — just this one pin, nothing inside it'}</span>
              </span>
            </label>
          </>
        ) : (
          <>
            <p className="vm-label">Hotspot</p>
            <h2 className="vm-insp-title">{shown.label || 'Untitled pin'}</h2>
            <span className="vm-pill vm-pill-static">
              <span className="vm-pill-dot" style={{ background: shown.color || layerColor(shown.layer) }} />
              {layerLabel(shown.layer)}
            </span>
          </>
        )}
        {!shown.is_container && locId && headLoc && (
          <button className="vm-insp-loc" onClick={() => setTab('details')} title="Inventory location — see contents in Details">
            {locationLabel(headLoc)}
          </button>
        )}
        {!shown.is_container && !locId && canManage && (
          <button
            className="vm-insp-loc vm-insp-loc-empty"
            onClick={() => { setTab('details'); setPickSignal((n) => n + 1); }}
          >
            + Link inventory location
          </button>
        )}
      </div>

      {!shown.is_container && (
        <div className="vm-insp-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`vm-insp-tab${tab === t.key ? ' vm-insp-tab-on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="vm-insp-body">
        {shown.is_container && (
          <InteriorSection hotspot={shown} tenantId={tenantId} canManage={canManage} onInteriorPhoto={onInteriorPhoto} />
        )}
        {shown.is_container && dangerActions}
        {!shown.is_container && tab === 'details' && (
          <>
            <div className="vm-insp-row">
              <span className="vm-label">Added</span>
              {fmtDate(shown.created_at)}
            </div>
            {creatorName && (
              <div className="vm-insp-row">
                <span className="vm-label">Added by</span>
                {creatorName}
              </div>
            )}
            <PinLocation
              hotspot={shown}
              canManage={canManage}
              tenantId={tenantId}
              onLocationChanged={onLocationChanged}
              pickSignal={pickSignal}
            />
            {dangerActions}
          </>
        )}

        {!shown.is_container && tab !== 'details' && (
          <PinPayload
            hotspot={shown}
            tab={tab}
            user={user}
            tier={tier}
            canManage={canManage}
            tenantId={tenantId}
            names={names}
            onDetailSaved={onDetailSaved}
          />
        )}
      </div>
    </aside>
  );
}
