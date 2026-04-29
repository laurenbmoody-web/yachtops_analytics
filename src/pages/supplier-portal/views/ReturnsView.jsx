import React from 'react';
import { Filter, Plus, MoreHorizontal } from 'lucide-react';

const RETURNS = [
  { issue: '2 burrata short — crate damaged', sku: 'DRY-BUR-250 × 2', ym: 'm4', short: 'LUM', yacht: 'M/Y Lumen', order: '#CGO-2026-0405', items: '2 units', opened: '15 Apr', status: 'issues', statusLbl: 'Awaiting decision', credit: '€ 14.80', resolve: true },
  { issue: 'Loup de mer refused — too small',  sku: 'FSH-LDM-12 × 3',  ym: 'm2', short: 'AET', yacht: 'M/Y Aether', order: '#CGO-2026-0412', items: '3 units', opened: '17 Apr', status: 'dispatched', statusLbl: 'Collecting Tue',     credit: '€ 126.00' },
  { issue: 'Wrong vintage delivered — Ott Clos Mireille', sku: 'WIN-OTT-CM23', ym: 'm3', short: 'SOL', yacht: 'M/Y Solstice', order: '#CGO-2026-0387', items: '6 bottles', opened: '08 Apr', status: 'confirmed', statusLbl: 'Credit note issued', credit: '€ 228.00' },
];

const ReturnsView = () => (
  <div className="sp-page">
    <div className="sp-page-head">
      <div>
        <div className="sp-eyebrow">3 open · 1 awaiting your decision</div>
        <h1 className="sp-page-title">Returns &amp; <em>issues</em></h1>
        <p className="sp-page-sub">Shortages, damages, refused lines. Resolve fast to keep repeat rate up.</p>
      </div>
      <div className="sp-actions">
        <button className="sp-pill"><Filter size={13} />All yachts</button>
        <button className="sp-pill primary"><Plus size={13} />Log issue</button>
      </div>
    </div>

    <div className="sp-table-wrap">
      <table className="sp-table">
        <thead>
          <tr>
            <th>Issue</th>
            <th>Yacht</th>
            <th>Order</th>
            <th>Items</th>
            <th>Opened</th>
            <th>Status</th>
            <th className="num">Credit</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {RETURNS.map((r, i) => (
            <tr key={i}>
              <td>
                <div className="sp-line-name">{r.issue}</div>
                <div className="sp-line-sku">{r.sku}</div>
              </td>
              <td>
                <div className="sp-yacht-cell">
                  <div className={`sp-ym ${r.ym}`}>{r.short}</div>
                  <div className="sp-yn">{r.yacht}</div>
                </div>
              </td>
              <td className="mono" style={{ fontSize: 12 }}>{r.order}</td>
              <td style={{ fontSize: 13 }}>{r.items}</td>
              <td className="mono" style={{ color: 'var(--muted-s)', fontSize: 12 }}>{r.opened}</td>
              <td><span className={`sp-status ${r.status}`}><span className="d" />{r.statusLbl}</span></td>
              <td className="sp-amount">{r.credit}</td>
              <td>
                {r.resolve
                  ? <button className="sp-rb primary" style={{ textTransform: 'uppercase', fontSize: 10.5, fontFamily: 'Outfit', letterSpacing: '0.06em' }}>Resolve</button>
                  : <button className="sp-rb"><MoreHorizontal size={13} /></button>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default ReturnsView;
