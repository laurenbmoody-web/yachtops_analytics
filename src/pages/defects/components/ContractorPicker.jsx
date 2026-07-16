// Contractor picker — links a defect's contractor to the Suppliers directory
// (supplier_profiles / "vendors"). Type to search; Contractors and Service
// Providers float to the top. If the name isn't on file, offer to add it to the
// directory so it's there for next time. Typing free text keeps working too —
// it just saves an unlinked name (onChange with supplierId:null).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchVendors, createVendor } from '../../provisioning/utils/provisioningStorage';

// Vendor types you'd actually book to fix a defect — sorted to the top.
const FIXER_TYPES = new Set(['Contractor', 'Service Provider']);

export default function ContractorPicker({ value = '', supplierId = null, onChange, tenantId }) {
  const wrapRef = useRef(null);
  const [vendors, setVendors] = useState([]);
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await fetchVendors();
      if (live) setVendors(data || []);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = q ? vendors.filter((v) => (v.name || '').toLowerCase().includes(q)) : vendors;
    return [...list].sort((a, b) => {
      const af = FIXER_TYPES.has(a.vendor_type) ? 0 : 1;
      const bf = FIXER_TYPES.has(b.vendor_type) ? 0 : 1;
      return af - bf || (a.name || '').localeCompare(b.name || '');
    }).slice(0, 8);
  }, [vendors, q]);

  const exactExists = q && vendors.some((v) => (v.name || '').trim().toLowerCase() === q);

  const pick = (v) => { onChange?.({ supplierId: v.id, name: v.name }); setQuery(v.name); setOpen(false); };
  const onType = (t) => { setQuery(t); setErr(''); setOpen(true); onChange?.({ supplierId: null, name: t }); };

  const addToDirectory = async () => {
    const name = query.trim();
    if (!name || !tenantId) return;
    setAdding(true); setErr('');
    const { data, error } = await createVendor({
      name, vendor_type: 'Contractor', categories: [], subcategories: [], tenant_id: tenantId,
    });
    setAdding(false);
    if (error || !data) { setErr('Could not add to the directory.'); return; }
    setVendors((vs) => [...vs, data]);
    onChange?.({ supplierId: data.id, name: data.name });
    setQuery(data.name);
    setOpen(false);
  };

  return (
    <div className="dd-cpick" ref={wrapRef}>
      <div className="dd-cpick-field">
        <input
          className="dd-input"
          value={query}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search directory or type a name…"
          aria-label="Contractor"
        />
        {supplierId && <span className="dd-cpick-linked" title="Linked to the directory"><Icon name="Link2" size={13} /></span>}
      </div>

      {open && (matches.length > 0 || (q && !exactExists)) && (
        <div className="dd-cpick-pop">
          {matches.map((v) => (
            <button type="button" key={v.id} className="dd-cpick-opt" onClick={() => pick(v)}>
              <span className="nm">{v.name}</span>
              <span className="ty">{v.vendor_type}</span>
            </button>
          ))}
          {q && !exactExists && (
            <button type="button" className="dd-cpick-add" onClick={addToDirectory} disabled={adding}>
              <Icon name="Plus" size={13} /> {adding ? 'Adding…' : <>Add <b>“{query.trim()}”</b> to directory</>}
            </button>
          )}
        </div>
      )}
      {err && <p className="dd-err" style={{ marginTop: 4 }}>{err}</p>}
    </div>
  );
}
