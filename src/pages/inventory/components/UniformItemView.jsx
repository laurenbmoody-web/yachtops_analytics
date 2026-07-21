import React, { useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { money } from '../../laundry-management-dashboard/utils/laundryBilling';
import './uniformView.css';

// Read-only quick view for a uniform inventory item — the editorial counterpart
// to UniformItemModal. Shows the size run (qty per size) and the uniform fields
// with proper labels (no raw custom-field dump / [object Object]).
const Row = ({ label, value }) => ((value == null || value === '') ? null : (
  <div className="uv-row"><span className="uv-k">{label}</span><span className="uv-v">{value}</span></div>
));

const UniformItemView = ({ item, canEdit, onEdit, onClose }) => {
  useEffect(() => {
    const onKey = (e) => { if (e?.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cf = item?.customFields || item?.custom_fields || {};
  const variants = (item?.variants || []).filter((v) => v && (v.size || v.label));
  const total = variants.length
    ? variants.reduce((a, v) => a + (Number(v.qty ?? v.quantity) || 0), 0)
    : (Number(item?.totalQty ?? item?.quantity) || 0);
  const b = cf.branding || {};
  const brandingLine = [b.colour, b.logo, b.placement].filter(Boolean).join(' · ');
  const branding = (b.type && b.type !== 'None') ? [b.type, brandingLine].filter(Boolean).join(' — ') : null;
  const cost = item?.unitCost != null && item?.unitCost !== '' ? money(item.unitCost, item.currency || 'EUR') : null;

  return (
    <>
      <div className="uv-backdrop" onClick={onClose} />
      <aside className="uv-panel" role="dialog" aria-label="Uniform item">
        <div className="uv-head">
          <div>
            <span className="uv-eyebrow">Uniform</span>
            <h2 className="uv-title">{item?.name || 'Uniform item'}</h2>
          </div>
          <button className="uv-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="uv-body">
          {item?.imageUrl && <div className="uv-photo"><img src={item.imageUrl} alt={item?.name || ''} /></div>}

          <div className="uv-sec">
            <div className="uv-sec-h"><span>Size run</span><span className="uv-total">{total} total</span></div>
            {variants.length ? (
              <div className="uv-sizes">
                {variants.map((v, i) => (
                  <div className="uv-size" key={i}>
                    <span className="uv-size-lbl">{v.size || v.label}</span>
                    <span className="uv-size-qty">{v.qty ?? v.quantity ?? 0}</span>
                  </div>
                ))}
              </div>
            ) : <p className="uv-empty">No size breakdown recorded.</p>}
          </div>

          <div className="uv-sec">
            <div className="uv-sec-h"><span>Details</span></div>
            <Row label="Garment" value={cf.garmentType} />
            <Row label="Sub-type" value={cf.subType} />
            <Row label="Fit" value={cf.fit} />
            <Row label="Colour" value={cf.colour} />
            <Row label="Branding" value={branding} />
            <Row label="Fabric" value={cf.fabric} />
            <Row label="Care" value={cf.care} />
            <Row label="Season" value={cf.season} />
          </div>

          <div className="uv-sec">
            <div className="uv-sec-h"><span>Supply</span></div>
            <Row label="Brand" value={item?.brand} />
            <Row label="Supplier" value={item?.supplier} />
            <Row label="Style code / SKU" value={cf.styleCode} />
            <Row label="Unit cost" value={cost} />
          </div>

          <div className="uv-sec">
            <Row label="Filed under" value={[item?.location, item?.subLocation].filter(Boolean).join(' › ')} />
          </div>
          {item?.notes && <p className="uv-notes">{item.notes}</p>}
        </div>

        {canEdit && (
          <div className="uv-foot">
            <button type="button" className="uv-btn" onClick={() => onEdit?.(item)}><Icon name="Pencil" size={14} /> Edit</button>
          </div>
        )}
      </aside>
    </>
  );
};

export default UniformItemView;
