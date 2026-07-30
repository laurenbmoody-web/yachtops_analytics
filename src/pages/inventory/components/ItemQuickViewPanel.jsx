import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { formatDate } from '../../../utils/dateFormat';
import { money } from '../../laundry-management-dashboard/utils/laundryBilling';
import { formatBoughtIn } from '../../../data/unitGroups';
import { duplicateItem } from '../utils/inventoryStorage';
import { printItemQr } from '../utils/itemQr';
import { findItemOnMap } from '../../vessel-map/utils/inventory';
import { getActivityForEntity } from '../../../utils/activityStorage';
import LocPath from './LocPath';
import './uniformView.css';

// Folder-path URL encoding — mirrors encodeSegment in the inventory nav page so
// the deep-link decodes back to the same folder.
const SLASH_PH = '__FWDSLASH__';
const encSeg = (s) => encodeURIComponent(String(s ?? '').replace(/\//g, SLASH_PH));

// Editorial read-only quick view for a standard (non-uniform) inventory item —
// the same slide-over drawer as the uniform view (uv-* system), so every item's
// quick view is on the Cargo design system. A `value` with an `onClick` renders
// as a link (folder path → that folder; brand/supplier → a filtered view).
const Row = ({ label, value, onClick }) => ((value == null || value === '') ? null : (
  <div className="uv-row">
    <span className="uv-k">{label}</span>
    {onClick
      ? <button type="button" className="uv-v uv-v-link" onClick={onClick}>{value}</button>
      : <span className="uv-v">{value}</span>}
  </div>
));

const ItemQuickViewPanel = ({ item, onClose, onEdit, canEdit, onDuplicated, vesselLocations = [] }) => {
  const navigate = useNavigate();
  const [activePhoto, setActivePhoto] = useState(null);
  const [dupBusy, setDupBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [mapPlaces, setMapPlaces] = useState([]);
  const [events, setEvents] = useState(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e?.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Reset the active gallery photo when switching to a different item.
  useEffect(() => { setActivePhoto(null); }, [item?.id]);

  // Render the item's saved code as a QR preview so view mode shows the actual
  // code, not just the text — click it (or Print) to reopen the label window.
  const itemCode = String(item?.barcode || item?.code || '').trim();
  useEffect(() => {
    let alive = true;
    if (!itemCode) { setQrUrl(''); return undefined; }
    import('qrcode')
      .then((m) => m.default.toDataURL(itemCode, { margin: 1, width: 240, color: { dark: '#1C1B3A', light: '#FFFFFF' } }))
      .then((url) => { if (alive) setQrUrl(url); })
      .catch(() => { if (alive) setQrUrl(''); });
    return () => { alive = false; };
  }, [itemCode]);

  const handlePrintQr = () => {
    if (!itemCode) return;
    // Open the print window synchronously so the popup blocker doesn't eat it.
    let win = null;
    try { win = window.open('', '_blank'); if (win) { win.document.write('<!doctype html><meta charset="utf-8"><title>QR label</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing label…</body>'); win.document.close(); } } catch { /* blocked */ }
    printItemQr({ code: itemCode, name: item?.name, brand: item?.brand, location: item?.subLocation || item?.location, win });
  };

  // Where this item physically sits on the GA/vessel map (pins holding it). Each
  // place gives us the scan (room) + hotspot (pin) the map deep-link needs.
  useEffect(() => {
    let alive = true;
    setMapPlaces([]);
    const tenantId = (typeof localStorage !== 'undefined' && localStorage.getItem('cargo_active_tenant_id')) || null;
    if (!tenantId || !item?.id) return undefined;
    findItemOnMap(tenantId, item.id)
      .then((r) => { if (alive && Array.isArray(r?.places) && r.places.length) setMapPlaces(r.places); })
      .catch(() => {});
    return () => { alive = false; };
  }, [item?.id]);

  // Filed under → open that inventory folder page.
  const openFolder = () => {
    const segs = [item?.location, ...String(item?.subLocation || '').split(' > ')].map((s) => (s || '').trim()).filter(Boolean);
    if (!segs.length) return;
    navigate('/inventory/location/' + segs.map(encSeg).join('/'));
    onClose?.();
  };
  // Stock location → open the vessel map focused on that pin (scan + hotspot).
  const openOnMap = (place) => {
    if (!place?.scanId || !place?.hotspotId) return;
    navigate(`/vessel/map?scan=${encodeURIComponent(place.scanId)}&pin=${encodeURIComponent(place.hotspotId)}`);
    onClose?.();
  };
  // Brand / supplier → the inventory launchpad filtered to matching items.
  const openFilter = (kind, value) => {
    const v = String(value || '').trim();
    if (!v) return;
    navigate(`/inventory/location?${kind}=${encodeURIComponent(v)}`);
    onClose?.();
  };

  // Per-item activity feed (qty changes, moves, edits) — the same events store
  // the vessel-map drawer's History tab reads.
  useEffect(() => {
    let alive = true;
    setEvents(null);
    if (!item?.id) return undefined;
    getActivityForEntity('inventoryItem', item.id)
      .then((evs) => { if (alive) setEvents(Array.isArray(evs) ? evs : []); })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [item?.id]);

  // Export this single item to a PDF spec sheet (reuses the folder exporter).
  const handleExport = async () => {
    if (exporting || !item) return;
    setExporting(true);
    try {
      const folderPath = [item?.location, item?.subLocation].filter(Boolean).join(' › ');
      const { exportInventoryToPDF } = await import('../../enhanced-4-level-inventory-navigation/utils/inventoryPdfExport');
      await exportInventoryToPDF({ items: [item], scope: 'single', folderPath, includeImages: true });
    } catch {
      window.showToast?.('Couldn’t export — try again', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!item) return null;

  const cf = item?.customFields || item?.custom_fields || {};
  const photoSrc = item?.photo?.dataUrl || (typeof item?.photo === 'string' ? item?.photo : null) || item?.imageUrl || null;
  const gallery = (Array.isArray(cf.images) && cf.images.length ? cf.images : (photoSrc ? [photoSrc] : [])).filter(Boolean);
  const mainPhoto = activePhoto || gallery[0] || photoSrc;

  const handleDuplicate = async () => {
    if (dupBusy) return;
    setDupBusy(true);
    const copy = await duplicateItem(item?.id);
    setDupBusy(false);
    if (copy) { window.showToast?.(`Duplicated — “${copy.name}” added`, 'success'); onDuplicated?.(copy); }
    else window.showToast?.('Couldn’t duplicate — try again', 'error');
  };

  const stockLocs = Array.isArray(item?.stockLocations) ? item.stockLocations : [];
  const placed = stockLocs.filter((l) => (l?.qty ?? l?.quantity ?? 0) > 0 || l?.vesselLocationId || l?.locationId);
  const total = placed.length
    ? placed.reduce((s, l) => s + (l?.qty ?? l?.quantity ?? 0), 0)
    : (item?.totalQty ?? item?.quantity ?? 0);
  const multiLoc = placed.length > 1;
  const locLabel = (l) => l?.locationName || l?.location_name || l?.subLocation || l?.name || '';
  const locId = (l) => l?.vesselLocationId || l?.locationId || '';
  // Fall back to the vessel map to name a location stored by id only.
  const nameFor = (l) => {
    if (locLabel(l)) return locLabel(l);
    const id = locId(l);
    const found = id && vesselLocations.find((v) => v?.id === id);
    return found?.name || '';
  };

  // A stock location that resolves to a map pin (matched by node id) becomes a
  // clickable row that opens the vessel map right there — no extra link rows.
  const placeByNode = new Map();
  mapPlaces.forEach((p) => { if (p?.nodeId && !placeByNode.has(p.nodeId)) placeByNode.set(p.nodeId, p); });
  const renderLoc = (l, qty, key, fallback) => {
    const pid = locId(l);
    const place = pid ? placeByNode.get(pid) : null;
    const linkProps = place ? {
      role: 'button', tabIndex: 0,
      onClick: () => openOnMap(place),
      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOnMap(place); } },
      title: `Show on the vessel map${place.scanName ? ` · ${place.scanName}` : ''}`,
    } : {};
    return (
      <div className={`uv-loc${place ? ' uv-loc-link' : ''}`} key={key} {...linkProps}>
        <span className="uv-loc-k"><Icon name="MapPin" size={13} /> <LocPath label={nameFor(l)} fallback={fallback} /></span>
        <span className="uv-loc-v">{qty}</span>
      </div>
    );
  };

  const category = [item?.l1Name, item?.l2Name].filter(Boolean).join(' · ') || null;
  const eyebrow = item?.l2Name || item?.l1Name || item?.usageDepartment || 'Inventory';
  const cost = item?.unitCost != null && item?.unitCost !== '' && Number(item?.unitCost) !== 0
    ? money(item.unitCost, item.currency || 'USD') : null;
  const expiry = item?.expiryDate || item?.expiry_date;
  const boughtIn = formatBoughtIn(item?.purchaseUnit, item?.unitsPerPack);
  const filedUnder = [item?.location, item?.subLocation].filter(Boolean).join(' › ');
  // Extended value (qty × unit cost), low-stock status, and record dates.
  const unitCostNum = Number(item?.unitCost);
  const value = unitCostNum && total ? money(unitCostNum * total, item?.currency || 'USD') : null;
  const isLow = !!item?.restockEnabled && item?.restockLevel != null && total <= item?.restockLevel;
  const created = item?.createdAt ? formatDate(item.createdAt) : null;
  const updated = item?.updatedAt ? formatDate(item.updatedAt) : null;

  const known = new Set(['colour', 'color', 'batch_no', 'batch', 'expiry_date', 'module', 'module_colour',
    'module_color', 'bag_name', 'bag_colour', 'bag_color', 'subcategory', 'folder_path', 'garmentType',
    'subType', 'fit', 'styleCode', 'branding', 'fabric', 'care', 'season']);
  const prettify = (k) => k?.replace(/_/g, ' ')?.replace(/\b\w/g, (c) => c?.toUpperCase());
  const extraFields = Object.entries(cf).filter(([k, v]) => !known.has(k) && v != null && v !== '' && typeof v !== 'object');
  const cfColour = cf.colour || cf.color;
  const cfBatch = cf.batch_no || cf.batch;

  return (
    <>
      <div className="uv-backdrop" onClick={onClose} />
      <aside className="uv-panel" role="dialog" aria-label="Item">
        <div className="uv-head">
          <div>
            <span className="uv-eyebrow">{eyebrow}</span>
            <h2 className="uv-title">{item?.name || 'Item'}</h2>
          </div>
          <button className="uv-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="uv-body">
          {mainPhoto && (
            <>
              <div className="uv-photo"><img src={mainPhoto} alt={item?.name || ''} /></div>
              {gallery.length > 1 && (
                <div className="uv-gallery">
                  {gallery.map((url, i) => (
                    <button
                      type="button"
                      key={`${url}-${i}`}
                      className={`uv-gthumb${url === mainPhoto ? ' on' : ''}`}
                      onClick={() => setActivePhoto(url)}
                      aria-label={`Photo ${i + 1}`}
                    >
                      <img src={url} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="uv-sec">
            <div className="uv-sec-h">
              <span className="uv-sec-hl">Stock{isLow && <span className="uv-lowchip" title={`On hand ${total}${item?.unit ? ` ${item.unit}` : ''}, restock at ${item?.restockLevel}`}>Low stock</span>}</span>
              <span className="uv-total">{total}{item?.unit ? ` ${item.unit}` : ''}</span>
            </div>
            {multiLoc ? (
              placed.map((l, i) => renderLoc(l, l?.qty ?? l?.quantity ?? 0, i, `Location ${i + 1}`))
            ) : (nameFor(placed[0]) ? renderLoc(placed[0], total, 'single') : null)}
          </div>

          <div className="uv-sec">
            <div className="uv-sec-h"><span>Details</span></div>
            <Row label="Cargo ID" value={item?.cargoItemId} />
            <Row label="Category" value={category} />
            <Row label="Expiry" value={expiry ? formatDate(expiry) : null} />
            <Row label="Batch number" value={cfBatch} />
            <Row label="Size" value={item?.size} />
            <Row label="Bought in" value={boughtIn} />
            <Row label="Restock level" value={item?.parLevel && item?.parLevel !== 0 ? `${item.parLevel}${item?.unit ? ` ${item.unit}` : ''}` : null} />
            <Row label="Colour" value={cfColour} />
            <Row label="Unit cost" value={cost} />
            <Row label="Total value" value={value} />
            <Row label="Module" value={cf.module} />
            <Row label="Bag" value={cf.bag_name} />
          </div>

          {itemCode && (
            <div className="uv-sec">
              <div className="uv-sec-h"><span>Barcode / label</span></div>
              <div className="uv-qr">
                {qrUrl ? (
                  <button type="button" className="uv-qr-img" onClick={handlePrintQr} title="Print / reprint this label">
                    <img src={qrUrl} alt={`QR code ${itemCode}`} />
                  </button>
                ) : (
                  <div className="uv-qr-img uv-qr-ph" />
                )}
                <div className="uv-qr-side">
                  <div className="uv-qr-code">{itemCode}</div>
                  <button type="button" className="uv-btn uv-qr-print" onClick={handlePrintQr}>
                    <Icon name="Printer" size={14} /> Print / reprint
                  </button>
                </div>
              </div>
            </div>
          )}

          {(item?.brand || item?.supplier) && (
            <div className="uv-sec">
              <div className="uv-sec-h"><span>Supply</span></div>
              <Row label="Brand" value={item?.brand} onClick={item?.brand ? () => openFilter('brand', item.brand) : undefined} />
              <Row label="Supplier" value={item?.supplier} onClick={item?.supplier ? () => openFilter('supplier', item.supplier) : undefined} />
            </div>
          )}

          {extraFields.length > 0 && (
            <div className="uv-sec">
              <div className="uv-sec-h"><span>More</span></div>
              {extraFields.map(([k, v]) => <Row key={k} label={prettify(k)} value={String(v)} />)}
            </div>
          )}

          {Array.isArray(events) && events.length > 0 && (
            <div className="uv-sec">
              <div className="uv-sec-h"><span>Activity</span></div>
              <div className="uv-acts">
                {events.slice(0, 8).map((ev) => (
                  <div className="uv-act" key={ev.id}>
                    <span className="uv-act-dot" />
                    <div className="uv-act-body">
                      <p className="uv-act-sum">{ev.summary || ev.action}</p>
                      <p className="uv-act-meta">{ev.actorName ? `${ev.actorName} · ` : ''}{formatDate(ev.createdAt)}</p>
                    </div>
                  </div>
                ))}
                {events.length > 8 && <p className="uv-act-more">+{events.length - 8} earlier</p>}
              </div>
            </div>
          )}

          {Array.isArray(item?.tags) && item.tags.length > 0 && (
            <div className="uv-sec">
              <div className="uv-sec-h"><span>Tags</span></div>
              <div className="uv-tags">{item.tags.map((t, i) => <span className="uv-tag" key={i}>{t}</span>)}</div>
            </div>
          )}

          {filedUnder && (
            <div className="uv-sec">
              <Row label="Filed under" value={filedUnder} onClick={openFolder} />
            </div>
          )}
          {item?.notes && <p className="uv-notes">{item.notes}</p>}
          {(created || updated) && (
            <p className="uv-metaline">
              {created && <span>Added {created}</span>}
              {created && updated && <span className="uv-metadot">·</span>}
              {updated && <span>Updated {updated}</span>}
            </p>
          )}
        </div>

        <div className="uv-foot">
          <button type="button" className="uv-btn uv-btn-quiet" onClick={handleExport} disabled={exporting}>
            <Icon name="FileDown" size={14} /> {exporting ? 'Exporting…' : 'Export'}
          </button>
          {onDuplicated && (
            <button type="button" className="uv-btn" onClick={handleDuplicate} disabled={dupBusy}>
              <Icon name="Copy" size={14} /> {dupBusy ? 'Duplicating…' : 'Duplicate'}
            </button>
          )}
          {canEdit && onEdit && (
            <button type="button" className="uv-btn" onClick={() => onEdit(item)}><Icon name="Pencil" size={14} /> Edit</button>
          )}
        </div>
      </aside>
    </>
  );
};

export default ItemQuickViewPanel;
