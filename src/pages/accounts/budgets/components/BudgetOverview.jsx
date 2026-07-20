// Cargo Accounts — Budget Overview tab. The insight-first read of a budget: a
// pace/forecast burn-down, plain-language callouts, category-risk bars and a
// seasonal heatmap — all derived from the same vs-actual + monthly data the grid
// uses (via computeOverview), re-framed so the page opens on "are we OK, and
// where's the risk" instead of a spreadsheet. Editorial system throughout.
import React, { useMemo, useEffect, useState } from 'react';
import { computeOverview } from '../../../../services/budgetOverview';
import { formatMoney } from '../../../../services/financeCalc';

// Compact money for chart axes / tags — "€3.16M", "€210k", "€450".
const symbolOf = (cur) => {
  try { return (0).toLocaleString('en-GB', { style: 'currency', currency: cur }).replace(/[\d.,\s]/g, ''); }
  catch { return `${cur} `; }
};
const compact = (n, cur) => {
  const s = symbolOf(cur); const a = Math.abs(n); const sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${s}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}${s}${Math.round(a / 1e3)}k`;
  return `${sign}${s}${Math.round(a)}`;
};
const niceMax = (v) => {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const u = v / pow;
  const step = u <= 1 ? 1 : u <= 2 ? 2 : u <= 2.5 ? 2.5 : u <= 5 ? 5 : 10;
  return step * pow;
};
const SEV = { crit: 's-crit', warn: 's-warn', good: 's-good', info: 's-info' };

// ── Pace & forecast burn-down (SVG) ─────────────────────────────────────────
const BurnChart = ({ o, cur }) => {
  const months = o.months;
  const n = months.length;
  const W = 760; const H = 280; const mL = 46; const mR = 96; const mT = 16; const mB = 26;
  const rawMax = Math.max(o.annualBudget, o.projectedTotal, o.plannedCum[n - 1] || 0, o.actualCum[o.actualCum.length - 1] || 0, 1);
  const yMax = niceMax(rawMax * 1.08);
  const x = (i) => (n > 1 ? mL + (i / (n - 1)) * (W - mL - mR) : mL + (W - mL - mR) / 2);
  const y = (v) => mT + (1 - v / yMax) * (H - mT - mB);
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');

  const plannedPts = o.plannedCum.map((v, i) => [i, v]);
  const usedPts = o.actualCum.map((v, i) => [i, v]);
  const fcPts = o.forecast.map((f) => [months.findIndex((m) => m.ym === f.ym), f.value]);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const todayI = o.elapsed > 0 ? o.elapsed - 1 : 0;
  const usedEnd = usedPts[usedPts.length - 1];
  const fcEnd = fcPts[fcPts.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label="Cumulative spend versus planned budget with a run-rate forecast to period end" className="bg-ovchart">
      <defs>
        <linearGradient id="bg-ovg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#C65A1A" stopOpacity="0.18" /><stop offset="1" stopColor="#C65A1A" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((v) => (
        <g key={v}>
          <line x1={mL} y1={y(v)} x2={W - mR} y2={y(v)} stroke="#EEF0F4" />
          <text x={mL - 8} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#AEB4C2">{compact(v, cur)}</text>
        </g>
      ))}
      {/* budget ceiling */}
      <line x1={mL} y1={y(o.annualBudget)} x2={W - mR} y2={y(o.annualBudget)} stroke="#AEB4C2" strokeWidth="1" strokeDasharray="2 4" />
      <text x={W - 4} y={y(o.annualBudget) + 12} textAnchor="end" fontSize="9.5" fill="#8B8478">Budget {compact(o.annualBudget, cur)}</text>
      {/* today marker */}
      {o.elapsed > 0 && o.elapsed < n && (
        <>
          <line x1={x(todayI)} y1={mT} x2={x(todayI)} y2={H - mB} stroke="#1C1B3A" strokeWidth="1" strokeDasharray="2 3" opacity="0.32" />
          <text x={x(todayI)} y={mT - 4} textAnchor="middle" fontSize="9" fill="#8B8478">Today</text>
        </>
      )}
      {/* planned */}
      <path d={line(plannedPts)} fill="none" stroke="#1C1B3A" strokeWidth="1.5" opacity="0.5" />
      {/* used area + line */}
      {usedPts.length > 0 && (
        <>
          <path d={`${line(usedPts)} L ${x(todayI).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`} fill="url(#bg-ovg)" />
          <path d={line(usedPts)} fill="none" stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(usedPts.length - 1)} cy={y(usedEnd[1])} r="4.5" fill="#C65A1A" />
        </>
      )}
      {/* forecast (dotted) */}
      {fcPts.length > 1 && (
        <>
          <path d={line(fcPts)} fill="none" stroke="#C65A1A" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" opacity="0.65" />
          <circle cx={x(fcEnd[0])} cy={y(fcEnd[1])} r="4.5" fill="#fff" stroke="#C65A1A" strokeWidth="2" />
          <text x={x(fcEnd[0])} y={y(fcEnd[1]) - 9} textAnchor="end" fontSize="10" fontWeight="700" fill="#B14E16">~{compact(fcEnd[1], cur)}</text>
        </>
      )}
      {months.map((m, i) => ((n <= 12 || i % 2 === 0) ? (
        <text key={m.ym} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#AEB4C2">{m.label}</text>
      ) : null))}
    </svg>
  );
};

export default function BudgetOverview({ view, monthly, cur, todayYm }) {
  const o = useMemo(() => computeOverview(view, monthly, todayYm, (n) => compact(n, cur)), [view, monthly, todayYm, cur]);
  const [lit, setLit] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setLit(true)); return () => cancelAnimationFrame(t); }, []);

  const cats = o.categories.filter((c) => c.budget > 0 || c.used > 0);
  const heat = o.heat.filter((h) => h.peak > 0);
  const nothing = o.annualBudget <= 0 && o.spent <= 0 && o.onOrder <= 0;

  if (nothing) {
    return (
      <div className="bg-empty" style={{ marginTop: 20 }}>
        <p>Nothing to chart yet</p>
        <p className="bg-empty-sub">Set budget targets and let spend flow in — the pace, forecast and risk read appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="bg-ov">
      <div className="bg-ov-grid2">
        <div className="bg-panel">
          <div className="bg-phead">
            <span className="bg-ptitle">Pace &amp; forecast</span>
            <span className="bg-pnote">cumulative, {cur}</span>
          </div>
          <div className="bg-ov-pace">
            <span className="bg-ov-pacebig">{compact(o.used, cur)}</span>
            <span className="bg-ov-pacemut">used of {compact(o.annualBudget, cur)} planned</span>
            {o.projectedOver > o.annualBudget * 0.01
              ? <span className="bg-ov-paceover">· tracking ~{compact(o.projectedOver, cur)} over by period-end</span>
              : (o.annualBudget > 0 && <span className="bg-ov-paceok">· on track to finish within budget</span>)}
          </div>
          <BurnChart o={o} cur={cur} />
          <div className="bg-ov-legend">
            <span><span className="bg-ov-sw" style={{ background: '#1C1B3A', opacity: 0.55 }} />Planned</span>
            <span><span className="bg-ov-sw" style={{ background: '#C65A1A' }} />Spent + on order</span>
            <span><span className="bg-ov-sw bg-ov-sw-dash" />Forecast</span>
            <span><span className="bg-ov-sw" style={{ background: 'transparent', boxShadow: 'inset 0 0 0 1.5px #AEB4C2' }} />Budget ceiling</span>
          </div>
        </div>

        <div className="bg-panel">
          <div className="bg-phead"><span className="bg-ptitle">Where it needs eyes</span></div>
          <div className="bg-ov-insights">
            {o.insights.length === 0 && <div className="bg-ov-ins"><span className="bg-ov-sdot s-good" /><p>Nothing flagged — spend is tracking to plan.</p></div>}
            {o.insights.map((ins, i) => (
              <div key={i} className="bg-ov-ins"><span className={`bg-ov-sdot ${SEV[ins.sev] || 's-info'}`} /><p>{ins.text}</p></div>
            ))}
          </div>
        </div>
      </div>

      {cats.length > 0 && (
        <div className="bg-panel bg-ov-mt">
          <div className="bg-phead">
            <span className="bg-ptitle">By category — sorted by risk</span>
            <span className="bg-pnote">bar = spent + on order vs the budget mark</span>
          </div>
          <div className="bg-ov-cat">
            {cats.map((c) => {
              const sp = Math.min(100, (c.spent / c.scaleBase) * 100);
              const oo = Math.min(100 - sp, (c.onOrder / c.scaleBase) * 100);
              const bm = Math.min(100, (c.budget / c.scaleBase) * 100);
              return (
                <div key={c.name} className={`bg-ov-crow${c.over ? ' is-over' : ''}`}>
                  <div className="bg-ov-cname"><b title={c.name}>{c.name}</b></div>
                  <div className="bg-ov-track">
                    <span className="bg-ov-fill-sp" style={{ width: `${lit ? sp : 0}%` }} />
                    <span className="bg-ov-fill-oo" style={{ left: `${sp}%`, width: `${lit ? oo : 0}%` }} />
                    {c.budget > 0 && <span className="bg-ov-cbudget" style={{ left: `${bm}%` }} />}
                  </div>
                  <div className="bg-ov-cpct">
                    {c.pct == null ? '—' : `${Math.round(c.pct * 100)}%`}
                    <small>{compact(c.used, cur)} / {c.budget > 0 ? compact(c.budget, cur) : 'no budget'}</small>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-ov-legend">
            <span><span className="bg-ov-sw" style={{ background: '#1C1B3A' }} />Spent</span>
            <span><span className="bg-ov-sw bg-ov-sw-oo" />On order</span>
            <span><span className="bg-ov-sw" style={{ background: '#C65A1A' }} />Over budget</span>
            <span><span className="bg-ov-sw bg-ov-sw-mark" />Budget</span>
          </div>
        </div>
      )}

      {heat.length > 0 && (() => {
        const money = (n) => compact(n, cur);          // vessel currency, e.g. "€182k", "€740"
        const varScale = Math.max(1, ...heat.flatMap((h) => h.cells).filter((c) => c.value > 0 && c.plan > 0).map((c) => Math.abs(c.variance)));
        // Gentle tints, one fixed dark text colour per state — no white/dark flip.
        const varColor = (variance, t) => (variance > 0
          ? { bg: `rgba(198,90,26,${(0.12 + t * 0.28).toFixed(2)})`, fg: '#8A3A12' }
          : { bg: `rgba(63,122,82,${(0.10 + t * 0.26).toFixed(2)})`, fg: '#2F5C3E' });
        return (
        <div className="bg-panel bg-ov-mt">
          <div className="bg-phead">
            <span className="bg-ptitle">Seasonal shape</span>
            <span className="bg-ov-guide" tabIndex={0} aria-label="Legend">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.4v3.2" strokeLinecap="round" /><circle cx="8" cy="5.1" r="0.6" fill="currentColor" stroke="none" /></svg>
              <span className="bg-ov-guidepop" role="tooltip">
                <span className="g-row"><i className="g-sw" style={{ background: '#C65A1A' }} />Over plan</span>
                <span className="g-row"><i className="g-sw" style={{ background: '#3F7A52' }} />Under plan</span>
                <span className="g-row"><i className="g-sw" style={{ background: '#EAF1EC' }} />On plan (✓)</span>
                <span className="g-hint">Each cell shows the month’s spend — hover to flip it to the +/− vs plan.</span>
              </span>
            </span>
          </div>
          <div className="bg-ov-hm">
            <table className="bg-ov-heat">
              <thead>
                <tr><th className="rowh" />{o.months.map((m) => <th key={m.ym}>{m.label}</th>)}</tr>
              </thead>
              <tbody>
                {heat.map((r) => (
                  <tr key={r.name}>
                    <td className="rowh">{r.name}</td>
                    {r.cells.map((c) => {
                      if (!c.value) return <td key={c.ym}><div className="bg-ov-cell zero" title={`${r.name} · ${c.label}: no spend yet`}>·</div></td>;
                      const both = c.plan > 0;
                      // The whole cell is coloured by variance — over (terracotta), under
                      // (green), on plan (pale green). Both faces share it; the flip only
                      // swaps the number (spend → +/− vs plan). On plan = within 3% of the
                      // month's plan, so tiny sub-thousand variances don't read as noise.
                      const t = both ? Math.min(1, Math.abs(c.variance) / varScale) : 0;
                      const near = both && Math.abs(c.variance) < Math.max(c.plan * 0.03, 1);
                      const cell = !both ? { bg: '#F1F2F5', fg: '#8B8478' } : near ? { bg: '#EAF1EC', fg: '#3F7A52' } : varColor(c.variance, t);
                      const sign = c.variance > 0 ? '+' : '−';
                      const backLabel = !both ? '—' : near ? '✓' : `${sign}${money(Math.abs(c.variance))}`;
                      return (
                        <td key={c.ym}>
                          <div className="bg-ov-flip" tabIndex={0}
                            title={`${r.name} · ${c.label}: ${formatMoney(c.value, cur)}${both ? ` vs plan ${formatMoney(c.plan, cur)} (${sign}${formatMoney(Math.abs(c.variance), cur)})` : ' · no plan set'}`}>
                            <div className="bg-ov-flip-in">
                              <div className="bg-ov-face bg-ov-front" style={{ background: cell.bg, color: cell.fg }}>{money(c.value)}</div>
                              <div className="bg-ov-face bg-ov-back" style={{ background: cell.bg, color: cell.fg }}>{backLabel}</div>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
