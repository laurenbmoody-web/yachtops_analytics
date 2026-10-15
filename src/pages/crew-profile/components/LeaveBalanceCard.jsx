// Leave balance — accrued, taken, remaining, and why the number is what it is.
//
// Lives under Employment, beside the entitlement figure it is derived from.
// Deliberately states its own workings: an entitlement that comes from a 4:2
// rotation, a statutory minimum and a figure somebody typed in are three very
// different claims, and a crew member checking their own leave should be able to
// see which one they're looking at.
//
// It also refuses to look more certain than it is. The count comes from status
// changes logged in Cargo, so leave taken without the status being changed is
// invisible to it — which on real data means a crew member on rotation since
// 2024 with nothing logged shows hundreds of days banked. Where that is the
// case the card says so rather than presenting the figure as settled.
//
// Adjustments are shown in full, to the crew member as well as to Command. They
// change what someone is owed, so finding out about one after the fact would be
// worse than the correction itself.
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  getLeaveBalance, addLeaveAdjustment, deleteLeaveAdjustment, setLeavePolicy,
  ADJUSTMENT_KINDS, adjustmentKindLabel,
} from '../../../services/leaveService';
import { basisLabel, formatDays, toHalfDays } from '../../../services/leaveBalance';
import './leave-balance.css';

