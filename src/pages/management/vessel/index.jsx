// One vessel, as a dashboard.
//
// The office opens a boat the way the crew open theirs: a grid of widgets, one
// per area of the vessel, each saying where it stands. A widget is live, or not
// shared (the vessel left it out of the engagement — only their command can
// change that), or planned (Cargo doesn't serve it to management yet). Said
// plainly rather than drawn as though it worked.
//
// Month-end spending is the live one, and it opens in place: a verdict per
// account — the figures, and the counts of anything that would be a reason to
// query — not an editable ledger.
//
// Every action names the vessel and the month back at them before it happens.
// With a dozen yachts on the books and two of them called Serenity, the mistake
// that actually gets made is signing off the right month on the wrong boat.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import ManagementLayout from '../components/ManagementLayout';
import useManagementCompany from '../../../hooks/useManagementCompany';
import {
  listManagedVessels, listManagedPeriods, getManagedMonth, signOffMonth, queryMonth,
} from '../../../services/managementService';
import {
  closesMap, linesForPeriod, accountMonth, reconciliationState,
  canSignOff, canQuery, monthKeyOf, canSignOffAs, VESSEL_AREAS, areaState,
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

  const [vessel, setVessel] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [period, setPeriod] = useState(null);
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null);   // { kind: 'sign'|'query', account }
  const [note, setNote] = useState('');

  // The fleet row carries the vessel's name and which areas it shared — the
  // widgets need both before any month has loaded.
  useEffect(() => {
    let live = true;
    listManagedVessels().then(({ data }) => {
      if (live) setVessel((data || []).find((v) => v.tenant_id === tenantId) || null);
    });
    return () => { live = false; };
  }, [tenantId]);

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
  const vesselName = pack?.vessel?.name || vessel?.vessel_name || 'Vessel';
  const scopes = vessel?.scopes || [];
  const waiting = view.filter((m) => canSignOff(m.reconciliation)).length;

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
      eyebrow={`Management · ${vesselName}`}
      title={<>{vesselName}<span className="accent">, {waiting ? 'to review' : 'up to date'}</span>.</>}
      lede={periods.length
        ? `Showing ${periodLabel(period)}. ${waiting ? `${waiting} ${waiting === 1 ? 'account is' : 'accounts are'} waiting on your signature.` : 'Nothing here is waiting on you.'}`
        : 'This vessel hasn’t closed a month yet.'}
      actions={(
        <button type="button" className="ce-action" onClick={() => navigate('/management')}>
          <Icon name="ChevronLeft" size={14} /> All vessels
        </button>
      )}
    >
      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* The areas of the vessel, as widgets. */}
        {VESSEL_AREAS.map((a) => {
          const st = areaState(a, scopes);
          return (
            <div key={a.key} className="lg:col-span-4">
              <div className={`ce-card rounded-xl p-5 mg-area${st === 'live' ? ' is-live' : ''}`}>
                <div className="flex items-start justify-between">
                  <span className={`mg-area-ic${st === 'live' ? ' on' : ''}`}>
                    <Icon name={a.icon} size={17} />
                  </span>
                  {st !== 'live' && (
                    <span className={`mg-area-tag${st === 'not shared' ? ' off' : ''}`}>
                      {st === 'not shared' ? 'Not shared' : 'Planned'}
                    </span>
                  )}
                </div>
                <h3 className="ce-title mt-4">{a.label}</h3>
                <p className="ce-status">
                  {st === 'not shared'
                    ? `${vesselName} didn’t include this in your engagement.`
                    : st === 'live'
                      ? (periods.length
                        ? `${periods.length} ${periods.length === 1 ? 'month' : 'months'} closed · through ${periodLabel(periods[0]?.period_month)}`
                        : 'No months closed yet')
                      : a.note}
                </p>
              </div>
            </div>
          );
        })}

        {/* The live one, opened in place. */}
        {scopes.includes('accounts') && periods.length > 0 && (
          <div className="lg:col-span-12">
            <div className="flex items-end justify-between gap-4 mt-2">
              <div>
                <p className="ce-eyebrow"><span className="dot">●</span> Month-end spending</p>
                <h2 className="mgl-h1" style={{ fontSize: 26 }}>{periodLabel(period)}</h2>
              </div>
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
            </div>
          </div>
        )}

        {loading ? (
          <div className="lg:col-span-12"><p className="ce-status">Loading…</p></div>
        ) : !periods.length ? null : view.map((m) => {
          const state = reconciliationState(m.reconciliation);
          const cur = m.account.currency;
          const money = (n) => formatMoney(n, cur);
          const reasons = [];
          if (m.uncoded) reasons.push(`${m.uncoded} not coded`);
          if (m.unevidenced) reasons.push(`${m.unevidenced} without a receipt`);
          m.mismatches.forEach((x) => reasons.push(`${x.label} out by ${money(Math.abs(x.gap))}`));

          return (
            <div key={m.account.id} className="lg:col-span-6">
              <section className="ce-card rounded-xl p-5">
                <div className="mgv-acc-h">
                  <span className="mgv-acc-n">
                    <b>{m.account.name}</b>
                    {m.account.card_last4 && m.account.card_last4 !== '0000' && <em>••{m.account.card_last4}</em>}
                  </span>
                  <span className={`mgv-state s-${state.replace(/\s+/g, '-')}`}>{state}</span>
                </div>

                <div className="mgv-eq">
                  <div className="r"><span>Opening</span><b>{money(m.reconciliation?.opening_balance)}</b></div>
                  <div className="r"><span>Money in</span><b>{money(m.moneyIn)}</b></div>
                  <div className="r"><span>Money out</span><b>{money(Math.abs(m.moneyOut))}</b></div>
                  <div className="r is-tot"><span>Closing</span><b>{money(m.reconciliation?.closing_balance)}</b></div>
                </div>
                <p className="mgv-sub">{m.count} {m.count === 1 ? 'line' : 'lines'} in this month</p>

                {reasons.length > 0 ? (
                  <p className="mgv-reasons"><Icon name="AlertCircle" size={14} />{reasons.join(' · ')}</p>
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
                      <button type="button" className="ce-action" disabled={busy}
                        onClick={() => { setAsking({ kind: 'query', account: m }); setNote(''); }}>
                        Send back
                      </button>
                    )}
                    {canSignOff(m.reconciliation) && (
                      <button type="button" className="ce-btn-navy px-4 py-2 text-xs" disabled={busy}
                        onClick={() => { setAsking({ kind: 'sign', account: m }); setNote(''); }}>
                        Sign off
                      </button>
                    )}
                  </div>
                )}
                {!mayAct && canSignOff(m.reconciliation) && (
                  <p className="mgv-readonly">
                    You can read this month but not sign it off — ask an owner or admin
                    at {company?.company_name || 'your company'}.
                  </p>
                )}
              </section>
            </div>
          );
        })}
      </div>

      {/* Naming the vessel and month back before either action happens. */}
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
              <button type="button" className="ce-action" disabled={busy}
                onClick={() => { setAsking(null); setNote(''); }}>Cancel</button>
              <button type="button" className="ce-btn-navy px-4 py-2 text-xs"
                disabled={busy || (asking.kind === 'query' && !note.trim())} onClick={act}>
                {busy ? 'Sending…' : (asking.kind === 'sign' ? 'Sign it off' : 'Send it back')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ManagementLayout>
  );
}
