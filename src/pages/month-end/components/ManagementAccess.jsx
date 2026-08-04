// Who in the shore office can see this vessel's month-end.
//
// It lives on /month-end rather than under Accounts because the office reads
// more than the money: Hours of Rest and the rest of the monthly packs go to
// them too. This page is already "everything that must be signed off each
// month", so it's the honest home for who receives it.
//
// What the vessel engages is a FIRM, not a person. The captain names it and
// gives one address; that address becomes the firm's first owner, and the firm
// adds its own people from there. So this list changes without the captain
// touching it — which is why each row shows who the firm currently is.
//
// The trade, stated plainly: the vessel controls the engagement and its scopes,
// the firm controls its team. What that buys is per-person identity — a month
// signed off names the human who signed it, not a shared office mailbox.
//
// Engaging a firm that is already here replaces what the engagement covers,
// which is how a captain narrows or widens it without a second row to end.
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  listManagementAccess, grantManagementAccess, revokeManagementAccess,
} from '../../../services/managementAccess';
import {
  accessState, accessLabel, accessPeople, sortAccess, describeScopes, SCOPES,
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

  // Changing an engagement is the same action as making one, so the form opens
  // filled in rather than being a separate screen with its own rules. The
  // address comes from the firm's owner: the captain is not being asked to
  // remember who they first invited in order to change what the firm can see.
  const edit = (row) => {
    const people = row.people || [];
    const owner = people.find((p) => p.tier === 'OWNER') || people[0];
    setEmail(owner?.email || '');
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
    if (error) { setErr(error.message || 'Could not engage them'); return; }
    onToast?.('Management access updated');
    reset();
    load();
  };

  const withdraw = async (row) => {
    setBusy(true);
    const { error } = await revokeManagementAccess(row.id);
    setBusy(false);
    if (error) { onToast?.(error.message || 'Could not end the engagement'); return; }
    onToast?.(`Engagement with ${accessLabel(row)} ended`);
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
            <Icon name="Plus" size={13} /> Engage a company
          </button>
        )}
      </div>

      <p className="ma-say">
        {live.length === 0
          ? 'No management company is engaged on this vessel yet. Name one and they read what you choose — they can sign a closed month off or send it back, but they can never change what the crew entered.'
          : `${live.length} ${live.length === 1 ? 'management company reads' : 'management companies read'} this vessel. Their people can sign a closed month off or send it back; none of them can change what the crew entered. The company adds and removes its own staff — the list below is who that is right now.`}
      </p>

      {open && (
        <form className="ma-form" onSubmit={submit}>
          <label className="ma-field">
            <span>Management company <em className="req">required</em></span>
            <input type="text" value={company} autoFocus placeholder="e.g. Blue Water Yacht Management"
              onChange={(e) => { setCompany(e.target.value); setErr(null); }} />
          </label>
          <label className="ma-field">
            {/* One address, and only for a firm Cargo hasn't met. They become
                its owner and add the rest of their office themselves. */}
            <span>Who to set up <em className="req">required</em></span>
            <input type="email" value={email} placeholder="accounts@bluewater.com"
              onChange={(e) => { setEmail(e.target.value); setErr(null); }} />
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
            <button type="submit" className="ma-btn primary"
              disabled={busy || !email.trim() || !company.trim() || !scopes.length}>
              {busy ? 'Saving…' : 'Give access'}
            </button>
          </div>
          {err && <p className="ma-err"><Icon name="AlertCircle" size={13} /> {err}</p>}
        </form>
      )}

      {loading ? (
        <p className="ma-empty">Loading…</p>
      ) : rows.length === 0 ? (
        !open && <p className="ma-empty">No management company engaged yet.</p>
      ) : (
        <div className="ma-rows">
          {rows.map((r) => {
            const state = accessState(r);
            return (
              <div key={r.id} className={`ma-row${r.active ? '' : ' is-off'}`}>
                <span className="ma-who">
                  <b>{accessLabel(r)}</b>
                  {/* The firm runs its own team, so this list changes without
                      the captain doing anything. Showing it is the whole reason
                      a company-level grant is safe to give. */}
                  <em>{accessPeople(r)}</em>
                </span>
                <span className="ma-sees">{describeScopes(r.scopes)}</span>
                <span className={`ma-state s-${state.replace(/\s+/g, '-')}`}>
                  {state === 'awaiting sign-up' ? 'Nobody signed in yet'
                    : state === 'ended' ? 'Ended' : `${r.people_count} with access`}
                </span>
                <span className="ma-when">{dmy(r.granted_at)}</span>
                {r.active ? (
                  <span className="ma-go">
                    <button type="button" disabled={busy} onClick={() => edit(r)}>Change</button>
                    <button type="button" disabled={busy} onClick={() => withdraw(r)}>End</button>
                  </span>
                ) : <span className="ma-go" />}
              </div>
            );
          })}
        </div>
      )}

      {/* An ended engagement is kept rather than deleted, and it's worth saying
          why — a captain who sees an old firm here should know it's a record,
          not access. */}
      {rows.some((r) => !r.active) && (
        <p className="ma-foot">
          Ended engagements stay listed so you can still see who signed off which month.
        </p>
      )}
    </section>
  );
}
