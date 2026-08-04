// Who in the shore office can see this vessel's month-end.
//
// It sits under Check-off because this is the same subject from the other end:
// the crew close a month here, and these are the people it goes to. Command-only
// — the route already is, and every call below checks again in the database.
//
// The grant is by email, not by picking a user, because the office is routinely
// added before they have a Cargo login. Until someone signs in with that
// address the row is inert; it grants nothing.
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  listManagementAccess, grantManagementAccess, revokeManagementAccess,
} from '../../../services/managementAccess';
import { accessState, accessLabel, accessSub, sortAccess } from '../../../services/managementView';
import './management-access.css';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export default function ManagementAccess({ tenantId, onToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await listManagementAccess(tenantId);
    // Not permitted is the expected answer for anyone who isn't Command, and it
    // means "don't draw this", not "something went wrong".
    if (error) { setRows([]); setLoading(false); return; }
    setRows(sortAccess(data));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e?.preventDefault?.();
    setBusy(true); setErr(null);
    const { error } = await grantManagementAccess(tenantId, email, company);
    setBusy(false);
    // The database owns these rules — a rubbish address, someone who is already
    // crew — so its wording is what's shown rather than a guess made up here.
    if (error) { setErr(error.message || 'Could not give access'); return; }
    setEmail(''); setCompany(''); setOpen(false);
    onToast?.('Management access given');
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
          ? 'Nobody in the shore office can see this vessel yet. They can read closed months and either sign one off or send it back — they can never change a line the crew entered.'
          : `${live.length} ${live.length === 1 ? 'person' : 'people'} can read this vessel's closed months, sign them off, or send one back. None of them can change a line the crew entered.`}
      </p>

      {open && (
        <form className="ma-form" onSubmit={add}>
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
          <div className="ma-act">
            <button type="button" className="ma-btn ghost" onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
            <button type="submit" className="ma-btn primary" disabled={busy || !email.trim()}>
              {busy ? 'Giving access…' : 'Give access'}
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
                <span className={`ma-state s-${state.replace(/\s+/g, '-')}`}>
                  {state === 'awaiting sign-up' ? 'Not signed up yet' : state === 'withdrawn' ? `Withdrawn` : 'Has access'}
                </span>
                <span className="ma-when">{dmy(r.granted_at)}</span>
                {r.active ? (
                  <button type="button" className="ma-go" disabled={busy} onClick={() => withdraw(r)}>
                    Withdraw
                  </button>
                ) : <span className="ma-go is-none" />}
              </div>
            );
          })}
        </div>
      )}

      {/* A withdrawn grant is kept rather than deleted, and it's worth saying
          why — a captain who sees an old name in this list should know it's a
          record, not access. */}
      {rows.some((r) => !r.active) && (
        <p className="ma-foot">
          Withdrawn access stays listed so you can still see who signed off which month.
        </p>
      )}
    </section>
  );
}
