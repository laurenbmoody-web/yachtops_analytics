import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Plus, Folder, Boxes, Eye, Search, Package, MoreHorizontal } from 'lucide-react';
import { CATALOGUE } from '../data';

const CatalogueView = () => {
  const [search, setSearch] = useState('');
  const filtered = CATALOGUE.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Products · 312 SKUs</div>
          <h1 className="sp-page-title">Your <em>catalogue</em></h1>
          <p className="sp-page-sub">What you sell, to whom, at what price. Yacht-specific price lists live under each product.</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill ghost"><Upload size={13} />Import CSV</button>
          <button className="sp-pill"><FileSpreadsheet size={13} />Export</button>
          <button className="sp-pill primary"><Plus size={13} />New product</button>
        </div>
      </div>

      <div className="sp-filters">
        <button className="sp-filter"><Folder size={12} />All categories</button>
        <button className="sp-filter"><Boxes size={12} />Stock</button>
        <button className="sp-filter"><Eye size={12} />Visibility</button>
        <div className="sp-filter-sep" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 20, padding: '5px 12px', minWidth: 220 }}>
          <Search size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--fg)', fontFamily: 'inherit', width: '100%' }}
          />
        </div>
      </div>

      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}><input type="checkbox" /></th>
              <th>Product</th>
              <th>Category</th>
              <th>Unit</th>
              <th className="num">Base price</th>
              <th>Stock</th>
              <th>Visible to</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.sku}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox" /></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Package size={14} style={{ color: 'var(--muted)' }} />
                    </div>
                    <div>
                      <div className="sp-line-name" style={{ fontSize: 13 }}>{p.name}</div>
                      <div className="sp-line-sku">{p.sku}</div>
                    </div>
                  </div>
                </td>
                <td style={{ color: 'var(--fg-2)', fontSize: 13 }}>{p.cat}</td>
                <td style={{ color: 'var(--muted-s)', fontSize: 13 }}>{p.unit}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{p.price}</td>
                <td>
                  <span className={`sp-stock ${p.stock}`}>
                    <span className="d" />{p.stockLbl}
                  </span>
                </td>
                <td>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 12,
                    background: p.vis === 'all' ? '#DCFCE7' : '#EFF6FF',
                    color: p.vis === 'all' ? '#166534' : '#1D4ED8',
                  }}>
                    {p.vis === 'all' ? 'All yachts' : 'Select only'}
                  </span>
                </td>
                <td style={{ color: 'var(--muted)', fontSize: 11.5 }}>{p.updated}</td>
                <td><button className="sp-rb"><MoreHorizontal size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CatalogueView;
