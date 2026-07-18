// Cargo Accounts — guided "Start a budget" flow. Replaces the bare name+dates modal
// for NEW budgets: pick a period preset, the MYBA chart, and how to seed the figures
// — and the actual budget builds itself on the right, populated and season-shaped from
// last year's ledger. Per-line % editors let individual lines diverge from the baseline
// uplift, each with a reason that persists as the line's note for the owner review.
import React, { useState, useEffect, useMemo } from 'react';
import ModalShell from '../../../../components/ui/ModalShell';
import EditorialDatePicker from '../../../../components/editorial/EditorialDatePicker';
import { datePlaceholder } from '../../../../utils/dateFormat';
import { STANDARD_CHART_OF_ACCOUNTS, STANDARD_BUCKET_ORDER } from '../data/mybaChartOfAccounts';
import { monthsInPeriod } from '../../../../services/budgetMonthly';
import { computeSeed, normCat } from '../../../../services/budgetSeed';
import { computeSuggestions } from '../../../../services/budgetSuggest';
import { getSeedSourceForPeriod, createBudgetGuided, getYoyDrift } from '../../../../services/budgetService';
import './guided-create.css';

const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const yy = (y) => String(y).slice(2);

const buildPresets = (y) => [
  { key: 'season-next', label: `${y + 1} Season`, name: `${y + 1} Season`, start: iso(y + 1, 1, 1), end: iso(y + 1, 12, 31), hint: 'Jan–Dec next year' },
  { key: 'year-this', label: `${y} Calendar year`, name: `${y} Budget`, start: iso(y, 1, 1), end: iso(y, 12, 31), hint: 'Jan–Dec this year' },
  { key: 'winter', label: `Winter ${yy(y)}/${yy(y + 1)}`, name: `Winter ${yy(y)}/${yy(y + 1)}`, start: iso(y, 11, 1), end: iso(y + 1, 3, 31), hint: 'Nov–Mar yard season' },
  { key: 'custom', label: 'Custom…', name: 'New budget', start: '', end: '', hint: 'pick your own dates' },
];

