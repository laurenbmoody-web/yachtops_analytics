import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatDate } from '../../../utils/dateFormat';
import { money } from '../../laundry-management-dashboard/utils/laundryBilling';
import { formatBoughtIn } from '../../../data/unitGroups';
import { duplicateItem } from '../utils/inventoryStorage';
import { printItemQr } from '../utils/itemQr';
import LocPath from './LocPath';
import './uniformView.css';

// Editorial read-only quick view for a standard (non-uniform) inventory item —
// the same slide-over drawer as the uniform view (uv-* system), so every item's
// quick view is on the Cargo design system.
const Row = ({ label, value }) => ((value == null || value === '') ? null : (
  <div className="uv-row"><span className="uv-k">{label}</span><span className="uv-v">{value}</span></div>
));

const ItemQuickViewPanel = ({ item, onClose, onEdit, canEdit, onDuplicated, vesselLocations = [] }) => {
  const [activePhoto, setActivePhoto] = useState(null);
  const [dupBusy, setDupBusy] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
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

  const category = [item?.l1Name, item?.l2Name].filter(Boolean).join(' · ') || null;
  const eyebrow = item?.l2Name || item?.l1Name || item?.usageDepartment || 'Inventory';
  const cost = item?.unitCost != null && item?.unitCost !== '' && Number(item?.unitCost) !== 0
    ? money(item.unitCost, item.currency || 'USD') : null;
  const expiry = item?.expiryDate || item?.expiry_date;
  const boughtIn = formatBoughtIn(item?.purchaseUnit, item?.unitsPerPack);
  const filedUnder = [item?.location, item?.subLocation].filter(Boolean).join(' › ');

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
            <div className="uv-sec-h"><span>Stock</span><span className="uv-total">{total}{item?.unit ? ` ${item.unit}` : ''}</span></div>
            {multiLoc ? (
              placed.map((l, i) => (
                <div className="uv-loc" key={i}>
                  <span className="uv-loc-k"><Icon name="MapPin" size={13} /> <LocPath label={nameFor(l)} fallback={`Location ${i + 1}`} /></span>
                  <span className="uv-loc-v">{l?.qty ?? l?.quantity ?? 0}</span>
                </div>
              ))
            ) : (nameFor(placed[0]) ? (
              <div className="uv-loc">
                <span className="uv-loc-k"><Icon name="MapPin" size={13} /> <LocPath label={nameFor(placed[0])} /></span>
                <span className="uv-loc-v">{total}</span>
              </div>
            ) : null)}
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
              <Row label="Brand" value={item?.brand} />
              <Row label="Supplier" value={item?.supplier} />
            </div>
          )}

          {extraFields.length > 0 && (
            <div className="uv-sec">
              <div className="uv-sec-h"><span>More</span></div>
              {extraFields.map(([k, v]) => <Row key={k} label={prettify(k)} value={String(v)} />)}
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
              <Row label="Filed under" value={filedUnder} />
            </div>
          )}
          {item?.notes && <p className="uv-notes">{item.notes}</p>}
        </div>

        {((canEdit && onEdit) || onDuplicated) && (
          <div className="uv-foot">
            {onDuplicated && (
              <button type="button" className="uv-btn uv-btn-quiet" onClick={handleDuplicate} disabled={dupBusy}>
                <Icon name="Copy" size={14} /> {dupBusy ? 'Duplicating…' : 'Duplicate'}
              </button>
            )}
            {canEdit && onEdit && (
              <button type="button" className="uv-btn" onClick={() => onEdit(item)}><Icon name="Pencil" size={14} /> Edit</button>
            )}
          </div>
        )}
      </aside>
    </>
  );
};

export default ItemQuickViewPanel;
