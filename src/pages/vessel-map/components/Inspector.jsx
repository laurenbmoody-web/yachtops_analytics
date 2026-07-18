// The inspector — right panel, desktop ≥1024px (CSS-gated; the mobile
// variant keeps its floating card). Slides in over 240ms ease-out on pin
// selection, slides away on deselect/Escape. Every pin carries the same
// four rooms — Details / Notes / List / Photos — regardless of layer:
// payloads live on pins, not on the rail. All four are live: Details here,
// Notes / List / Photos in PinPayload (notes, checklist, photo gallery).
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { LAYERS, layerColor, layerLabel, layerHoldsStock, layerCanContain } from '../layers';
import PinPayload from './PinPayload';
import PinItems from './PinItems';
import DefectPinSummary from './DefectPinSummary';
import DefectModal from './DefectModal';
import { useDefectActor } from '../../defects/utils/useDefectActor';
import { getDefectByHotspot } from '../../defects/utils/defectsStorage';
import { uploadInteriorPhoto } from '../utils/photoUpload';

// The container's "inside" — prompt to photograph the interior, then (next
// slice) open it to place child pins on it.
function InteriorSection({ hotspot, tenantId, canManage, onInteriorPhoto, onOpenInterior, childCount }) {
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
          <button type="button" className="vm-interior-thumb" onClick={() => onOpenInterior?.(hotspot)} title="Open the inside">
            {signedUrl && <img src={signedUrl} alt="Inside" />}
            {childCount > 0 && <span className="vm-interior-count">{childCount} {childCount === 1 ? 'pin' : 'pins'}</span>}
          </button>
          <div className="vm-interior-actions">
            <button className="vm-btn-primary vm-interior-open" onClick={() => onOpenInterior?.(hotspot)}>
              {childCount > 0 ? 'Open · place pins' : 'Open · place first pin'}
            </button>
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
              <span className="vm-interior-empty-s">Then drop a pin on each drawer, shelf or item inside. Whatever it holds — contents, links &amp; QR codes — lives on those pins.</span>
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

export default function Inspector({ hotspot, creatorName, canManage, onClose, onDelete, onAdjust, onRename, onRelayer, onToggleContainer, onInteriorPhoto, onOpenInterior, childCount, autoFocusName, raised, user, tier, tenantId, names, onDetailSaved, scanSpaceId, scanName, containerTrail, onNodeResolved, placingItem, onPlaced, allowedLayers = null }) {
  // The panel outlives the selection by one exit animation: `shown` holds
  // the last pin while `hotspot` goes null and the slide-out plays.
  const [shown, setShown] = useState(hotspot);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('details');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [defectModalOpen, setDefectModalOpen] = useState(false);
  const [defectReload, setDefectReload] = useState(0);
  const [pinHasDefect, setPinHasDefect] = useState(false);
  const defectActor = useDefectActor();
  const closeTimer = useRef(null);

  // Does this defect pin already carry a logged defect? If so, lock down the
  // pin-editing controls (layer / container) so the defect link can't be lost.
  useEffect(() => {
    let live = true;
    setPinHasDefect(false);
    if (hotspot?.layer === 'defect' && hotspot?.id && defectActor?.tenantId) {
      (async () => {
        const d = await getDefectByHotspot(hotspot.id, defectActor);
        if (live) setPinHasDefect(!!d);
      })();
    }
    return () => { live = false; };
  }, [hotspot?.id, hotspot?.layer, defectActor?.tenantId, defectReload]);

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
    // Selecting a defect pin opens its full panel straight away.
    setDefectModalOpen(hotspot?.layer === 'defect');
  }, [hotspot?.id, hotspot?.layer]);

  // Name is edited locally and written through on each keystroke, so the field
  // never round-trips through parent state and the caret can't jump.
  const [nameDraft, setNameDraft] = useState(shown?.label || '');
  useEffect(() => { setNameDraft(hotspot?.label || ''); }, [hotspot?.id]);

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
  // "Adjust position" moves a pin in 3-D; a nested pin lives on a 2-D photo,
  // so it's hidden there (repositioning inside comes later).
  const dangerActions = canManage && (
    <div className="vm-insp-danger">
      {deleteError && <p className="vm-insp-error">{deleteError}</p>}
      {confirming && pinHasDefect && <p className="vm-insp-note">The defect stays in Defects — only the map pin is removed.</p>}
      <div className="vm-insp-actions-row">
        {!shown.parent_id && (
          <button className="vm-btn-ghost vm-insp-adjust" onClick={() => onAdjust?.(shown)}>
            Adjust position
          </button>
        )}
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
    </div>
  );

  return (
    <aside className={`vm-inspector${open ? ' vm-open' : ''}${raised ? ' vm-inspector-front' : ''}`} aria-label="Pin inspector">
      <div className="vm-insp-head">
        <button className="vm-side-close" onClick={onClose} aria-label="Close inspector">×</button>
        {canManage ? (
          <>
            {shown.layer === 'defect' ? (
              // Defect pins aren't titled here — the name is the defect's title
              // (set in the defect panel), or just "Defect" until one is logged.
              <h2 className="vm-insp-title">{shown.label || 'Defect'}</h2>
            ) : (
              <input
                className="vm-input vm-name-input"
                value={nameDraft}
                placeholder="Name this pin"
                autoFocus={autoFocusName}
                onChange={(e) => { setNameDraft(e.target.value); onRename?.(shown.id, e.target.value); }}
              />
            )}
            {shown.layer === 'defect' && pinHasDefect ? (
              // A defect is logged on this pin — lock the type/container controls
              // so the defect link can't be changed away by accident.
              <span className="vm-pill vm-pill-static" style={{ marginTop: 4 }}>
                <span className="vm-pill-dot" style={{ background: layerColor('defect') }} />
                Defect pin · locked
              </span>
            ) : (
              <>
                <div className="vm-swatch-row" role="radiogroup" aria-label="Category">
                  {LAYERS.filter((l) => !allowedLayers || allowedLayers.includes(l.key)).map((l) => {
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
                {/* Only enclosures (Storage cupboard / Inventory cabinet) open up
                    into nested pins. Kept visible for an existing container even
                    if its layer changed, so it can still be managed. */}
                {(layerCanContain(shown.layer) || shown.is_container) && (
                  <label className={`vm-ct${shown.is_container ? ' on' : ''}`}>
                    <input type="checkbox" checked={!!shown.is_container} onChange={(e) => onToggleContainer?.(shown.id, e.target.checked)} />
                    <span className="vm-ct-switch" aria-hidden="true" />
                    <span className="vm-ct-text">
                      <span className="vm-ct-title">Has separate compartments inside</span>
                      <span className="vm-ct-sub">{shown.is_container ? 'Add a photo of the inside, then drop a pin on each drawer or shelf' : 'Off — one pin covers the whole thing'}</span>
                    </span>
                  </label>
                )}
              </>
            )}
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
      </div>

      {/* Defect pins carry everything in the defect panel — no Notes/List/Photos tabs. */}
      {!shown.is_container && shown.layer !== 'defect' && (
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
          <InteriorSection hotspot={shown} tenantId={tenantId} canManage={canManage} onInteriorPhoto={onInteriorPhoto} onOpenInterior={onOpenInterior} childCount={childCount} />
        )}
        {shown.is_container && dangerActions}
        {!shown.is_container && tab === 'details' && (
          <>
            {/* "What's inside" only for stock-bearing layers (Inventory, Safety). */}
            {layerHoldsStock(shown.layer) && (
              <PinItems
                hotspot={shown}
                canManage={canManage}
                tenantId={tenantId}
                userId={user?.id}
                scanSpaceId={scanSpaceId}
                scanName={scanName}
                containerTrail={containerTrail}
                onNodeResolved={onNodeResolved}
                placingItem={placingItem}
                onPlaced={onPlaced}
              />
            )}
            {placingItem && !layerHoldsStock(shown.layer) && (
              <p className="vm-pinitems-note">This pin type doesn’t hold stock — pick an <strong>Inventory</strong>, <strong>Storage</strong> or <strong>Safety</strong> pin.</p>
            )}
            {/* Defect pins: a compact summary here; the full defect opens wide. */}
            {shown.layer === 'defect' && !placingItem && (
              <DefectPinSummary
                hotspot={shown}
                reloadToken={defectReload}
                onOpen={() => setDefectModalOpen(true)}
              />
            )}
            {/* Pin metadata — quiet, out of the way at the foot of the tab. The
                divider only makes sense when there's real content above it. */}
            <div className={`vm-insp-meta${(layerHoldsStock(shown.layer) || shown.layer === 'defect') ? '' : ' vm-insp-meta-flush'}`}>
              <span className="vm-insp-meta-item">Added {fmtDate(shown.created_at)}</span>
              {creatorName && <span className="vm-insp-meta-item">by {creatorName}</span>}
            </div>
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

      {defectModalOpen && shown.layer === 'defect' && (
        <DefectModal
          hotspot={shown}
          canManage={canManage}
          scanName={scanName}
          containerTrail={containerTrail}
          onChanged={() => { setDefectReload((v) => v + 1); onDetailSaved?.(); }}
          onTitled={(title) => { if (title) onRename?.(shown.id, title); }}
          onClose={() => setDefectModalOpen(false)}
        />
      )}
    </aside>
  );
}
