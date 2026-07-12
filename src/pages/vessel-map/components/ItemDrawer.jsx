// Quick-view inventory drawer, opened from a pin item. It reuses the real
// inventory data layer (getItemById), the real edit flow (AddEditItemModal)
// and the shared activity feed (getActivityForEntity) — but presents them in
// the editorial system so no old boxed UI leaks onto the map surface. This is
// where the item's richer metadata lives and is edited; the map pin drawer
// stays light. Two tabs: Details and History (the movement log).
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getItemById } from '../../inventory/utils/inventoryStorage';
import { getActivityForEntity } from '../../../utils/activityStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import { canViewCost, formatCurrency } from '../../../utils/costPermissions';
import AddEditItemModal from '../../inventory/components/AddEditItemModal';
import './item-drawer.css';

const fmtDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtDateTime = (v) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${fmtDate(v)} · ${t}`;
};

const dotClass = (action = '') => {
  if (action.includes('RECEIVED')) return 'received';
  if (action.includes('TRANSFERRED')) return 'transferred';
  if (action.includes('ADJUSTED')) return 'adjusted';
  if (action.includes('CREATED')) return 'created';
  return '';
};

// A quiet metadata cell — renders nothing when empty, so the grid stays
// editorial (no empty boxes).
const Meta = ({ k, v, full }) => {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className={full ? 'vmid-meta-full' : undefined}>
      <p className="vmid-meta-k">{k}</p>
      <p className="vmid-meta-v">{v}</p>
    </div>
  );
};

export default function ItemDrawer({ itemId, onClose }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState(null);
  const [tab, setTab] = useState('details');
  const [events, setEvents] = useState(null);
  const [editing, setEditing] = useState(false);

  const user = getCurrentUser();
  const canEdit = hasCommandAccess(user) || hasChiefAccess(user) || hasHODAccess(user);
  const seeCost = canViewCost();

  // Mount closed, open next frame so the slide-in plays.
  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const loadItem = async () => setItem(await getItemById(itemId));
  useEffect(() => { setItem(null); loadItem(); /* eslint-disable-next-line */ }, [itemId]);

  useEffect(() => {
    if (tab !== 'history') return;
    let cancelled = false;
    setEvents(null);
    (async () => {
      const evs = await getActivityForEntity('inventoryItem', itemId, user);
      if (!cancelled) setEvents(evs || []);
    })();
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [tab, itemId]);

  const close = () => { setOpen(false); setTimeout(onClose, 240); };

  const cf = item?.customFields || {};
  const catPath = item
    ? [item.location, ...(item.subLocation ? item.subLocation.split(' > ') : [])].filter(Boolean)
    : [];
  const cost = item?.unitCost && item?.currency ? formatCurrency(item.unitCost, item.currency) : null;
  const restock = item?.restockEnabled && item?.restockLevel != null ? `${item.restockLevel} ${item.unit || ''}`.trim() : null;

  const drawer = (
    <>
      <div className={`vmid-backdrop${open ? ' vmid-open' : ''}`} onClick={close} />
      <aside className={`vmid-panel${open ? ' vmid-open' : ''}`} aria-label="Inventory item">
        <div className="vmid-head">
          <button className="vmid-close" onClick={close} aria-label="Close">×</button>
          <p className="vmid-eyebrow">Inventory item</p>
          <h2 className="vmid-title">{item?.name || 'Loading…'}</h2>
          {catPath.length > 0 && (
            <p className="vmid-cat">
              {catPath.map((seg, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="vmid-cat-sep"> › </span>}
                  {seg}
                </React.Fragment>
              ))}
            </p>
          )}
        </div>

        <div className="vmid-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'details'} className={`vmid-tab${tab === 'details' ? ' vmid-tab-on' : ''}`} onClick={() => setTab('details')}>Details</button>
          <button role="tab" aria-selected={tab === 'history'} className={`vmid-tab${tab === 'history' ? ' vmid-tab-on' : ''}`} onClick={() => setTab('history')}>History</button>
        </div>

        <div className="vmid-body">
          {!item && <p className="vmid-loading">Loading…</p>}

          {item && tab === 'details' && (
            <>
              <div className="vmid-total">
                <span className="vmid-total-n">{item.totalQty ?? 0}</span>
                <span className="vmid-total-u">{item.unit || 'units'} onboard</span>
              </div>

              <div className="vmid-section">
                <p className="vmid-label">Where it is</p>
                {item.stockLocations && item.stockLocations.length > 0 ? (
                  item.stockLocations.map((loc, i) => (
                    <div key={i} className="vmid-stock-row">
                      <span className="vmid-stock-name">{loc.locationName || loc.subLocation || 'Location'}</span>
                      <span className="vmid-stock-qty">{loc.qty ?? loc.quantity ?? 0}</span>
                    </div>
                  ))
                ) : (
                  <p className="vmid-empty">Not placed anywhere yet.</p>
                )}
              </div>

              <div className="vmid-meta">
                <Meta k="Unit" v={item.unit} />
                <Meta k="Size" v={item.size} />
                <Meta k="Department" v={item.usageDepartment} />
                <Meta k="Supplier" v={item.supplier} />
                <Meta k="Brand" v={item.brand} />
                <Meta k="Year" v={item.year} />
                <Meta k="Expiry" v={fmtDate(item.expiryDate)} />
                <Meta k="Batch" v={cf.batch_no || cf.batch || cf.batchNo} />
                <Meta k="Colour" v={cf.colour || cf.color || item.color} />
                <Meta k="Barcode" v={item.barcode} />
                <Meta k="Condition" v={item.condition} />
                <Meta k="Par level" v={item.parLevel} />
                <Meta k="Reorder point" v={item.reorderPoint} />
                <Meta k="Restock at" v={restock} />
                {seeCost && <Meta k="Unit cost" v={cost} />}
              </div>

              {(item.notes || item.tastingNotes || item.description) && (
                <div className="vmid-section">
                  <p className="vmid-label">Notes</p>
                  <p className="vmid-notes">{item.notes || item.description || item.tastingNotes}</p>
                </div>
              )}

              <div className="vmid-foot">
                {fmtDate(item.createdAt) && <span>Added {fmtDate(item.createdAt)}</span>}
                {fmtDate(item.updatedAt) && <span>Updated {fmtDate(item.updatedAt)}</span>}
              </div>

              <div className="vmid-actions">
                {canEdit && <button className="vmid-btn vmid-btn-primary" onClick={() => setEditing(true)}>Edit details</button>}
                <button className="vmid-btn vmid-btn-ghost" onClick={() => navigate(`/inventory/item/${itemId}`)}>Open full page →</button>
              </div>
            </>
          )}

          {item && tab === 'history' && (
            <>
              {events === null && <p className="vmid-loading">Loading…</p>}
              {events && events.length === 0 && <p className="vmid-hist-empty">No history recorded for this item yet.</p>}
              {events && events.map((ev) => (
                <div key={ev.id} className="vmid-ev">
                  <span className={`vmid-ev-dot ${dotClass(ev.action)}`} />
                  <div className="vmid-ev-body">
                    <p className="vmid-ev-sum">{ev.summary}</p>
                    <p className="vmid-ev-meta">
                      {ev.actorName && <span className="vmid-ev-actor">{ev.actorName}</span>}
                      {ev.actorName && <span className="vmid-ev-dot-sep">·</span>}
                      {fmtDateTime(ev.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>

      {editing && item && (
        <AddEditItemModal
          item={item}
          defaultLocation={item.stockLocations?.[0]?.locationName || item.location || ''}
          defaultSubLocation={item.stockLocations?.[0]?.subLocation || item.subLocation || ''}
          onClose={() => { setEditing(false); loadItem(); if (tab === 'history') setTab('history'); }}
        />
      )}
    </>
  );

  return createPortal(drawer, document.body);
}