const fmtDMY = (isoDate) => {
  if (!isoDate) return 'dd/mm/yyyy';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

export default function GuidedBudgetCreate({ open, onClose, onCreated, tenantId }) {
  const presets = useMemo(() => buildPresets(new Date().getFullYear()), []);
  const [periodKey, setPeriodKey] = useState('season-next');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [currency, setCurrency] = useState('EUR');
  const [chart, setChart] = useState('myba');       // 'myba' | 'blank'
  const [seedMode, setSeedMode] = useState('actuals'); // 'actuals' | 'target' | 'zero'
  const [baseline, setBaseline] = useState(5);
  const [target, setTarget] = useState(0);
  const [perLine, setPerLine] = useState({});        // { normCat: { uplift, reason } }
  const [seedSrc, setSeedSrc] = useState(null);
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const preset = presets.find((p) => p.key === periodKey) || presets[0];
  const start = periodKey === 'custom' ? customStart : preset.start;
  const end = periodKey === 'custom' ? customEnd : preset.end;
  const effName = nameEdited ? name : preset.name;

  const sym = ({ EUR: '€', GBP: '£', USD: '$' })[currency] || '';
  const compact = (n) => {
    const a = Math.abs(n); const s = n < 0 ? '−' : '';
    if (a >= 1e6) return `${s}${sym}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}${sym}${Math.round(a / 1e3)}k`;
    return `${s}${sym}${Math.round(a)}`;
  };

  // Reset when opened.
  useEffect(() => {
    if (!open) return;
    setPeriodKey('season-next'); setCustomStart(''); setCustomEnd('');
    setName(''); setNameEdited(false); setCurrency('EUR'); setChart('myba');
    setSeedMode('actuals'); setBaseline(5); setTarget(0); setPerLine({});
    setSeedSrc(null); setBusy(false); setErr(''); setSuggestNote(''); setSuggesting(false);
  }, [open]);

  // Pull last-season spend to seed from whenever the period changes.
  useEffect(() => {
    if (!open || !tenantId || !start || !end) { setSeedSrc(null); return undefined; }
    let alive = true;
    setLoadingSrc(true);
    getSeedSourceForPeriod(tenantId, STANDARD_CHART_OF_ACCOUNTS, start, end).then(({ data }) => {
      if (!alive) return;
      setSeedSrc(data || { rows: [], total: 0, hasData: false });
      setLoadingSrc(false);
    });
    return () => { alive = false; };
  }, [open, tenantId, start, end]);

  const months = useMemo(() => monthsInPeriod(start, end), [start, end]);
  const canSeed = Boolean(seedSrc?.hasData) && chart === 'myba';
  const effMode = canSeed ? seedMode : 'zero';

  const seed = useMemo(() => {
    if (chart === 'blank') return { lines: [], seededTotal: 0, seededCount: 0, priorTotal: 0 };
    const rows = effMode === 'zero' ? [] : (seedSrc?.rows || []);
    const opts = effMode === 'target' ? { target } : { uplift: baseline, perLine };
    return computeSeed(STANDARD_CHART_OF_ACCOUNTS, rows, months, opts);
  }, [chart, effMode, seedSrc, months, baseline, target, perLine]);

  const grouped = useMemo(() => {
    const byB = new Map();
    seed.lines.forEach((l) => { if (!byB.has(l.bucket)) byB.set(l.bucket, []); byB.get(l.bucket).push(l); });
    return STANDARD_BUCKET_ORDER.filter((b) => byB.has(b)).map((b) => ({ bucket: b, lines: byB.get(b) }));
  }, [seed]);

  const expenseCount = seed.lines.filter((l) => l.kind !== 'revenue').length;
  const setLine = (key, patch) => setPerLine((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  // Grounded per-line suggestions: this vessel's own YoY trend where two seasons exist,
  // curated category sensitivity otherwise. Fills the % and the reason for every line.
  const runSuggest = async () => {
    setSuggesting(true); setSuggestNote('');
    const { data, error } = await getYoyDrift(tenantId, STANDARD_CHART_OF_ACCOUNTS, start, end);
    if (error) { setSuggesting(false); setSuggestNote('Could not read history — try again.'); return; }
    const sugg = computeSuggestions(STANDARD_CHART_OF_ACCOUNTS, data?.byCat || {}, { recentYear: data?.recentYear, prevYear: data?.prevYear });
    setPerLine(sugg);
    const fromHistory = Object.values(sugg).filter((s) => s.basis === 'history').length;
    setSuggestNote(data?.hasTwoSeasons && fromHistory
      ? `${fromHistory} lines from your ${data.prevYear}→${data.recentYear} trend, the rest from category norms — review each below.`
      : 'Not enough history yet — suggested from category norms. Review each below.');
    setSuggesting(false);
  };

  if (!open) return null;

  const submit = async () => {
    if (!start || !end) { setErr('Pick a period first.'); return; }
    if (end < start) { setErr('The end date must be on or after the start date.'); return; }
    setBusy(true); setErr('');
    const lines = chart === 'blank' ? [] : seed.lines;
    const res = await createBudgetGuided({
      tenant_id: tenantId, name: (effName || 'New budget').trim(),
      period_start: start, period_end: end, currency, lines,
    });
    setBusy(false);
    if (res.error) { setErr(res.error.message || 'Could not create the budget.'); return; }
    onCreated?.(res.data);
  };

  const seedNote = chart === 'blank'
    ? 'Blank budget — no lines, you build it yourself.'
    : effMode === 'actuals' ? `Seeded from ${compact(seed.priorTotal)} spent last season, ${baseline >= 0 ? '+' : ''}${baseline}% baseline.`
      : effMode === 'target' ? `Your ${compact(target)} target, apportioned by last season's mix.`
        : canSeed ? 'Lines ready, figures blank — you fill them in.'
          : 'No prior season to seed from yet — starting the lines at zero.';

  return (
    <ModalShell onClose={onClose} panelClassName="bg-gc" isBusy={busy}
      panelStyle={{ width: 'min(1120px, 96vw)' }}>
      <div className="bg-gc-head">
        <div>
          <p className="bg-gc-eyebrow">Cargo · Budget · New</p>
          <h2 className="bg-gc-title">Start a <em>budget</em></h2>
        </div>
        <button type="button" className="bg-gc-x" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </div>
      <p className="bg-gc-sub">You spent a whole season — so Cargo proposes the budget instead of handing you an empty grid. Everything stays editable after.</p>

      <div className="bg-gc-cols">
        {/* ── Choices ─────────────────────────────────────────────── */}
        <div className="bg-gc-left">
          <div className="bg-gc-sec">
            <div className="bg-gc-lab">Period <span className="req">required</span></div>
            <div className="bg-gc-chips">
              {presets.map((p) => (
                <button key={p.key} type="button" className={`bg-gc-chip${periodKey === p.key ? ' on' : ''}`} onClick={() => setPeriodKey(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            {periodKey === 'custom' ? (
              <div className="bg-gc-daterow">
                <EditorialDatePicker value={customStart} onChange={setCustomStart} ariaLabel="Period start" placeholder={datePlaceholder()} />
                <span className="bg-gc-arw">→</span>
                <EditorialDatePicker value={customEnd} onChange={setCustomEnd} ariaLabel="Period end" rangeStart={customStart} placeholder={datePlaceholder()} />
              </div>
            ) : (
              <div className="bg-gc-daterow bg-gc-dateread">
                <span className="bg-gc-datebox">{fmtDMY(start)}</span>
                <span className="bg-gc-arw">→</span>
                <span className="bg-gc-datebox">{fmtDMY(end)}</span>
                <span className="bg-gc-hint">{preset.hint}</span>
              </div>
            )}
            <input className="bg-gc-field" value={effName} onChange={(e) => { setName(e.target.value); setNameEdited(true); }} aria-label="Budget name" style={{ marginTop: 12 }} />
          </div>

          <div className="bg-gc-sec">
            <div className="bg-gc-lab">Chart of accounts <span className="req">required</span></div>
            <div className="bg-gc-opts">
              <button type="button" className={`bg-gc-opt${chart === 'myba' ? ' on' : ''}`} onClick={() => setChart('myba')}>
                <span className="bg-gc-radio" />
                <span><span className="bg-gc-ot">Standard MYBA chart <span className="bg-gc-rec">Recommended</span></span>
                  <span className="bg-gc-od">The {STANDARD_CHART_OF_ACCOUNTS.length} industry-coded lines, grouped and ready — no typing categories.</span></span>
              </button>
              <button type="button" className={`bg-gc-opt${chart === 'blank' ? ' on' : ''}`} onClick={() => setChart('blank')}>
                <span className="bg-gc-radio" />
                <span><span className="bg-gc-ot">Blank</span>
                  <span className="bg-gc-od">Start with nothing and add your own lines by hand.</span></span>
              </button>
            </div>
          </div>

          {chart === 'myba' && (
            <div className="bg-gc-sec">
              <div className="bg-gc-lab">Starting figures <span className="opt">the clever bit</span></div>
              <div className="bg-gc-opts">
                <button type="button" className={`bg-gc-opt${seedMode === 'actuals' && canSeed ? ' on' : ''}${!canSeed ? ' is-disabled' : ''}`}
                  onClick={() => canSeed && setSeedMode('actuals')} disabled={!canSeed}>
                  <span className="bg-gc-radio" />
                  <span><span className="bg-gc-ot">Seed from last season {canSeed && <span className="bg-gc-rec">Recommended</span>}</span>
                    <span className="bg-gc-od">{canSeed ? 'Every line pre-filled from what was really spent, seasonal shape carried across. Tune it per line on the right.' : 'No prior season in the ledger yet — available once you’ve run one.'}</span></span>
                </button>
                {effMode === 'actuals' && canSeed && (
                  <>
                    <div className="bg-gc-reveal">
                      <div className="bg-gc-step">
                        <button type="button" onClick={() => setBaseline((v) => Math.max(-25, v - 1))} aria-label="Less uplift">−</button>
                        <span className="bg-gc-stepval">{baseline >= 0 ? '+' : ''}{baseline}%</span>
                        <button type="button" onClick={() => setBaseline((v) => Math.min(50, v + 1))} aria-label="More uplift">+</button>
                      </div>
                      <span className="bg-gc-steplab">baseline uplift · override any line on the right</span>
                    </div>
                    <div className="bg-gc-suggestrow">
                      <button type="button" className="bg-gc-suggest" onClick={runSuggest} disabled={suggesting}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.3 3.3L12.6 5l-2.6 2 1 3.4L8 8.7 5 10.4l1-3.4L3.4 5l3.3-.7L8 1z" /></svg>
                        {suggesting ? 'Reading your history…' : 'Suggest per-line %'}
                      </button>
                      {Object.keys(perLine).length > 0 && (
                        <button type="button" className="bg-gc-reset" onClick={() => { setPerLine({}); setSuggestNote(''); }}>Reset to baseline</button>
                      )}
                    </div>
                    {suggestNote && <p className="bg-gc-suggestnote">{suggestNote}</p>}
                  </>
                )}
                <button type="button" className={`bg-gc-opt${seedMode === 'target' && canSeed ? ' on' : ''}${!canSeed ? ' is-disabled' : ''}`}
                  onClick={() => canSeed && setSeedMode('target')} disabled={!canSeed}>
                  <span className="bg-gc-radio" />
                  <span><span className="bg-gc-ot">Work back from a target</span>
                    <span className="bg-gc-od">Give one season number; Cargo apportions it across the lines by last year’s mix.</span></span>
                </button>
                {effMode === 'target' && canSeed && (
                  <div className="bg-gc-reveal">
                    <span className="bg-gc-fieldwrap"><span className="bg-gc-cur">{sym}</span>
                      <input className="bg-gc-money" inputMode="numeric" value={target ? target.toLocaleString('en-GB') : ''} placeholder="0"
                        onChange={(e) => setTarget(parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0)} aria-label="Season target" /></span>
                    <span className="bg-gc-steplab">total season budget</span>
                  </div>
                )}
                <button type="button" className={`bg-gc-opt${seedMode === 'zero' || !canSeed ? ' on' : ''}`}
                  onClick={() => setSeedMode('zero')}>
                  <span className="bg-gc-radio" />
                  <span><span className="bg-gc-ot">Start at zero</span>
                    <span className="bg-gc-od">Blank figures — enter every number yourself.</span></span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-gc-sec">
            <div className="bg-gc-lab">Currency</div>
            <div className="bg-gc-seg">
              {['EUR', 'GBP', 'USD'].map((c) => (
                <button key={c} type="button" className={currency === c ? 'on' : ''} onClick={() => setCurrency(c)}>{c}</button>
              ))}
            </div>
          </div>

          {err && <div className="bg-gc-err">{err}</div>}

          <div className="bg-gc-foot">
            <span className="bg-gc-note">Nothing is locked — edit any line, month or target after it’s created.</span>
            <button type="button" className="bg-gc-btn" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create budget →'}</button>
          </div>
        </div>

        {/* ── Live preview ────────────────────────────────────────── */}
        <div className="bg-gc-right">
          <div className="bg-gc-phead">
            <span className="bg-gc-ptitle">You’re about to create</span>
            <span className="bg-gc-pnote">{fmtDMY(start)} – {fmtDMY(end)} · {currency}</span>
          </div>
          <div className="bg-gc-count">
            <div className="bg-gc-pc"><b>{chart === 'blank' ? 0 : expenseCount}</b><span>lines</span></div>
            <div className="bg-gc-pc"><b>{chart === 'blank' || effMode === 'zero' ? compact(0) : compact(seed.seededTotal)}</b><span>seeded total</span></div>
            <div className="bg-gc-pc"><b>{chart === 'blank' ? '—' : effMode === 'zero' ? 'blank' : 'seasonal'}</b><span>month shape</span></div>
          </div>

          {loadingSrc && chart === 'myba' && <div className="bg-gc-loading">Reading last season’s ledger…</div>}

          {chart === 'blank' ? (
            <div className="bg-gc-zeronote"><b>Blank budget.</b> You’ll add every line and figure by hand after it’s created. Pick <b>Standard MYBA chart</b> to skip that.</div>
          ) : (
            <div className="bg-gc-plist">
              {grouped.map((g) => (
                <div key={g.bucket}>
                  <div className="bg-gc-eyebrow2">{g.bucket}</div>
                  {g.lines.map((l) => {
                    const key = normCat(l.category);
                    const isRev = l.kind === 'revenue';
                    const editable = effMode === 'actuals' && !isRev;
                    const pl = perLine[key] || {};
                    return (
                      <div key={l.code || l.category} className={`bg-gc-prow${l.adjusted ? ' is-adj' : ''}`}>
                        <div className="bg-gc-pn">
                          {l.code && <span className="bg-gc-code">{l.code}</span>}
                          <b title={l.category}>{l.category}</b>
                        </div>
                        {editable ? (
                          <span className="bg-gc-pctwrap">
                            <input className="bg-gc-pct" inputMode="numeric" placeholder={`${baseline >= 0 ? '+' : ''}${baseline}`}
                              value={pl.uplift ?? ''} aria-label={`${l.category} uplift %`}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d.-]/g, '');
                                setLine(key, { uplift: raw === '' ? undefined : Number(raw) });
                              }} />
                            <span className="bg-gc-pctsign">%</span>
                          </span>
                        ) : <span className="bg-gc-pctwrap" />}
                        <div className="bg-gc-pfig">
                          {isRev ? <span className="bg-gc-muted">set later</span>
                            : effMode === 'zero' ? <span className="bg-gc-muted">—</span>
                              : <>{compact(l.amount)}<small>{l.priorAmount ? `${compact(l.priorAmount)} last yr` : 'new line'}</small></>}
                        </div>
                        {editable && (l.adjusted || pl.reason != null) && (
                          <input className="bg-gc-reason" placeholder="Why the change? (shown to owners)" value={pl.reason || ''}
                            onChange={(e) => setLine(key, { reason: e.target.value })} aria-label={`${l.category} reason`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="bg-gc-ptot">
                <span className="l">Total expenditure budget</span>
                <span className="v">{effMode === 'zero' ? compact(0) : compact(seed.seededTotal)}<small>{seedNote}</small></span>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
