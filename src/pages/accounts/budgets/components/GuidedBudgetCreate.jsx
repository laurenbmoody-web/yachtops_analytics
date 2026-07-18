// Cargo Accounts — guided "Start a budget" flow. Replaces the bare name+dates modal
// for NEW budgets: name it, set the period, pick where the lines come from (standard
// MYBA chart, blank, or a spreadsheet you upload) and how to seed the figures — and the
// actual budget builds itself on the right, populated and season-shaped from last year's
// ledger. Per-line % editors let lines diverge from the baseline uplift, each with a
// reason that persists as the line's note for the owner review.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import ModalShell from '../../../../components/ui/ModalShell';
import EditorialDatePicker from '../../../../components/editorial/EditorialDatePicker';
import { datePlaceholder } from '../../../../utils/dateFormat';
import { STANDARD_CHART_OF_ACCOUNTS, STANDARD_BUCKET_ORDER } from '../data/mybaChartOfAccounts';
import { monthsInPeriod } from '../../../../services/budgetMonthly';
import { computeSeed, normCat } from '../../../../services/budgetSeed';
import { computeSuggestions } from '../../../../services/budgetSuggest';
import { parseSheetRows, matchToChart } from '../../../../services/budgetImport';
import { getSeedSourceForPeriod, createBudgetGuided, getYoyDrift } from '../../../../services/budgetService';
import './guided-create.css';

