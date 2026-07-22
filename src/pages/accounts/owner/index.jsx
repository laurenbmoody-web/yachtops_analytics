// Cargo Accounts — Phase 3. Owner view (/accounts/owner). A read-mostly owner lens:
// pick a period (presets + custom), see the position, budget-vs-actual by bucket
// and the plain-language variance narrative — assembled from the budget services
// so it matches Budgets exactly. Generate a statement, issue it (snapshot frozen),
// export to Excel or print/PDF. No operational editing.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { formatMoney } from '../../../services/financeCalc';
import {
  generateStatementData, listStatements, createStatement, issueStatement, deleteStatement,
} from '../../../services/ownerStatementService';
import '../accounts.css';
import './owner.css';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDMY = (s) => { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const SEV = { crit: '#B14E16', warn: '#B5762B', good: '#3F7A52', info: '#8B8478' };

function presetRange(preset, now) {
  const y = now.getFullYear(); const m = now.getMonth();
  if (preset === 'month') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
  if (preset === 'quarter') { const q = Math.floor(m / 3); return [iso(new Date(y, q * 3, 1)), iso(new Date(y, q * 3 + 3, 0))]; }
  return [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31))]; // year / season
}
const presetTitle = (preset, now) => {
  const y = now.getFullYear();
  if (preset === 'month') return `${now.toLocaleDateString('en-GB', { month: 'long' })} ${y} Owner Statement`;
  if (preset === 'quarter') return `Q${Math.floor(now.getMonth() / 3) + 1} ${y} Owner Statement`;
  return `${y} Season Owner Statement`;
};

