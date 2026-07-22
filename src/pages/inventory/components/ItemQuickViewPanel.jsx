import React, { useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { formatDate } from '../../../utils/dateFormat';
import { money } from '../../laundry-management-dashboard/utils/laundryBilling';
import { formatBoughtIn } from '../../../data/unitGroups';
import LocPath from './LocPath';
import './uniformView.css';

// Editorial read-only quick view for a standard (non-uniform) inventory item —
// the same slide-over drawer as the uniform view (uv-* system), so every item's
// quick view is on the Cargo design system.
const Row = ({ label, value }) => ((value == null || value === '') ? null : (
  <div className="uv-row"><span className="uv-k">{label}</span><span className="uv-v">{value}</span></div>
));

const ItemQuickViewPanel = ({ item, onClose, onEdit, canEdit, vesselLocations = [] }) => {
  useEffect(() => {
    const onKey = (e) => { if (e?.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;

  const cf = item?.customFields || item?.custom_fields || {};
  const photoSrc = item?.photo?.dataUrl || (typeof item?.photo === 'string' ? item?.photo : null) || item?.imageUrl || null;

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
          {photoSrc && <div className="uv-photo"><img src={photoSrc} alt={item?.name || ''} /></div>}

          <div className="uv-sec">
            <div className="uv-sec-h"><span>Stock</span><span className="uv-total">{total}{item?.unit ? ` ${item.unit}` : ''}</span></div>
            {multiLoc ? (
              <div className="uv-storelist">
                {placed.map((l, i) => (
                  <div className="uv-storerow" key={i}>
                    <span className="uv-stored"><Icon name="MapPin" size={14} /> <LocPath label={nameFor(l)} fallback={`Location ${i + 1}`} /></span>
                    <span className="uv-storesizes">{l?.qty ?? l?.quantity ?? 0}</span>
                  </div>
                ))}
              </div>
            ) : (nameFor(placed[0]) ? (
              <p className="uv-stored"><Icon name="MapPin" size={14} /> <LocPath label={nameFor(placed[0])} /></p>
            ) : null)}
          </div>

          <div className="uv-sec">
            <div className="uv-sec-h"><span>Details</span></div>
            <Row label="Cargo ID" value={item?.cargoItemId} />
            <Row label="Category" value={category} />
            <Row label="Barcode / code" value={item?.barcode || item?.code} />
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

        {canEdit && onEdit && (
          <div className="uv-foot">
            <button type="button" className="uv-btn" onClick={() => onEdit(item)}><Icon name="Pencil" size={14} /> Edit</button>
          </div>
        )}
      </aside>
    </>
  );
};

export default ItemQuickViewPanel;
