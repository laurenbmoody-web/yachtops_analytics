import React, { useEffect, useMemo, useState } from 'react';

import Icon from '../../../components/AppIcon';
import { getLaundryBilling, setLaundryBilling, DEFAULT_LAUNDRY_BILLING } from '../../laundry-management-dashboard/utils/laundryStorage';
import './CharterBillingSettings.css';

const CURRENCIES = [{ v: 'EUR', s: '€' }, { v: 'GBP', s: '£' }, { v: 'USD', s: '$' }];
const curSym = (c) => CURRENCIES.find((x) => x.v === c)?.s || '';

// Vessel-level config for how guest laundry is billed on a "plus expenses"
// (MYBA) charter. Inclusive charters bill nothing, so this only bites when a
// charter's basis is set to plus-expenses.
const CharterBillingSettings = ({ canEdit }) => {
  const [cfg, setCfg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getLaundryBilling().then((c) => setCfg(c)).catch(() => setCfg({ ...DEFAULT_LAUNDRY_BILLING })); }, []);

  const set = (patch) => { setCfg((c) => ({ ...c, ...patch })); setDirty(true); };
  const sym = useMemo(() => curSym(cfg?.currency), [cfg?.currency]);

  const setPriceRow = (i, patch) => set({ priceList: cfg.priceList.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const addPriceRow = () => set({ priceList: [...(cfg.priceList || []), { label: '', price: '' }] });
  const removePriceRow = (i) => set({ priceList: cfg.priceList.filter((_, j) => j !== i) });

  const save = async () => {
    setSaving(true);
    const cleanList = (cfg.priceList || [])
      .map((r) => ({ label: (r.label || '').trim(), price: Number(r.price) || 0 }))
      .filter((r) => r.label);
    const ok = await setLaundryBilling({
      scope: cfg.scope, pricing: cfg.pricing, flatRate: Number(cfg.flatRate) || 0,
      currency: cfg.currency, priceList: cleanList,
    });
    setSaving(false);
    if (ok) { setCfg((c) => ({ ...c, priceList: cleanList })); setDirty(false); }
  };

  if (!cfg) return <div className="cbs"><p className="cbs-loading">Loading…</p></div>;

  const readOnly = !canEdit;

  return (
    <div className="cbs">
      <p className="cbs-intro">
        How guests’ personal laundry is charged on a <b>plus-expenses (MYBA)</b> charter. On an
        <b> inclusive (CYBA)</b> charter nothing is billed, and crew &amp; ship’s-linen (“Other”) items are never charged.
        Set a charter’s basis on the trip itself.
      </p>

      {readOnly && <div className="cbs-note">View-only — only Command can change billing settings.</div>}

      <fieldset className="cbs-fs" disabled={readOnly}>
        {/* Currency */}
        <div className="cbs-row">
          <div className="cbs-label"><span>Currency</span><small>Matches the charter fee currency.</small></div>
          <div className="cbs-seg">
            {CURRENCIES.map((c) => (
              <button type="button" key={c.v} className={cfg.currency === c.v ? 'on' : ''} onClick={() => set({ currency: c.v })}>{c.s} {c.v}</button>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div className="cbs-row">
          <div className="cbs-label"><span>What’s billable</span><small>Which guest laundry gets charged.</small></div>
          <div className="cbs-seg wide">
            <button type="button" className={cfg.scope === 'shoreside' ? 'on' : ''} onClick={() => set({ scope: 'shoreside' })}>Shoreside only</button>
            <button type="button" className={cfg.scope === 'all' ? 'on' : ''} onClick={() => set({ scope: 'all' })}>All guest items</button>
          </div>
        </div>
        <p className="cbs-hint">
          {cfg.scope === 'shoreside'
            ? 'Only guest items sent ashore to a vendor are charged (at the vendor’s invoice amount). Onboard laundry stays free.'
            : 'Every guest laundry item is charged, onboard and ashore.'}
        </p>

        {/* Pricing (onboard items) */}
        <div className="cbs-row">
          <div className="cbs-label"><span>Onboard pricing</span><small>How onboard guest items are priced. Shore-sent items always use the vendor’s invoice.</small></div>
          <div className="cbs-select">
            <select value={cfg.pricing} onChange={(e) => set({ pricing: e.target.value })}>
              <option value="manual">Enter per item</option>
              <option value="flat">Flat rate per piece</option>
              <option value="pricelist">Price list by type</option>
            </select>
          </div>
        </div>

        {cfg.pricing === 'flat' && (
          <div className="cbs-row">
            <div className="cbs-label"><span>Flat rate</span><small>Charged per billable guest piece.</small></div>
            <div className="cbs-money">
              <span className="cbs-cur">{sym}</span>
              <input type="number" min="0" step="0.01" value={cfg.flatRate ?? ''} onChange={(e) => set({ flatRate: e.target.value })} placeholder="0.00" />
            </div>
          </div>
        )}

        {cfg.pricing === 'pricelist' && (
          <div className="cbs-pl">
            <div className="cbs-pl-head"><span>Item</span><span>Price</span><span /></div>
            {(cfg.priceList || []).length === 0 && <p className="cbs-hint">No prices yet — add a row for each laundry type you charge for.</p>}
            {(cfg.priceList || []).map((r, i) => (
              <div className="cbs-pl-row" key={i}>
                <input className="cbs-pl-label" value={r.label} onChange={(e) => setPriceRow(i, { label: e.target.value })} placeholder="e.g. Shirt" />
                <div className="cbs-money sm">
                  <span className="cbs-cur">{sym}</span>
                  <input type="number" min="0" step="0.01" value={r.price} onChange={(e) => setPriceRow(i, { price: e.target.value })} placeholder="0.00" />
                </div>
                <button type="button" className="cbs-pl-x" onClick={() => removePriceRow(i)} aria-label="Remove"><Icon name="X" size={14} /></button>
              </div>
            ))}
            <button type="button" className="cbs-pl-add" onClick={addPriceRow}><Icon name="Plus" size={14} /> Add item</button>
          </div>
        )}
      </fieldset>

      {!readOnly && (
        <div className="cbs-foot">
          <button type="button" className="cbs-save" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save billing settings'}</button>
        </div>
      )}
    </div>
  );
};

export default CharterBillingSettings;