const dmy = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const signed = (n) => `${n > 0 ? '+' : ''}${formatDays(n)}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function LeaveBalanceCard({ tenantId, userId, canAdjust = false }) {
  const [state, setState] = useState({ loading: true, bal: null, err: null });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: 'granted', days: '', effectiveDate: today(), reason: '' });
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId || !userId) { setState({ loading: false, bal: null, err: null }); return; }
    setState((s) => ({ ...s, loading: true }));
    const { data, error } = await getLeaveBalance(tenantId, userId);
    setState({ loading: false, bal: data, err: error ? (error.message || 'Could not load leave') : null });
  }, [tenantId, userId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setFormErr('');
    setBusy(true);
    const { error } = await addLeaveAdjustment(tenantId, userId, form);
    setBusy(false);
    if (error) { setFormErr(error.message || 'Could not save that'); return; }
    setForm({ kind: 'granted', days: '', effectiveDate: today(), reason: '' });
    setAdding(false);
    load();
  };

  // The leave year is a VESSEL-wide policy that happens to be set from here,
  // because this is where Command is standing when they notice the balance is
  // being computed the wrong way. Labelled as such so nobody thinks they are
  // changing one crew member's terms.
  const savePolicy = async (patch) => {
    setBusy(true);
    await setLeavePolicy(tenantId, patch);
    setBusy(false);
    load();
  };

  const remove = async (id) => {
    setBusy(true);
    await deleteLeaveAdjustment(id);
    setBusy(false);
    load();
  };

  const { loading, bal, err } = state;
  if (loading) return <div className="lv-card lv-quiet">Working out leave…</div>;
  if (err) return <div className="lv-card lv-quiet">{err}</div>;
  if (!bal) return null;

  if (!bal.ok) {
    return (
      <div className="lv-card">
        <div className="lv-head"><h4 className="lv-title">Leave</h4></div>
        <p className="lv-none">
          {bal.reason === 'not-started'
            ? 'This contract hasn’t started yet, so no leave has accrued.'
            : 'Add a contract start date under Employment and leave will accrue from it.'}
        </p>
      </div>
    );
  }

  const hasYear = bal.policy.anchor !== 'none';
  const kindSpec = ADJUSTMENT_KINDS.find((k) => k.key === form.kind);

  return (
    <div className="lv-card">
      <div className="lv-head">
        <h4 className="lv-title">Leave</h4>
        <span className="lv-asof">
          {hasYear ? `${dmy(bal.yearFrom)} – ${dmy(bal.yearTo)}` : `as at ${dmy(bal.asOf)}`}
        </span>
      </div>

      <div className="lv-figs">
        {/* Only shown with a leave year — without one there is no "brought
            forward", and a permanent zero would just be noise. */}
        {hasYear && (
          <div className="lv-fig">
            <b>{formatDays(bal.opening)}</b>
            <em>Brought forward</em>
          </div>
        )}
        <div className="lv-fig">
          <b>{formatDays(bal.accrued)}</b>
          <em>Accrued</em>
        </div>
        <div className="lv-fig">
          <b>{formatDays(bal.taken)}</b>
          <em>Taken</em>
        </div>
        {bal.adjustments !== 0 && (
          <div className="lv-fig">
            <b>{signed(bal.adjustments)}</b>
            <em>Adjustments</em>
          </div>
        )}
        <div className="lv-fig lv-rem">
          <b data-neg={bal.overdrawn ? 'y' : undefined}>{formatDays(toHalfDays(bal.remaining))}</b>
          <em>{bal.overdrawn ? 'Overdrawn' : 'Remaining'}</em>
        </div>
      </div>

      <p className="lv-basis">
        {bal.annualDays % 1 === 0 ? bal.annualDays : bal.annualDays.toFixed(1)} days a year
        {' · '}{basisLabel(bal.basis, bal.rotation)}
        {' · '}accruing since {dmy(bal.startDate)}
        {hasYear ? ` · leave year resets ${bal.policy.anchor === 'calendar' ? '1 January' : 'on the contract anniversary'}` : ''}
      </p>

      {bal.notCounted > 0 && (
        <p className="lv-note">
          {formatDays(bal.notCounted)} away not charged to leave
          {bal.rotational > 0 && !bal.isRotational ? ' (including rotation)' : ''}
          {bal.byStatus.medical_leave ? ` · ${bal.byStatus.medical_leave} medical` : ''}
          {bal.byStatus.training_leave ? ` · ${bal.byStatus.training_leave} training` : ''}
        </p>
      )}

      {bal.forfeited > 0 && (
        <p className="lv-note">
          {formatDays(bal.forfeited)} lapsed at previous year ends under the
          {' '}{formatDays(bal.policy.carryOverMaxDays)} carry-over limit.
        </p>
      )}

      {bal.partial && (
        <p className="lv-note">Adjustments couldn’t be read, so this figure may be incomplete.</p>
      )}

      {bal.banked && (
        <p className="lv-warn">
          <Icon name="AlertTriangle" size={14} />
          <span>
            That’s more than a year’s entitlement banked, which usually means leave was
            taken without the status being changed here. Treat it as a lower bound on
            days taken{bal.historyStartsLate ? `, and note the status log only starts ${dmy(bal.historyFrom)}` : ''}.
          </span>
        </p>
      )}

      {!bal.banked && bal.historyStartsLate && (
        <p className="lv-note">
          Counted from status changes since {dmy(bal.historyFrom)} — anything before that isn’t included.
        </p>
      )}

      {/* ── the adjustment ledger ───────────────────────────────────────── */}
      {bal.adjustmentList?.length > 0 && (
        <div className="lv-adjs">
          <p className="lv-adjs-h">Adjustments</p>
          {bal.adjustmentList.map((a) => (
            <div key={a.id} className="lv-adj">
              <span className="lv-adj-days" data-neg={Number(a.days) < 0 ? 'y' : undefined}>
                {signed(Number(a.days))}
              </span>
              <span className="lv-adj-main">
                <span className="lv-adj-kind">{adjustmentKindLabel(a.kind)}</span>
                <span className="lv-adj-why">
                  {a.reason}
                  {' · '}{dmy(a.effective_date)}
                  {a.created_by_name ? ` · ${a.created_by_name}` : ''}
                </span>
              </span>
              {canAdjust && (
                <button type="button" className="lv-adj-x" disabled={busy}
                  onClick={() => remove(a.id)} title="Remove this adjustment">
                  <Icon name="X" size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAdjust && !adding && (
        <div className="lv-actions">
          <button type="button" className="lv-add" onClick={() => setAdding(true)}>
            <Icon name="Plus" size={14} /> Adjust leave
          </button>
          <button type="button" className="lv-add" onClick={() => setPolicyOpen((v) => !v)}>
            <Icon name="CalendarRange" size={14} /> Leave year
          </button>
        </div>
      )}

      {canAdjust && policyOpen && (
        <div className="lv-form">
          <p className="lv-form-vessel">
            <Icon name="Info" size={13} /> Applies to every crew member on this vessel.
          </p>
          <div className="lv-form-row">
            <label>
              <span>Leave year</span>
              <select
                value={bal.policy.anchor}
                disabled={busy}
                onChange={(e) => savePolicy({ anchor: e.target.value })}
              >
                <option value="none">Continuous — never resets</option>
                <option value="contract">Resets on the contract anniversary</option>
                <option value="calendar">Resets 1 January</option>
              </select>
            </label>
            {bal.policy.anchor !== 'none' && (
              <label>
                <span>Carry over, max</span>
                <input
                  type="number" min="0" step="0.5" placeholder="no limit"
                  defaultValue={bal.policy.carryOverMaxDays ?? ''}
                  disabled={busy}
                  onBlur={(e) => savePolicy({
                    carryOverMaxDays: e.target.value === '' ? null : e.target.value,
                  })}
                />
              </label>
            )}
          </div>
          <p className="lv-form-hint">
            {bal.policy.anchor === 'none'
              ? 'Leave accrues from the contract start and nothing ever lapses. This is the default.'
              : 'Days above the limit lapse when the leave year ends. Leave it blank for no limit — nothing lapses unless you set a number.'}
          </p>
          <div className="lv-form-actions">
            <button type="button" className="lv-btn lv-ghost" onClick={() => setPolicyOpen(false)}>Done</button>
          </div>
        </div>
      )}

      {canAdjust && adding && (
        <div className="lv-form">
          <div className="lv-form-row">
            <label>
              <span>Kind</span>
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                {ADJUSTMENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label>
              <span>Days</span>
              <input type="number" step="0.5" value={form.days} placeholder="0"
                onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
            </label>
            <label>
              <span>Effective</span>
              <input type="date" value={form.effectiveDate}
                onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} />
            </label>
          </div>
          {/* The sign is applied from the kind, so say which way it will go
              rather than relying on anyone remembering the convention. */}
          <p className="lv-form-hint">
            {kindSpec?.hint}
            {kindSpec?.sign === -1 ? ' This will subtract days.' : ''}
            {kindSpec?.sign === 1 ? ' This will add days.' : ''}
            {kindSpec?.sign === 0 ? ' Enter a negative number to subtract.' : ''}
          </p>
          <label className="lv-form-reason">
            <span>Reason</span>
            <input type="text" value={form.reason} placeholder="Why this adjustment is being made"
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </label>
          {formErr && <p className="lv-form-err">{formErr}</p>}
          <div className="lv-form-actions">
            <button type="button" className="lv-btn lv-ghost" disabled={busy}
              onClick={() => { setAdding(false); setFormErr(''); }}>Cancel</button>
            <button type="button" className="lv-btn lv-primary" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : 'Post adjustment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
