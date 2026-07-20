// Cargo Accounts — statement import & reconciliation modal. Upload a bank/card/Voly
// export → parse (SheetJS) → auto-match to the ledger → review only the exceptions.
// Matched lines collapse to a count; you touch just the handful that don't line up.
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import { formatMoney } from '../../../services/financeCalc';
import { parseStatementRows } from '../../../services/statementParse';
import {
  createStatement, uploadStatementFile, addStatementLines, runMatch, getReconcileView, resolveLine, finishReconcile,
} from '../../../services/statementService';

const SOURCES = [['bank', 'Bank'], ['card', 'Card'], ['voly', 'Voly'], ['xero', 'Xero'], ['other', 'Other']];
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export default function StatementReconcileModal({ open, onClose, accounts, tenantId, onDone }) {
  const [step, setStep] = useState('upload');   // upload | reconcile
  const [file, setFile] = useState(null);
  const [source, setSource] = useState('bank');
  const [accountId, setAccountId] = useState('');
  const [preview, setPreview] = useState(null); // { rows, detected }
  const [statement, setStatement] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;
  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency || 'EUR';

  const reset = () => { setStep('upload'); setFile(null); setSource('bank'); setAccountId(''); setPreview(null); setStatement(null); setView(null); setBusy(false); setErr(''); };
  const close = () => { reset(); onClose(); };

  const onFile = async (f) => {
    setFile(f); setPreview(null); setErr('');
    if (!f) return;
    if (/\.pdf$/i.test(f.name)) { setErr('PDF statements aren’t supported yet — export as CSV or Excel. (AI PDF parsing is planned.)'); return; }
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      const { rows, detected } = parseStatementRows(aoa);
      if (!detected || !rows.length) { setErr('Couldn’t find date / description / amount columns. Check the export has them.'); return; }
      setPreview({ rows, detected });
    } catch { setErr('Couldn’t read that file. Use .csv, .xlsx or .xls.'); }
  };

  const startReconcile = async () => {
    if (!preview) return;
    setBusy(true); setErr('');
    const dates = preview.rows.map((r) => r.line_date).filter(Boolean);
    const period_start = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
    const period_end = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    const cRes = await createStatement({ tenant_id: tenantId, account_id: accountId || null, source, period_start, period_end, file_name: file?.name });
    if (cRes.error || !cRes.data) { setBusy(false); setErr(cRes.error?.message || 'Could not start the import.'); return; }
    const stmt = cRes.data;
    if (file) await uploadStatementFile(stmt.id, file, tenantId);
    const aRes = await addStatementLines(stmt.id, tenantId, preview.rows, currency);
    if (aRes.error) { setBusy(false); setErr(aRes.error.message || 'Could not save the lines.'); return; }
    await runMatch(stmt.id);
    const vRes = await getReconcileView(stmt.id);
    setBusy(false);
    if (vRes.error) { setErr(vRes.error.message || 'Could not build the reconcile view.'); return; }
    setStatement(stmt); setView(vRes.data); setStep('reconcile');
  };

  const refresh = async () => { const { data } = await getReconcileView(statement.id); if (data) setView(data); };

  const act = async (line, action, payload) => {
    setBusy(true);
    const { error } = await resolveLine(line, action, payload);
    setBusy(false);
    if (error) { setErr(error.message || 'Action failed.'); return; }
    await refresh();
  };

  const finish = async () => {
    setBusy(true);
    await finishReconcile(statement.id);
    setBusy(false);
    onDone?.();
    close();
  };

  const money = (a, cur) => formatMoney(a, cur || currency, { signed: true });

  return (
    <ModalShell onClose={close} panelClassName="ca-modal" isBusy={busy}
      panelStyle={step === 'reconcile' ? { width: 'min(760px, 96vw)', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' } : undefined}>
      {step === 'upload' ? (
        <>
          <h2 className="ca-modal-title">Import statement</h2>
          <p className="ca-modal-sub">Upload a bank, card or Voly/Xero export. Cargo matches it to the ledger and shows only what doesn’t line up.</p>

          <div className="ca-form-row ca-form-grid">
            <div>
              <label className="ca-label" htmlFor="ca-st-src">Source</label>
              <select id="ca-st-src" className="ca-select" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="ca-label" htmlFor="ca-st-acct">Account <span className="opt">optional</span></label>
              <select id="ca-st-acct" className="ca-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Any account</option>
                {accounts.filter((a) => a.is_active !== false).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </div>
          </div>

          <div className="ca-form-row">
            <label className="ca-label" htmlFor="ca-st-file">Statement file <span className="req">required</span></label>
            <input id="ca-st-file" className="ca-input" type="file" accept=".csv,.xlsx,.xls"
              onChange={(e) => onFile(e.target.files?.[0] || null)} />
          </div>

          {preview && (
            <p className="ca-modal-sub" style={{ marginBottom: 0 }}>
              <b>{preview.rows.length} lines</b> read
              {preview.rows[0]?.line_date ? ` · ${fmtDMY(preview.rows.reduce((a, r) => (r.line_date && r.line_date < a ? r.line_date : a), preview.rows[0].line_date))} – ${fmtDMY(preview.rows.reduce((a, r) => (r.line_date && r.line_date > a ? r.line_date : a), preview.rows[0].line_date))}` : ''}.
            </p>
          )}
          {err && <div className="ca-modal-err">{err}</div>}

          <div className="ca-modal-foot">
            <button type="button" className="ca-btn ca-btn-ghost" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="ca-btn ca-btn-primary" onClick={startReconcile} disabled={busy || !preview}>{busy ? 'Matching…' : 'Match to ledger →'}</button>
          </div>
        </>
      ) : (
        <>
          <h2 className="ca-modal-title">Reconcile</h2>
          <p className="ca-modal-sub">
            <b>{view.counts.matched} of {view.counts.total} matched ✓</b>
            {view.counts.missing ? ` · ${view.counts.missing} missing` : ''}
            {view.counts.review ? ` · ${view.counts.review} to review` : ''}
            {view.counts.unconfirmed ? ` · ${view.counts.unconfirmed} not on statement` : ''}
          </p>

          {view.groups.missing.length > 0 && (
            <div className="ca-rec-group">
              <div className="ca-rec-gh"><Icon name="AlertCircle" size={14} /> Missing from ledger <span className="ca-rec-gc">{view.groups.missing.length}</span></div>
              <p className="ca-rec-note">On the statement, never logged. Add each to the ledger.</p>
              {view.groups.missing.map((l) => (
                <div key={l.id} className="ca-rec-line">
                  <span className="ca-rec-date">{fmtDMY(l.line_date)}</span>
                  <span className="ca-rec-desc">{l.description || '—'}</span>
                  <span className={`ca-rec-amt ${l.amount < 0 ? 'ca-neg' : 'ca-pos'}`}>{money(l.amount, l.currency)}</span>
                  <span className="ca-rec-act">
                    <button type="button" className="ca-btn ca-btn-primary ca-btn-sm" disabled={busy} onClick={() => act(l, 'add', { accountId: statement.account_id })}>Add</button>
                    <button type="button" className="ca-link is-mut" disabled={busy} onClick={() => act(l, 'ignore')}>Ignore</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {view.groups.review.length > 0 && (
            <div className="ca-rec-group">
              <div className="ca-rec-gh"><Icon name="HelpCircle" size={14} /> Needs review <span className="ca-rec-gc">{view.groups.review.length}</span></div>
              <p className="ca-rec-note">A near or ambiguous match — confirm the ledger row it belongs to.</p>
              {view.groups.review.map((l) => (
                <div key={l.id} className="ca-rec-line ca-rec-review">
                  <div className="ca-rec-linehead">
                    <span className="ca-rec-date">{fmtDMY(l.line_date)}</span>
                    <span className="ca-rec-desc">{l.description || '—'}</span>
                    <span className={`ca-rec-amt ${l.amount < 0 ? 'ca-neg' : 'ca-pos'}`}>{money(l.amount, l.currency)}</span>
                    <span className="ca-rec-act"><button type="button" className="ca-link is-mut" disabled={busy} onClick={() => act(l, 'ignore')}>Ignore</button></span>
                  </div>
                  <div className="ca-rec-cands">
                    {l.candidates.length === 0 && <span className="ca-rec-note">No ledger candidate — add it instead: <button type="button" className="ca-link" onClick={() => act(l, 'add', { accountId: statement.account_id })}>Add to ledger</button></span>}
                    {l.candidates.map((c) => (
                      <button key={c.id} type="button" className="ca-rec-cand" disabled={busy} onClick={() => act(l, 'accept', { txnId: c.id })}>
                        <Icon name="Check" size={12} /> {fmtDMY(c.txn_date)} · {c.description || c.category || 'txn'} · {money(c.amount, c.currency)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view.unconfirmed.length > 0 && (
            <div className="ca-rec-group">
              <div className="ca-rec-gh"><Icon name="Info" size={14} /> Not on statement <span className="ca-rec-gc">{view.unconfirmed.length}</span></div>
              <p className="ca-rec-note">In the ledger but not on this statement — pending, timing, or a possible duplicate. Nothing to do unless it looks wrong.</p>
              {view.unconfirmed.map((t) => (
                <div key={t.id} className="ca-rec-line">
                  <span className="ca-rec-date">{fmtDMY(t.txn_date)}</span>
                  <span className="ca-rec-desc">{t.description || t.category || '—'}</span>
                  <span className={`ca-rec-amt ${t.amount < 0 ? 'ca-neg' : 'ca-pos'}`}>{money(t.amount, t.currency)}</span>
                  <span className="ca-rec-act" />
                </div>
              ))}
            </div>
          )}

          {err && <div className="ca-modal-err">{err}</div>}

          <div className="ca-modal-foot">
            <button type="button" className="ca-btn ca-btn-ghost" onClick={close} disabled={busy}>Close</button>
            <button type="button" className="ca-btn ca-btn-primary" onClick={finish} disabled={busy}>{busy ? 'Saving…' : 'Finish — mark reconciled'}</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
