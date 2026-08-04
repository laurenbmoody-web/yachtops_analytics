// The firm's own team.
//
// This is what per-person identity costs, and it's cheap: the office adds its
// own people instead of asking six captains to re-grant. A colleague can be
// added before they have a Cargo login — the row grants nothing until they sign
// in with that address — so hiring someone isn't a favour to request.
//
// Everyone can see their colleagues; only an owner or admin can change the list,
// which the database enforces regardless of what this page draws.
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import ManagementShell from '../components/ManagementShell';
import useManagementCompany from '../../../hooks/useManagementCompany';
import {
  listManagementTeam, addManagementTeamMember, removeManagementTeamMember,
} from '../../../services/managementAccess';
import { TEAM_TIERS, tierLabel, canRunTeam } from '../../../services/managementView';
import '../management.css';
import './team.css';

export default function ManagementTeam() {
  const { company } = useManagementCompany();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState('MEMBER');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const mayRun = canRunTeam(company?.permission_tier);

  const load = useCallback(async () => {
    if (!company?.company_id) return;
    setLoading(true);
    const { data } = await listManagementTeam(company.company_id);
    setRows(data || []);
    setLoading(false);
  }, [company?.company_id]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e?.preventDefault?.();
    setBusy(true); setErr(null);
    const { error } = await addManagementTeamMember(company.company_id, email, tier);
    setBusy(false);
    if (error) { setErr(error.message || 'Could not add them'); return; }
    setEmail(''); setTier('MEMBER'); setOpen(false);
    load();
  };

  const remove = async (row) => {
    setBusy(true);
    const { error } = await removeManagementTeamMember(row.id);
    setBusy(false);
    // The database refuses removing the last owner — a company nobody can
    // administer, still engaged on every vessel — and says so better than a
    // guess made here would.
    if (error) { setErr(error.message || 'Could not remove them'); return; }
    setErr(null);
    load();
  };

  const live = rows.filter((r) => r.active);

  return (
    <ManagementShell>
      <div className="mgt">
        <p className="editorial-meta">
          <span className="dot">●</span><span>Management</span>
          <span className="bar" /><span className="muted">{company?.company_name || ''}</span>
          <span className="bar" />
          <span className="muted">{live.length} {live.length === 1 ? 'person' : 'people'}</span>
        </p>
        <h1 className="editorial-greeting">
          Team<span className="period">,</span> <em>at the office</em><span className="period">.</span>
        </h1>
        <p className="mgf-say">
          Everyone here reaches every vessel {company?.company_name || 'your company'} is engaged on, with
          whatever each vessel gave. What they do is recorded against their own name, which is the
          reason to add people individually rather than share one login.
          {company?.vessels != null && ` Currently ${company.vessels} ${company.vessels === 1 ? 'vessel' : 'vessels'}.`}
        </p>

        {mayRun && !open && (
          <button type="button" className="mgt-add" onClick={() => setOpen(true)}>
            <Icon name="Plus" size={14} /> Add someone
          </button>
        )}

        {open && (
          <form className="mgt-form" onSubmit={add}>
            <label className="mgt-field">
              <span>Their email <em className="req">required</em></span>
              <input type="email" value={email} autoFocus placeholder="tom@bluewater.com"
                onChange={(e) => { setEmail(e.target.value); setErr(null); }} />
            </label>
            <fieldset className="mgt-tiers">
              <legend>What they can do</legend>
              {TEAM_TIERS.map((t) => (
                <button key={t.key} type="button" aria-pressed={tier === t.key}
                  className={`mgt-tier${tier === t.key ? ' on' : ''}`} onClick={() => setTier(t.key)}>
                  <b>{t.label}</b><em>{t.note}</em>
                </button>
              ))}
            </fieldset>
            <div className="mgt-act">
              <button type="button" className="mgv-btn ghost"
                onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
              <button type="submit" className="mgv-btn primary" disabled={busy || !email.trim()}>
                {busy ? 'Adding…' : 'Add them'}
              </button>
            </div>
            {err && <p className="mgv-err"><Icon name="AlertCircle" size={14} /> {err}</p>}
          </form>
        )}

        {err && !open && <p className="mgv-err"><Icon name="AlertCircle" size={14} /> {err}</p>}

        {loading ? (
          <p className="mgv-empty">Loading…</p>
        ) : (
          <div className="mgt-rows">
            {rows.map((r) => (
              <div key={r.id} className={`mgt-row${r.active ? '' : ' is-off'}`}>
                <span className="mgt-who">
                  <b>{r.person_name || r.email}</b>
                  {r.person_name && <em>{r.email}</em>}
                </span>
                <span className="mgt-tierlab">{tierLabel(r.permission_tier)}</span>
                <span className={`mgt-state${r.has_login ? '' : ' pend'}`}>
                  {!r.active ? 'Removed' : r.has_login ? 'Signed up' : 'Not signed up yet'}
                </span>
                {mayRun && r.active ? (
                  <button type="button" className="mgt-go" disabled={busy} onClick={() => remove(r)}>
                    Remove
                  </button>
                ) : <span className="mgt-go" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </ManagementShell>
  );
}