const pad2 = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const fmtDMY = (isoDate) => {
  if (!isoDate) return 'dd/mm/yyyy';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

export default function GuidedBudgetCreate({ open, onClose, onCreated, tenantId }) {
  const nextYear = useMemo(() => new Date().getFullYear() + 1, []);
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [chart, setChart] = useState('myba');          // 'myba' | 'blank' | 'upload'
  const [seedMode, setSeedMode] = useState('actuals');  // 'actuals' | 'target' | 'zero'
  const [baseline, setBaseline] = useState(5);
  const [target, setTarget] = useState(0);
  const [perLine, setPerLine] = useState({});
  const [seedSrc, setSeedSrc] = useState(null);
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState('');
  const [uploaded, setUploaded] = useState(null);       // { fileName, lines, matched, unmatched, matchedTotal }
  const [uploadErr, setUploadErr] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const sym = ({ EUR: '€', GBP: '£', USD: '$' })[currency] || '';
  const compact = (n) => {
    const a = Math.abs(n); const s = n < 0 ? '−' : '';
    if (a >= 1e6) return `${s}${sym}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${s}${sym}${Math.round(a / 1e3)}k`;
    return `${s}${sym}${Math.round(a)}`;
  };

  // Reset when opened — default to next calendar year, editable.
  useEffect(() => {
    if (!open) return;
    setName(`${nextYear} Budget`); setStart(iso(nextYear, 1, 1)); setEnd(iso(nextYear, 12, 31));
    setCurrency('EUR'); setChart('myba'); setSeedMode('actuals'); setBaseline(5); setTarget(0);
    setPerLine({}); setSeedSrc(null); setSuggestNote(''); setSuggesting(false);
    setUploaded(null); setUploadErr(''); setBusy(false); setErr('');
  }, [open, nextYear]);

  // Pull last-season spend to seed from whenever the period changes (MYBA mode only).
  useEffect(() => {
    if (!open || !tenantId || chart !== 'myba' || !start || !end) { setSeedSrc(null); return undefined; }
    let alive = true;
    setLoadingSrc(true);
    getSeedSourceForPeriod(tenantId, STANDARD_CHART_OF_ACCOUNTS, start, end).then(({ data }) => {
      if (!alive) return;
      setSeedSrc(data || { rows: [], total: 0, hasData: false });
      setLoadingSrc(false);
    });
    return () => { alive = false; };
  }, [open, tenantId, chart, start, end]);

  const months = useMemo(() => monthsInPeriod(start, end), [start, end]);
  const canSeed = Boolean(seedSrc?.hasData) && chart === 'myba';
  const effMode = canSeed ? seedMode : 'zero';

  const seed = useMemo(() => {
    if (chart !== 'myba') return { lines: [], seededTotal: 0, seededCount: 0, priorTotal: 0 };
    const rows = effMode === 'zero' ? [] : (seedSrc?.rows || []);
    const opts = effMode === 'target' ? { target } : { uplift: baseline, perLine };
    return computeSeed(STANDARD_CHART_OF_ACCOUNTS, rows, months, opts);
  }, [chart, effMode, seedSrc, months, baseline, target, perLine]);

  // The lines that will actually be created, and what the preview renders.
  const previewLines = chart === 'blank' ? [] : chart === 'upload' ? (uploaded?.lines || []) : seed.lines;
  const grouped = useMemo(() => {
    const byB = new Map();
    previewLines.forEach((l) => { if (!byB.has(l.bucket)) byB.set(l.bucket, []); byB.get(l.bucket).push(l); });
    return STANDARD_BUCKET_ORDER.filter((b) => byB.has(b)).map((b) => ({ bucket: b, lines: byB.get(b) }));
  }, [previewLines]);

  const expenseCount = previewLines.filter((l) => l.kind !== 'revenue').length;
  const totalFig = chart === 'blank' ? 0 : chart === 'upload' ? (uploaded?.matchedTotal || 0) : (effMode === 'zero' ? 0 : seed.seededTotal);
  const setLine = (key, patch) => setPerLine((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

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

  const handleFile = async (file) => {
    if (!file) return;
    setUploadErr(''); setUploaded(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      const { rows, detected } = parseSheetRows(aoa);
      if (!detected || !rows.length) {
        setUploadErr('Couldn’t find a line-item column and an amount column. Check the sheet has both.');
        return;
      }
      const res = matchToChart(rows, STANDARD_CHART_OF_ACCOUNTS);
      setUploaded({ fileName: file.name, ...res });
    } catch {
      setUploadErr('Couldn’t read that file. Use .xlsx, .xls or .csv.');
    }
  };

  if (!open) return null;

  const submit = async () => {
    if (!name.trim()) { setErr('Give the budget a name.'); return; }
    if (!start || !end) { setErr('Set a start and end date.'); return; }
    if (end < start) { setErr('The end date must be on or after the start date.'); return; }
    if (chart === 'upload' && !uploaded) { setErr('Upload a spreadsheet, or choose Standard or Blank.'); return; }
    setBusy(true); setErr('');
    const lines = chart === 'blank' ? [] : previewLines;
    const res = await createBudgetGuided({
      tenant_id: tenantId, name: name.trim(), period_start: start, period_end: end, currency, lines,
    });
    setBusy(false);
    if (res.error) { setErr(res.error.message || 'Could not create the budget.'); return; }
    onCreated?.(res.data);
  };

  const shapeLabel = chart === 'blank' ? '—' : chart === 'upload' ? (uploaded ? 'annual' : '—') : effMode === 'zero' ? 'blank' : 'seasonal';
  const seedNote = chart === 'blank'
    ? 'Blank budget — no lines, you build it yourself.'
    : chart === 'upload'
      ? (uploaded ? `${uploaded.matched} of ${uploaded.matched + uploaded.unmatched.length} rows matched onto the chart.` : 'Upload a past budget or template to map it onto the chart.')
      : effMode === 'actuals' ? `Seeded from ${compact(seed.priorTotal)} spent last season, ${baseline >= 0 ? '+' : ''}${baseline}% baseline.`
        : effMode === 'target' ? `Your ${compact(target)} target, apportioned by last season's mix.`
          : canSeed ? 'Lines ready, figures blank — you fill them in.'
            : 'No prior season to seed from yet — starting the lines at zero.';

  return (
    <ModalShell onClose={onClose} panelClassName="bg-gc" isBusy={busy}
      panelStyle={{ width: 'min(1120px, 96vw)', maxHeight: 'calc(100vh - 92px)' }}>
      <div className="bg-gc-head">
        <div>
          <p className="bg-gc-eyebrow">Cargo · Budget · New</p>
          <h2 className="bg-gc-title">Start a <em>budget</em></h2>
        </div>
        <button type="button" className="bg-gc-x" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </div>

      {/* Name + period band — the two things that define the budget, up front. */}
      <div className="bg-gc-band">
        <div className="bg-gc-namewrap">
          <label className="bg-gc-lab" htmlFor="bg-gc-name">Budget name</label>
          <input id="bg-gc-name" className="bg-gc-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2027 Season" autoFocus />
        </div>
        <div className="bg-gc-periodwrap">
          <label className="bg-gc-lab">Period</label>
          <div className="bg-gc-daterow">
            <EditorialDatePicker value={start} onChange={setStart} ariaLabel="Period start" placeholder={datePlaceholder()} />
            <span className="bg-gc-arw">→</span>
            <EditorialDatePicker value={end} onChange={setEnd} ariaLabel="Period end" rangeStart={start} placeholder={datePlaceholder()} />
          </div>
        </div>
      </div>

      <div className="bg-gc-cols">
        {/* ── Choices ─────────────────────────────────────────────── */}
        <div className="bg-gc-left">
          <div className="bg-gc-sec">
            <div className="bg-gc-lab">Lines come from <span className="req">required</span></div>
            <div className="bg-gc-opts">
              <button type="button" className={`bg-gc-opt${chart === 'myba' ? ' on' : ''}`} onClick={() => setChart('myba')}>
                <span className="bg-gc-radio" />
                <span><span className="bg-gc-ot">Standard MYBA chart <span className="bg-gc-rec">Recommended</span></span>
                  <span className="bg-gc-od">The {STANDARD_CHART_OF_ACCOUNTS.length} industry-coded lines, grouped and ready.</span></span>
              </button>
              <button type="button" className={`bg-gc-opt${chart === 'upload' ? ' on' : ''}`} onClick={() => setChart('upload')}>
                <span className="bg-gc-radio" />
                <span><span className="bg-gc-ot">Upload a past budget or template</span>
                  <span className="bg-gc-od">Drop in a spreadsheet — Cargo reads the lines &amp; amounts and maps them onto the chart.</span></span>
              </button>
              <button type="button" className={`bg-gc-opt${chart === 'blank' ? ' on' : ''}`} onClick={() => setChart('blank')}>
                <span className="bg-gc-radio" />
                <span><span className="bg-gc-ot">Blank</span>
                  <span className="bg-gc-od">Start with nothing and add your own lines by hand.</span></span>
              </button>
            </div>

            {chart === 'upload' && (
              <div className="bg-gc-upload">
                <div className={`bg-gc-drop${dragOver ? ' is-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
                  onClick={() => fileRef.current?.click()} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
                    onChange={(e) => handleFile(e.target.files?.[0])} />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C65A1A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                  <span className="bg-gc-dropmain">{uploaded ? uploaded.fileName : 'Drop a spreadsheet, or click to browse'}</span>
                  <span className="bg-gc-dropsub">.xlsx · .xls · .csv — a line-item column and an amount column</span>
                </div>
                {uploadErr && <div className="bg-gc-uploaderr">{uploadErr}</div>}
                {uploaded && (
                  <div className="bg-gc-uploadok">
                    <b>{uploaded.matched} matched</b> · {compact(uploaded.matchedTotal)}
                    {uploaded.unmatched.length > 0 && (
                      <span className="bg-gc-unmatched"> · {uploaded.unmatched.length} not recognised: {uploaded.unmatched.slice(0, 4).map((u) => u.name).join(', ')}{uploaded.unmatched.length > 4 ? '…' : ''}</span>
                    )}
                  </div>
                )}
              </div>
            )}
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
        </div>

        {/* ── Live preview ────────────────────────────────────────── */}
        <div className="bg-gc-right">
          <div className="bg-gc-phead">
            <span className="bg-gc-ptitle">You’re about to create</span>
            <span className="bg-gc-pnote">{fmtDMY(start)} – {fmtDMY(end)} · {currency}</span>
          </div>
          <div className="bg-gc-count">
            <div className="bg-gc-pc"><b>{expenseCount}</b><span>lines</span></div>
            <div className="bg-gc-pc"><b>{compact(totalFig)}</b><span>{chart === 'upload' ? 'matched total' : 'seeded total'}</span></div>
            <div className="bg-gc-pc"><b>{shapeLabel}</b><span>month shape</span></div>
          </div>

          {loadingSrc && chart === 'myba' && <div className="bg-gc-loading">Reading last season’s ledger…</div>}

          {chart === 'blank' ? (
            <div className="bg-gc-zeronote"><b>Blank budget.</b> You’ll add every line and figure by hand after it’s created. Pick <b>Standard MYBA chart</b> to skip that.</div>
          ) : chart === 'upload' && !uploaded ? (
            <div className="bg-gc-zeronote"><b>Nothing uploaded yet.</b> Drop a past budget or a template spreadsheet on the left — Cargo maps its lines onto the chart and previews them here.</div>
          ) : (
            <div className="bg-gc-plist">
              {grouped.map((g) => (
                <div key={g.bucket}>
                  <div className="bg-gc-eyebrow2">{g.bucket}</div>
                  {g.lines.map((l) => {
                    const key = normCat(l.category);
                    const isRev = l.kind === 'revenue';
                    const editable = chart === 'myba' && effMode === 'actuals' && !isRev;
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
                            : (chart === 'myba' && effMode === 'zero') ? <span className="bg-gc-muted">—</span>
                              : l.amount ? <>{compact(l.amount)}{chart === 'myba' && l.priorAmount ? <small>{compact(l.priorAmount)} last yr</small> : null}</>
                                : <span className="bg-gc-muted">—</span>}
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
                <span className="v">{compact(totalFig)}<small>{seedNote}</small></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky action bar — always visible, never clipped. */}
      <div className="bg-gc-actionbar">
        {err ? <span className="bg-gc-err">{err}</span> : <span className="bg-gc-note">Nothing is locked — edit any line, month or target after it’s created.</span>}
        <button type="button" className="bg-gc-btn" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create budget →'}</button>
      </div>
    </ModalShell>
  );
}
