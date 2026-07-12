// Quick-view + edit inventory drawer, opened from a pin item. It reuses the
// real inventory data layer (getItemById / saveItem) and activity feed
// (getActivityForEntity), but presents them in the editorial system so no old
// boxed UI leaks onto the map surface. Editing happens INLINE here — no
// separate modal pops over the drawer. This is the home for the item's richer
// metadata; the map pin drawer stays light. Tabs: Details and History.
//
// What's intentionally NOT edited here: per-location quantities. Those are the
// map's job — you step them up/down on the pins — so the drawer shows "Where
// it is" read-only to avoid two places fighting over total_qty.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getItemById, saveItem } from '../../inventory/utils/inventoryStorage';
import { searchInventoryLocations, locationLabel } from '../utils/inventory';
import { setPinCount, clearItemNode } from '../utils/placement';
import { entryKey } from '../utils/stockMath';
import { getActivityForEntity } from '../../../utils/activityStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import { canViewCost, formatCurrency } from '../../../utils/costPermissions';
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
const numOrNull = (v) => { const n = Number(v); return v === '' || v == null || Number.isNaN(n) ? null : n; };

// A quiet read-only metadata cell — renders nothing when empty.
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

  // Inline edit
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [catPicking, setCatPicking] = useState(false);
  const [catQuery, setCatQuery] = useState('');
  const [catResults, setCatResults] = useState([]);
  const [locBusy, setLocBusy] = useState(null);
  const catDebounce = useRef(null);

  const user = getCurrentUser();
  const canEdit = hasCommandAccess(user) || hasChiefAccess(user) || hasHODAccess(user);
  const seeCost = canViewCost();

  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const loadItem = async () => setItem(await getItemById(itemId));
  useEffect(() => { setItem(null); setEditing(false); loadItem(); /* eslint-disable-next-line */ }, [itemId]);

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

  useEffect(() => {
    if (!catPicking) return undefined;
    clearTimeout(catDebounce.current);
    catDebounce.current = setTimeout(async () => {
      const { locations } = await searchInventoryLocations(item?.tenantId, catQuery);
      setCatResults(locations || []);
    }, 250);
    return () => clearTimeout(catDebounce.current);
    /* eslint-disable-next-line */
  }, [catPicking, catQuery]);

  const close = () => { setOpen(false); setTimeout(onClose, 240); };

  const startEdit = () => { setDraft({ ...item, customFields: { ...(item.customFields || {}) } }); setSaveErr(null); setEditing(true); setTab('details'); };
  const cancelEdit = () => { setEditing(false); setDraft(null); setCatPicking(false); };
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setCf = (k, v) => setDraft((d) => ({ ...d, customFields: { ...(d.customFields || {}), [k]: v } }));

  const save = async () => {
    setSaving(true); setSaveErr(null);
    const payload = {
      ...draft,
      year: numOrNull(draft.year),
      unitCost: numOrNull(draft.unitCost),
      restockLevel: numOrNull(draft.restockLevel),
      restockEnabled: numOrNull(draft.restockLevel) != null,
      parLevel: numOrNull(draft.parLevel),
      reorderPoint: numOrNull(draft.reorderPoint),
    };
    const ok = await saveItem(payload);
    setSaving(false);
    if (!ok) { setSaveErr('Could not save — check the fields and try again.'); return; }
    setEditing(false); setDraft(null); setCatPicking(false);
    await loadItem();
  };

  // Per-location count editing — the item's "god view". Any location's count
  // can be recounted here regardless of which pin you came from, which the map
  // can't do (its steppers only touch the pin you're standing on). Each entry
  // is keyed the same way stockMath keys stock_locations, so the recount lands
  // on the right row and flows its delta to the total.
  const locKey = (e) => entryKey({ vesselLocationId: e.vesselLocationId, locationId: e.locationId, locationName: e.locationName, subLocation: e.subLocation });
  const locName = (e) => e.locationName || e.subLocation || 'Location';
  const stepLoc = async (e, delta) => {
    const key = locKey(e);
    const cur = Number(e.qty ?? e.quantity) || 0;
    const newQty = Math.max(0, cur + delta);
    if (newQty === cur) return;
    setLocBusy(key);
    const { error } = await setPinCount(itemId, { pin: { nodeId: key, name: locName(e) }, newQty });
    setLocBusy(null);
    if (!error) await loadItem();
  };
  const removeLoc = async (e) => {
    const key = locKey(e);
    setLocBusy(key);
    await clearItemNode(itemId, { nodeId: key, name: locName(e) });
    setLocBusy(null);
    await loadItem();
  };

  const src = editing ? draft : item;
  const cf = src?.customFields || {};
  const catPath = src
    ? [src.location, ...(src.subLocation ? src.subLocation.split(' > ') : [])].filter(Boolean)
    : [];
  const cost = item?.unitCost && item?.currency ? formatCurrency(item.unitCost, item.currency) : null;
  const restock = item?.restockEnabled && item?.restockLevel != null ? `${item.restockLevel} ${item.unit || ''}`.trim() : null;

  // Editable field — a plain function (NOT a component), so React reconciles
  // the returned <input> by position and the caret is never dropped mid-type.
  const fieldEl = (k, label, { type = 'text', placeholder } = {}) => (
    <label className="vmid-field">
      <span className="vmid-meta-k">{label}</span>
      <input className="vmid-input" type={type} value={draft[k] ?? ''} placeholder={placeholder}
        onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  const editForm = draft && (
    <>
      <label className="vmid-field vmid-meta-full">
        <span className="vmid-meta-k">Name</span>
        <input className="vmid-input" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} />
      </label>

      {/* Category folder */}
      <div className="vmid-field vmid-meta-full">
        <span className="vmid-meta-k">Inventory folder</span>
        {catPicking ? (
          <div className="vmid-cat-picker">
            <input className="vmid-input" autoFocus placeholder="Search folders — “wine”…" value={catQuery} onChange={(e) => setCatQuery(e.target.value)} />
            {catResults.map((r) => (
              <button key={r.id} type="button" className="vmid-cat-result"
                onClick={() => { set('location', r.location); set('subLocation', r.sub_location); setCatPicking(false); setCatQuery(''); setCatResults([]); }}>
                {locationLabel(r)}
              </button>
            ))}
          </div>
        ) : (
          <div className="vmid-cat-set">
            <span className="vmid-cat-cur">{catPath.length ? catPath.join(' › ') : 'Uncategorised'}</span>
            <button type="button" className="vmid-cat-change" onClick={() => { setCatPicking(true); setCatQuery(''); setCatResults([]); }}>Change</button>
          </div>
        )}
      </div>

      <label className="vmid-toggle vmid-meta-full">
        <input type="checkbox" checked={!!draft.isAlcohol} onChange={(e) => set('isAlcohol', e.target.checked)} />
        <span className="vmid-toggle-sw" aria-hidden="true" />
        <span className="vmid-toggle-t">Alcoholic beverage</span>
      </label>

      <div className="vmid-field vmid-meta-full">
        <span className="vmid-meta-k">Description</span>
        <textarea className="vmid-textarea" rows={2} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div className="vmid-meta">
        {fieldEl('brand', 'Brand')}
        {fieldEl('supplier', 'Supplier')}
        {fieldEl('unit', 'Unit', { placeholder: 'each' })}
        {fieldEl('size', 'Size')}
        {fieldEl('year', 'Year', { type: 'number' })}
        {fieldEl('condition', 'Condition')}
        <label className="vmid-field">
          <span className="vmid-meta-k">Expiry</span>
          <input className="vmid-input" type="date" value={draft.expiryDate ?? ''} onChange={(e) => set('expiryDate', e.target.value)} />
        </label>
        {fieldEl('barcode', 'Barcode')}
        <label className="vmid-field">
          <span className="vmid-meta-k">Batch</span>
          <input className="vmid-input" value={cf.batch_no ?? cf.batch ?? ''} onChange={(e) => setCf('batch_no', e.target.value)} />
        </label>
        <label className="vmid-field">
          <span className="vmid-meta-k">Colour</span>
          <input className="vmid-input" value={cf.colour ?? cf.color ?? ''} onChange={(e) => setCf('colour', e.target.value)} />
        </label>
        {fieldEl('parLevel', 'Par level', { type: 'number' })}
        {fieldEl('reorderPoint', 'Reorder point', { type: 'number' })}
        {fieldEl('restockLevel', 'Restock at', { type: 'number' })}
        {seeCost && (
          <label className="vmid-field">
            <span className="vmid-meta-k">Unit cost</span>
            <div className="vmid-cost">
              <select className="vmid-input vmid-cur" value={draft.currency || 'USD'} onChange={(e) => set('currency', e.target.value)}>
                {['USD', 'EUR', 'GBP', 'AUD'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="vmid-input" type="number" value={draft.unitCost ?? ''} onChange={(e) => set('unitCost', e.target.value)} />
            </div>
          </label>
        )}
      </div>

      {draft.isAlcohol && (
        <div className="vmid-field vmid-meta-full">
          <span className="vmid-meta-k">Tasting notes</span>
          <textarea className="vmid-textarea" rows={2} value={draft.tastingNotes ?? ''} onChange={(e) => set('tastingNotes', e.target.value)} />
        </div>
      )}

      <label className="vmid-field vmid-meta-full">
        <span className="vmid-meta-k">Tags <span className="vmid-hint">comma-separated</span></span>
        <input className="vmid-input" value={(draft.tags || []).join(', ')}
          onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} />
      </label>

      <div className="vmid-field vmid-meta-full">
        <span className="vmid-meta-k">Notes</span>
        <textarea className="vmid-textarea" rows={3} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>

      <p className="vmid-editnote">Quantities per location are adjusted on the map pins — not here.</p>
      {saveErr && <p className="vmid-saveerr">{saveErr}</p>}
      <div className="vmid-actions">
        <button className="vmid-btn vmid-btn-primary" onClick={save} disabled={saving || !draft.name?.trim()}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button className="vmid-btn vmid-btn-ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
      </div>
    </>
  );

  const readView = item && (
    <>
      <div className="vmid-total">
        <span className="vmid-total-n">{item.totalQty ?? 0}</span>
        <span className="vmid-total-u">{item.unit || 'units'} onboard</span>
      </div>

      <div className="vmid-section">
        <p className="vmid-label">Where it is</p>
        {item.stockLocations && item.stockLocations.length > 0 ? (
          item.stockLocations.map((loc, i) => {
            const key = locKey(loc);
            const q = loc.qty ?? loc.quantity ?? 0;
            return (
              <div key={i} className="vmid-stock-row">
                <span className="vmid-stock-name">{locName(loc)}</span>
                {canEdit ? (
                  <span className="vmid-stock-edit">
                    <span className="vmid-loc-step">
                      <button className="vmid-loc-btn" onClick={() => stepLoc(loc, -1)} disabled={locBusy === key || q <= 0} aria-label={`One fewer at ${locName(loc)}`}>–</button>
                      <span className="vmid-loc-qty">{q}</span>
                      <button className="vmid-loc-btn" onClick={() => stepLoc(loc, 1)} disabled={locBusy === key} aria-label={`One more at ${locName(loc)}`}>+</button>
                    </span>
                    <button className="vmid-loc-del" onClick={() => removeLoc(loc)} disabled={locBusy === key} aria-label={`Remove from ${locName(loc)}`}>×</button>
                  </span>
                ) : (
                  <span className="vmid-stock-qty">{q}</span>
                )}
              </div>
            );
          })
        ) : (
          <p className="vmid-empty">Not placed anywhere yet.</p>
        )}
        {canEdit && item.stockLocations && item.stockLocations.length > 0 && (
          <p className="vmid-editnote">Adjust any location’s count here — the total follows. New locations are added by placing stock on a pin.</p>
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
        {canEdit && <button className="vmid-btn vmid-btn-primary" onClick={startEdit}>Edit details</button>}
        <button className="vmid-btn vmid-btn-ghost" onClick={() => navigate(`/inventory/item/${itemId}`)}>Open full page →</button>
      </div>
    </>
  );

  const drawer = (
    <>
      <div className={`vmid-backdrop${open ? ' vmid-open' : ''}`} onClick={editing ? undefined : close} />
      <aside className={`vmid-panel${open ? ' vmid-open' : ''}`} aria-label="Inventory item">
        <div className="vmid-head">
          <button className="vmid-close" onClick={close} aria-label="Close">×</button>
          <p className="vmid-eyebrow">Inventory item{editing ? ' · editing' : ''}</p>
          <h2 className="vmid-title">{src?.name || 'Loading…'}</h2>
          {!editing && catPath.length > 0 && (
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

        {!editing && (
          <div className="vmid-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'details'} className={`vmid-tab${tab === 'details' ? ' vmid-tab-on' : ''}`} onClick={() => setTab('details')}>Details</button>
            <button role="tab" aria-selected={tab === 'history'} className={`vmid-tab${tab === 'history' ? ' vmid-tab-on' : ''}`} onClick={() => setTab('history')}>History</button>
          </div>
        )}

        <div className="vmid-body">
          {!item && <p className="vmid-loading">Loading…</p>}
          {editing ? editForm : (tab === 'details' ? readView : (
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
          ))}
        </div>
      </aside>
    </>
  );

  return createPortal(drawer, document.body);
}
