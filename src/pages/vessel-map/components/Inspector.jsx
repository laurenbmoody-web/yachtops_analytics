// The inspector — right panel, desktop ≥1024px (CSS-gated; the mobile
// variant keeps its floating card). Slides in over 240ms ease-out on pin
// selection, slides away on deselect/Escape. Every pin carries the same
// four rooms — Details / Notes / List / Photos — regardless of layer:
// payloads live on pins, not on the rail. Notes/List/Photos ship as
// furnished-next-update rooms; Details is live.
import React, { useEffect, useRef, useState } from 'react';
import { layerColor, layerLabel } from '../layers';
import PinPayload from './PinPayload';
import PinLocation from './PinLocation';

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

export default function Inspector({ hotspot, creatorName, canManage, onClose, onDelete, onAdjust, user, tier, tenantId, names, onDetailSaved, onLocationChanged }) {
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

  return (
    <aside className={`vm-inspector${open ? ' vm-open' : ''}`} aria-label="Pin inspector">
      <div className="vm-insp-head">
        <button className="vm-side-close" onClick={onClose} aria-label="Close inspector">×</button>
        <p className="vm-label">Hotspot</p>
        <h2 className="vm-insp-title">{shown.label}</h2>
        <span className="vm-pill vm-pill-static">
          <span className="vm-pill-dot" style={{ background: shown.color || layerColor(shown.layer) }} />
          {layerLabel(shown.layer)}
        </span>
      </div>

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

      <div className="vm-insp-body">
        {tab === 'details' && (
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
            />

            {canManage && (
              <button className="vm-btn-ghost vm-insp-adjust" onClick={() => onAdjust?.(shown)}>
                Adjust position
              </button>
            )}

            {canManage && (
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
            )}
          </>
        )}

        {tab !== 'details' && (
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