export default function OwnerView() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { hasCommandAccess } = useAuth();
  const canIssue = hasCommandAccess();
  const now = useMemo(() => new Date(), []);

  const [preset, setPreset] = useState('year');
  const [range, setRange] = useState(() => presetRange('year', new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statements, setStatements] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const cur = data?.header?.currency || 'EUR';

  const loadData = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const { data: d } = await generateStatementData(activeTenantId, range[0], range[1], { title: presetTitle(preset, now) });
    setData(d || null);
    setLoading(false);
  }, [activeTenantId, range, preset, now]);

  const loadStatements = useCallback(async () => {
    if (!activeTenantId) return;
    const { data: rows } = await listStatements(activeTenantId);
    setStatements(rows || []);
  }, [activeTenantId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadStatements(); }, [loadStatements]);

  const setPresetRange = (p) => { setPreset(p); setRange(presetRange(p, now)); };
  const setCustom = (i, v) => { setPreset('custom'); setRange((r) => (i === 0 ? [v, r[1]] : [r[0], v])); };

  const onGenerate = async () => {
    setBusy(true);
    const title = preset === 'custom' ? `Owner Statement ${fmtDMY(range[0])}–${fmtDMY(range[1])}` : presetTitle(preset, now);
    const { error } = await createStatement({ tenantId: activeTenantId, title, periodStart: range[0], periodEnd: range[1], currency: cur });
    setBusy(false);
    if (error) { flash('Could not save the statement.'); return; }
    await loadStatements();
    flash('Statement saved as draft');
  };

  const onIssue = async (stmt) => {
    setBusy(true);
    const { data: snap } = await generateStatementData(activeTenantId, stmt.period_start, stmt.period_end, { title: stmt.title, currency: stmt.currency });
    const { error } = await issueStatement(stmt.id, snap);
    setBusy(false);
    if (error) { flash('Could not issue.'); return; }
    await loadStatements();
    flash('Statement issued — snapshot frozen');
  };

  const onDelete = async (stmt) => { setBusy(true); await deleteStatement(stmt.id); setBusy(false); await loadStatements(); flash('Statement removed'); };

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const pos = data.position || {};
    const summary = [
      ['Owner Statement', data.header?.title || ''],
      ['Period', `${fmtDMY(range[0])} – ${fmtDMY(range[1])}`],
      ['Currency', cur], [],
      ['Budget', pos.budget], ['Actual', pos.actual], ['Committed', pos.committed],
      ['Remaining', pos.remaining], ['Forecast to period end', pos.forecast],
      ['Revenue (actual)', pos.revenueActual], ['Net revenue/(expenditure)', pos.net],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
    const rows = [['Bucket', 'Budget', 'Actual', 'Committed', 'Variance', '% used'],
      ...(data.expenseBuckets || []).map((b) => [b.bucket, b.budget, b.actual, b.committed, b.variance, b.pctUsed != null ? Math.round(b.pctUsed * 100) + '%' : '—'])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Budget vs actual');
    XLSX.writeFile(wb, `owner-statement-${range[0]}_${range[1]}.xlsx`);
  };

  const pos = data?.position || {};
  const kpis = [
    { l: 'Budget', v: pos.budget }, { l: 'Actual', v: pos.actual },
    { l: 'Committed', v: pos.committed }, { l: 'Remaining', v: pos.remaining },
    { l: 'Forecast', v: pos.forecast, sub: pos.forecastOver > 0 ? `~${formatMoney(pos.forecastOver, cur)} over` : 'within budget' },
  ];

  return (
    <>
      <Header />
      <div className="ca-page">
        <div className="ca-wrap ow-print">
          <button type="button" className="ca-back ow-noprint" onClick={() => navigate('/accounts')}>
            <Icon name="ChevronLeft" size={16} /> Accounts
          </button>

          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span><span>Owner reporting</span>
              <span className="bar" /><span className="muted">{fmtDMY(range[0])} – {fmtDMY(range[1])}</span>
              <span className="bar" /><span className="muted">{cur}</span>
            </p>
            <div className="ca-titlerow">
              <h1 className="ca-title">The <em>position</em>.</h1>
              <div className="ca-head-act ow-noprint">
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => window.print()}><Icon name="Printer" size={16} /> Print / PDF</button>
                <button type="button" className="ca-btn ca-btn-ghost" onClick={exportExcel}><Icon name="Download" size={16} /> Excel</button>
                <button type="button" className="ca-btn ca-btn-primary" onClick={onGenerate} disabled={busy}><Icon name="FileText" size={16} /> Generate statement</button>
              </div>
            </div>
          </div>

          {/* period picker */}
          <div className="ow-period ow-noprint">
            {[['month', 'This month'], ['quarter', 'This quarter'], ['year', 'Season / year']].map(([v, l]) => (
              <button key={v} className={`ow-preset ${preset === v ? 'on' : ''}`} onClick={() => setPresetRange(v)}>{l}</button>
            ))}
            <span className="ow-or">or</span>
            <input type="date" className="ow-date" value={range[0]} onChange={(e) => setCustom(0, e.target.value)} />
            <span className="ow-dash">→</span>
            <input type="date" className="ow-date" value={range[1]} onChange={(e) => setCustom(1, e.target.value)} />
          </div>

          {loading ? (
            <div className="ca-empty"><p>Assembling the position…</p></div>
          ) : (
            <>
              {data?.noBudget && (
                <div className="ow-nobudget"><Icon name="Info" size={16} /> No budget covers this period, so budget-vs-actual is empty. Create a budget for these dates to populate the statement.</div>
              )}

              {/* position KPIs */}
              <div className="ow-kpis">
                {kpis.map((k) => (
                  <div key={k.l} className="ow-kpi">
                    <span className="ow-kl">{k.l}</span>
                    <b className="ow-kv ca-num">{formatMoney(k.v || 0, cur)}</b>
                    {k.sub && <span className="ow-km">{k.sub}</span>}
                  </div>
                ))}
                <div className="ow-kpi ow-net">
                  <span className="ow-kl">Net revenue / (exp.)</span>
                  <b className={`ow-kv ca-num ${pos.net >= 0 ? 'ow-pos' : 'ow-neg'}`}>{formatMoney(pos.net || 0, cur)}</b>
                  <span className="ow-km">Revenue {formatMoney(pos.revenueActual || 0, cur)}</span>
                </div>
              </div>

              {/* variance narrative */}
              {data?.narrative?.length > 0 && (
                <div className="ow-narr">
                  {data.narrative.map((n, i) => (
                    <div key={i} className="ow-narr-row"><i style={{ background: SEV[n.sev] || '#8B8478' }} /><span>{n.text}</span></div>
                  ))}
                </div>
              )}

              {/* budget vs actual by bucket */}
              <div className="ow-sec">
                <div className="ow-sec-h"><span className="ow-sec-t">Budget vs actual</span><span className="ow-sec-n">by bucket</span></div>
                {(data?.expenseBuckets || []).length === 0 ? (
                  <div className="ca-empty"><p className="ca-empty-sub">No expenditure in this period.</p></div>
                ) : (
                  <div className="ow-table">
                    <div className="ow-tr ow-th"><span>Bucket</span><span className="r">Budget</span><span className="r">Actual</span><span className="r">Variance</span><span className="ow-barcell">Used</span></div>
                    {data.expenseBuckets.map((b) => {
                      const pctUsed = b.pctUsed != null ? Math.min(1, b.pctUsed) : 0;
                      const over = b.variance < 0;
                      return (
                        <div key={b.bucket} className="ow-tr">
                          <span className="ow-bk">{b.bucket}</span>
                          <span className="r ca-num">{formatMoney(b.budget, cur)}</span>
                          <span className="r ca-num">{formatMoney(b.actual, cur)}</span>
                          <span className={`r ca-num ${over ? 'ow-neg' : 'ow-pos'}`}>{formatMoney(b.variance, cur)}</span>
                          <span className="ow-barcell"><span className="ow-bar"><i style={{ width: `${Math.round(pctUsed * 100)}%`, background: over ? '#C65A1A' : '#6FBF8B' }} /></span><em>{b.pctUsed != null ? `${Math.round(b.pctUsed * 100)}%` : '—'}</em></span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* revenue */}
              {(data?.revenueBuckets || []).length > 0 && (
                <div className="ow-sec">
                  <div className="ow-sec-h"><span className="ow-sec-t">Revenue</span></div>
                  <div className="ow-table">
                    {data.revenueBuckets.map((b) => (
                      <div key={b.bucket} className="ow-tr"><span className="ow-bk">{b.bucket}</span><span className="r ca-num">{formatMoney(b.budget, cur)}</span><span className="r ca-num">{formatMoney(b.actual, cur)}</span><span className="r" /><span className="ow-barcell" /></div>
                    ))}
                  </div>
                </div>
              )}

              {/* saved statements */}
              <div className="ow-sec ow-noprint">
                <div className="ow-sec-h"><span className="ow-sec-t">Statements</span><span className="ow-sec-n">{statements.length}</span></div>
                {statements.length === 0 ? (
                  <p className="ca-empty-sub" style={{ padding: '8px 2px' }}>No statements yet — generate one above.</p>
                ) : statements.map((s) => (
                  <div key={s.id} className="ow-stmt">
                    <span className={`ow-stmt-st ${s.status}`}>{s.status === 'issued' ? 'Issued' : 'Draft'}</span>
                    <div className="ow-stmt-id"><div className="ow-stmt-t">{s.title}</div><div className="ow-stmt-p">{fmtDMY(s.period_start)} – {fmtDMY(s.period_end)}{s.issued_at ? ` · issued ${fmtDMY(s.issued_at)}` : ''}</div></div>
                    <div className="ow-stmt-act">
                      {s.status === 'draft' && canIssue && <button className="ca-btn ca-btn-ghost ca-btn-sm" disabled={busy} onClick={() => onIssue(s)}>Issue</button>}
                      {canIssue && <button className="ow-link" disabled={busy} onClick={() => onDelete(s)}><Icon name="Trash2" size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>

              {data?.note && <div className="ow-note"><b>Notes</b><p>{data.note}</p></div>}
            </>
          )}
        </div>
        {toast && <div className="ca-toast">{toast}</div>}
      </div>
    </>
  );
}
