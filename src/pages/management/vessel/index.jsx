// One vessel's month, as the shore office reads it.
//
// The office is not doing the crew's job. Per account they are answering one
// question — does this month hang together well enough to post against the
// owner's funds — and then either signing it off or sending it back. So this is
// a verdict per account, not an editable ledger: the figures, and the counts of
// anything that would be a reason to query.
//
// Every action names the vessel and the month back at them before it happens.
// With a dozen yachts on the books and two of them called Serenity, the mistake
// that actually gets made is signing off the right month on the wrong boat.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import ManagementLayout from '../components/ManagementLayout';
import useManagementCompany from '../../../hooks/useManagementCompany';
import { listManagedPeriods, getManagedMonth, signOffMonth, queryMonth } from '../../../services/managementService';
import {
  closesMap, linesForPeriod, accountMonth, reconciliationState,
  canSignOff, canQuery, monthKeyOf, canSignOffAs,
} from '../../../services/managementView';
import { formatMoney } from '../../../services/financeCalc';
import '../management.css';
import './vessel.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (iso) => {
  if (!iso) return '';
  const [y, m] = String(iso).slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export default function ManagementVessel() {
  const { tenantId } = useParams();
  const navigate = useNavigate();
  const { company } = useManagementCompany();

  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState(null);
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null);   // { kind: 'sign'|'query', account }
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await listManagedPeriods(tenantId);
      if (!live) return;
      if (error) { setErr(error.message || 'Could not load this vessel'); setLoading(false); return; }
      setPeriods(data);
      // Newest first from the database — the month they came to look at is
      // almost always the most recent one closed.
      setPeriod(data[0]?.period_month || null);
      if (!data.length) setLoading(false);
    })();
    return () => { live = false; };
  }, [tenantId]);

  const loadMonth = useCallback(async () => {
    if (!period) return;
    setLoading(true);
    const { data, error } = await getManagedMonth(tenantId, monthKeyOf(period));
    if (error) { setErr(error.message || 'Could not load that month'); setPack(null); }
    else { setErr(null); setPack(data); }
    setLoading(false);
  }, [tenantId, period]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  // The vessel's own period rule, applied here rather than copied into SQL: a
  // line entered after its month closed reconciles into the NEXT month, so
  // grouping by calendar would show the office lines in a month the boat never
  // closed them into. See managementView.linesForPeriod.
  const view = useMemo(() => {
    if (!pack) return [];
    const closes = closesMap(pack.closes);
    const lines = linesForPeriod(pack.lines, period, closes);
    const recons = pack.reconciliations || [];
    return (pack.accounts || [])
      .map((a) => accountMonth(a, lines, recons.find((r) => r.account_id === a.id) || null))
      // An account with no lines and no reconciliation isn't part of this month.
      .filter((m) => m.count > 0 || m.reconciliation);
  }, [pack, period]);

  const mayAct = canSignOffAs(company?.permission_tier);
  const vesselName = pack?.vessel?.name || 'Vessel';

  const act = async () => {
    if (!asking) return;
    setBusy(true);
    const id = asking.account.reconciliation?.id;
    const { error } = asking.kind === 'sign'
      ? await signOffMonth(id, note)
      : await queryMonth(id, note);
    setBusy(false);
    // The database refuses a month the vessel hasn't closed, and a query with no
    // reason — its wording is more accurate than anything guessed here.
    if (error) { setErr(error.message || 'That did not go through'); return; }
    setAsking(null); setNote(''); setErr(null);
    loadMonth();
  };

  return (
    <ManagementLayout
      eyebrow={`Management · ${vesselName}${period ? ` · ${periodLabel(period)}` : ''}`}
      title={<>{vesselName}<span className="accent">, to review</span>.</>}
      actions={(
        <button type="button" className="ce-action" onClick={() => navigate('/management')}>
          <Icon name="ChevronLeft" size={14} /> All vessels
        </button>
      )}
    >
      {periods.length > 1 && (
        <div className="mgv-periods">
          {periods.map((p) => (
            <button key={p.period_month} type="button"
              className={`mgv-period${p.period_month === period ? ' on' : ''}`}
              onClick={() => setPeriod(p.period_month)}>
              {periodLabel(p.period_month)}
              {p.awaiting > 0 && <span className="mgv-pill">{p.awaiting}</span>}
            </button>
          ))}
        </div>
      )}

      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}

        {loading ? (
          <p className="ce-status">Loading…</p>
        ) : !periods.length ? (
          <p className="ce-status">This vessel hasn&rsquo;t closed a month yet. Nothing to review.</p>
        ) : (
          <div className="mgv-accs">
            {view.map((m) => {
              const state = reconciliationState(m.reconciliation);
              const cur = m.account.currency;
              const money = (n) => formatMoney(n, cur);
              const reasons = [];
              if (m.uncoded) reasons.push(`${m.uncoded} not coded`);
              if (m.unevidenced) reasons.push(`${m.unevidenced} without a receipt`);
              m.mismatches.forEach((x) => reasons.push(`${x.label} out by ${money(Math.abs(x.gap))}`));

              return (
                <section key={m.account.id} className="ce-card rounded-xl p-5">
                  <div className="mgv-acc-h">
                    <span className="mgv-acc-n">
                      <b>{m.account.name}</b>
                      {m.account.card_last4 && m.account.card_last4 !== '0000' && <em>••{m.account.card_last4}</em>}
                    </span>
                    <span className={`mgv-state s-${state.replace(/\s+/g, '-')}`}>{state}</span>
                  </div>

                  {/* The closing balance is what the office is actually here
                      for, so it carries the accent rather than being the last
                      row of a ladder. */}
                  <div className="mgv-eq">
                    <div className="r"><span>Opening</span><b>{money(m.reconciliation?.opening_balance)}</b></div>
                    <div className="r"><span>Money in</span><b>{money(m.moneyIn)}</b></div>
                    <div className="r"><span>Money out</span><b>{money(Math.abs(m.moneyOut))}</b></div>
                    <div className="r is-tot"><span>Closing</span><b>{money(m.reconciliation?.closing_balance)}</b></div>
                  </div>
                  <p className="mgv-sub">{m.count} {m.count === 1 ? 'line' : 'lines'} in this month</p>

                  {/* Everything that would be a reason to send it back, counted
                      rather than scored — the office decides, Cargo just says
                      what it found. */}
                  {reasons.length > 0 ? (
                    <p className="mgv-reasons">
                      <Icon name="AlertCircle" size={14} />
                      {reasons.join(' · ')}
                    </p>
                  ) : (
                    <p className="mgv-clean"><Icon name="Check" size={14} /> Every line coded and evidenced, and the figures agree</p>
                  )}

                  {m.reconciliation?.query_note && (
                    <p className="mgv-note">
                      <b>You sent this back{m.reconciliation.queried_at ? ` on ${dmy(m.reconciliation.queried_at)}` : ''}:</b>{' '}
                      {m.reconciliation.query_note}
                    </p>
                  )}
                  {m.reconciliation?.status === 'approved' && (
                    <p className="mgv-note is-ok">
                      Signed off{m.reconciliation.approved_at ? ` on ${dmy(m.reconciliation.approved_at)}` : ''}.
                      {m.reconciliation.signoff_note && ` ${m.reconciliation.signoff_note}`}
                    </p>
                  )}

                  {mayAct && (canSignOff(m.reconciliation) || canQuery(m.reconciliation)) && (
                    <div className="mgv-act">
                      {canQuery(m.reconciliation) && (
                        <button type="button" className="mgv-btn ghost" disabled={busy}
                          onClick={() => { setAsking({ kind: 'query', account: m }); setNote(''); }}>
                          Send back with a question
                        </button>
                      )}
                      {canSignOff(m.reconciliation) && (
                        <button type="button" className="mgv-btn primary" disabled={busy}
                          onClick={() => { setAsking({ kind: 'sign', account: m }); setNote(''); }}>
                          Sign off
                        </button>
                      )}
                    </div>
                  )}
                  {!mayAct && canSignOff(m.reconciliation) && (
                    <p className="mgv-readonly">
                      You can read this month but not sign it off — ask an owner or admin at {company?.company_name || 'your company'}.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {/* Naming the vessel and the month back before either action happens.
            The mistake that gets made with a dozen boats on the books is the
            right month on the wrong yacht. */}
        {asking && (
          <div className="mgv-ask" role="dialog" aria-modal="true">
            <div className="mgv-ask-p">
              <p className="mgv-ask-h">
                {asking.kind === 'sign' ? 'Sign off' : 'Send back'} {periodLabel(period)} on {vesselName}?
              </p>
              <p className="mgv-ask-s">
                {asking.account.account.name}
                {asking.kind === 'sign'
                  ? ' — this tells the vessel the month is accepted and closes it for the owner’s books.'
                  : ' — this reopens the month for the crew, so say what needs looking at.'}
              </p>
              <textarea value={note} rows={3} autoFocus
                placeholder={asking.kind === 'sign' ? 'Anything to note (optional)' : 'What needs looking at'}
                onChange={(e) => setNote(e.target.value)} />
              <div className="mgv-ask-a">
                <button type="button" className="mgv-btn ghost" disabled={busy}
                  onClick={() => { setAsking(null); setNote(''); }}>Cancel</button>
                <button type="button" className="mgv-btn primary" disabled={busy || (asking.kind === 'query' && !note.trim())}
                  onClick={act}>
                  {busy ? 'Sending…' : (asking.kind === 'sign' ? 'Sign it off' : 'Send it back')}
                </button>
              </div>
            </div>
          </div>
        )}
    </ManagementLayout>
  );
}
