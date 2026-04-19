import React, { useState } from 'react';
import { FileClock, AlertTriangle, CheckCheck, Clock, FileText, Upload, Plus, Ship, Calendar, MoreHorizontal } from 'lucide-react';
import { INVOICES } from '../data';

const InvoicesView = () => {
  const [filter, setFilter] = useState('All');
  const filters = ['All', 'Open', 'Overdue', 'Paid'];

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">April · 2026</div>
          <h1 className="sp-page-title">Open <em>invoices</em></h1>
          <p className="sp-page-sub"><b>€12,480</b> outstanding across 3 yachts. One overdue — Lumen, 14 days.</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill ghost"><FileText size={13} />Statements</button>
          <button className="sp-pill"><Upload size={13} />Export to Xero</button>
          <button className="sp-pill primary"><Plus size={13} />New invoice</button>
        </div>
      </div>

      <div className="sp-kpis">
        <div className="sp-kpi blue">
          <div className="sp-kpi-label"><FileClock size={11} />OPEN</div>
          <div className="sp-kpi-value">€ 12,480</div>
          <div className="sp-kpi-sub"><b>3</b> invoices · avg 18 days</div>
        </div>
        <div className="sp-kpi amber">
          <div className="sp-kpi-label"><AlertTriangle size={11} />OVERDUE</div>
          <div className="sp-kpi-value">€ 4,160</div>
          <div className="sp-kpi-sub"><b>1</b> invoice · M/Y Lumen</div>
        </div>
        <div className="sp-kpi green">
          <div className="sp-kpi-label"><CheckCheck size={11} />PAID · APR</div>
          <div className="sp-kpi-value">€ 71,730</div>
          <div className="sp-kpi-sub"><span className="sp-delta up">+8%</span> vs Mar</div>
        </div>
        <div className="sp-kpi">
          <div className="sp-kpi-label"><Clock size={11} />DAYS TO PAY</div>
          <div className="sp-kpi-value">14 d</div>
          <div className="sp-kpi-sub">median · past 90 days</div>
        </div>
      </div>

      <div className="sp-filters">
        {filters.map(f => (
          <button key={f} className={`sp-filter${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
        <div className="sp-filter-sep" />
        <button className="sp-filter"><Ship size={12} />Yacht</button>
        <button className="sp-filter"><Calendar size={12} />Month</button>
      </div>

      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Yacht</th>
              <th>Issued</th>
              <th>Due</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {INVOICES.map(inv => (
              <tr key={inv.id}>
                <td>
                  <div className="sp-oid">#<b>{inv.id.split('-').pop()}</b></div>
                  <div className="sp-oid-full">{inv.id}</div>
                </td>
                <td>
                  <div className="sp-yacht-cell">
                    <div className={`sp-ym ${inv.yachtColor}`}>{inv.yachtShort}</div>
                    <div className="sp-yn">{inv.yacht}</div>
                  </div>
                </td>
                <td className="mono" style={{ color: 'var(--fg-2)', fontSize: 12 }}>{inv.issued}</td>
                <td className="mono" style={{ color: inv.overdueDays ? 'var(--red)' : 'var(--fg-2)', fontSize: 12 }}>
                  {inv.due}
                  {inv.overdueDays && <span style={{ fontSize: 10.5 }}> · {inv.overdueDays}d over</span>}
                </td>
                <td className="sp-amount">{inv.amount}</td>
                <td><span className={`sp-status ${inv.status}`}><span className="d" />{inv.statusLbl}</span></td>
                <td><button className="sp-rb"><MoreHorizontal size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InvoicesView;
