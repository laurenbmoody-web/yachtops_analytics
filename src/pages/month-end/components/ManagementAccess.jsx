// Who in the shore office can see this vessel's month-end.
//
// It lives on /month-end rather than under Accounts because the office reads
// more than the money: Hours of Rest and the rest of the monthly packs go to
// them too. This page is already "everything that must be signed off each
// month", so it's the honest home for who receives it.
//
// The grant is by email, not by picking a user, because the office is routinely
// added before they have a Cargo login. Until someone signs in with that
// address the row is inert; it grants nothing.
//
// Granting an address that already has access REPLACES what it covers — that's
// how a captain narrows or widens the office's view without ending up with two
// rows to withdraw.
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  listManagementAccess, grantManagementAccess, revokeManagementAccess,
} from '../../../services/managementAccess';
import {
  accessState, accessLabel, accessSub, sortAccess, describeScopes, SCOPES,
} from '../../../services/managementView';
import './management-access.css';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export default function ManagementAccess({ tenantId, onToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [permitted, setPermitted] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [scopes, setScopes] = useState(['accounts']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await listManagementAccess(tenantId);
    // "Not permitted" is the expected answer for anyone who isn't Command, and
    // it means "don't draw this at all", not "something went wrong".
    if (error) { setPermitted(false); setRows([]); setLoading(false); return; }
    setPermitted(true);
    setRows(sortAccess(data));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setOpen(false); setErr(null); setEmail(''); setCompany(''); setScopes(['accounts']);
  };

  const toggleScope = (key) => {
    setErr(null);
    setScopes((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  // Changing an existing grant is the same action as making one — same address,
  // new set of areas — so the form opens filled in rather than being a separate
  // screen with its own rules.
  const edit = (row) => {
    setEmail(row.email || '');
    setCompany(row.company_name || '');
    setScopes(row.scopes?.length ? [...row.scopes] : ['accounts']);
    setErr(null);
    setOpen(true);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setBusy(true); setErr(null);
    const { error } = await grantManagementAccess(tenantId, email, company, scopes);
    setBusy(false);
    // The database owns these rules — a rubbish address, someone already crew,
    // an empty choice — so its wording shows rather than a guess made up here.
    if (error) { setErr(error.message || 'Could not give access'); return; }
    onToast?.('Management access updated');
    reset();
    load();
  };

  const withdraw = async (row) => {
    setBusy(true);
    const { error } = await revokeManagementAccess(row.id);
    setBusy(false);
    if (error) { onToast?.(error.message || 'Could not withdraw access'); return; }
    onToast?.(`Access withdrawn from ${accessLabel(row)}`);
    load();
  };

  if (!permitted) return null;

  const live = rows.filter((r) => r.active);

  return (
    <section className="ma">
      <div className="ma-head">
        <p className="ma-lab">Management access</p>
        <span className="ma-rule" />
        {!open && (
          <button type="button" className="ma-add" onClick={() => setOpen(true)}>
            <Icon name="Plus" size={13} /> Give access
          </button>
        )}
      </div>

      <p className="ma-say">
        {live.length === 0
          ? 'Nobody in the shore office can see this vessel yet. Give access and they read what you choose — they can sign a closed month off or send it back, but they can never change what the crew entered.'
          : `${live.length} ${live.length === 1 ? 'person' : 'people'} in the shore office can read this vessel. They can sign a closed month off or send it back; none of them can change what the crew entered.`}
      </p>

      {open && (
        <form className="ma-form" onSubmit={submit}>
          <label className="ma-field">
            <span>Their email <em className="req">required</em></span>
            <input type="email" value={email} autoFocus placeholder="accounts@office.com"
              onChange={(e) => { setEmail(e.target.value); setErr(null); }} />
          </label>
          <label className="ma-field">
            <span>Company <em className="opt">optional</em></span>
            <input type="text" value={company} placeholder="e.g. Blue Water Yacht Management"
              onChange={(e) => setCompany(e.target.value)} />
          </label>

          <fieldset className="ma-scopes">
            <legend>What they can see <em className="req">required</em></legend>
            {SCOPES.map((s) => {
              const on = scopes.includes(s.key);
              return (
                <button key={s.key} type="button" className={`ma-scope${on ? ' on' : ''}`}
                  aria-pressed={on} onClick={() => toggleScope(s.key)}>
                  <span className="ma-tick">{on && <Icon name="Check" size={12} />}</span>
                  <span className="ma-scope-txt"><b>{s.label}</b><em>{s.note}</em></span>
                </button>
              );
            })}
          </fieldset>

          <div className="ma-act">
            <button type="button" className="ma-btn ghost" onClick={reset}>Cancel</button>
            <button type="submit" className="ma-btn primary" disabled={busy || !email.trim() || !scopes.length}>
              {busy ? 'Saving…' : 'Give access'}
            </button>
          </div>
          {err && <p className="ma-err"><Icon name="AlertCircle" size={13} /> {err}</p>}
        </form>
      )}

      {loading ? (
        <p className="ma-empty">Loading…</p>
      ) : rows.length === 0 ? (
        !open && <p className="ma-empty">No access given yet.</p>
      ) : (
        <div className="ma-rows">
          {rows.map((r) => {
            const state = accessState(r);
            const sub = accessSub(r);
            return (
              <div key={r.id} className={`ma-row${r.active ? '' : ' is-off'}`}>
                <span className="ma-who">
                  <b>{accessLabel(r)}</b>
                  {sub && <em>{sub}</em>}
                </span>
                <span className="ma-sees">{describeScopes(r.scopes)}</span>
                <span className={`ma-state s-${state.replace(/\s+/g, '-')}`}>
                  {state === 'awaiting sign-up' ? 'Not signed up yet' : state === 'withdrawn' ? 'Withdrawn' : 'Has access'}
                </span>
                <span className="ma-when">{dmy(r.granted_at)}</span>
                {r.active ? (
                  <span className="ma-go">
                    <button type="button" disabled={busy} onClick={() => edit(r)}>Change</button>
                    <button type="button" disabled={busy} onClick={() => withdraw(r)}>Withdraw</button>
                  </span>
                ) : <span className="ma-go" />}
              </div>
            );
          })}
        </div>
      )}

      {/* A withdrawn grant is kept rather than deleted, and it's worth saying
          why — a captain who sees an old name here should know it's a record,
          not access. */}
      {rows.some((r) => !r.active) && (
        <p className="ma-foot">
          Withdrawn access stays listed so you can still see who signed off which month.
        </p>
      )}
    </section>
  );
}
