// The firm's own team.
//
// What per-person identity costs, and it's cheap: the office adds its own people
// instead of asking six captains to re-grant. A colleague can be added before
// they have a Cargo login — the row grants nothing until they sign in with that
// address — so hiring someone isn't a favour to request.
//
// Everyone sees their colleagues; only an owner or admin can change the list,
// which the database enforces regardless of what this page draws.
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ManagementLayout from '../components/ManagementLayout';
import useManagementCompany from '../../../hooks/useManagementCompany';
import {
  listManagementTeam, addManagementTeamMember, removeManagementTeamMember,
} from '../../../services/managementAccess';
import { TEAM_TIERS, tierLabel, canRunTeam } from '../../../services/managementView';
import '../management.css';
import './team.css';

const initials = (row) => {
  const src = row.person_name || row.email || '';
  const parts = src.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return (two || '?').toUpperCase();
};

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
    <ManagementLayout
      eyebrow={`Management · ${company?.company_name || ''}`}
      title={<>Team<span className="accent">, at the office</span>.</>}
      actions={mayRun && !open && (
        <button type="button" className="ce-action" onClick={() => setOpen(true)}>
          <Icon name="UserPlus" size={14} /> Add someone
        </button>
      )}
    >
      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          {open && (
            <form className="ce-card rounded-xl p-5 mb-4" onSubmit={add}>
              <h3 className="ce-title">Add a colleague</h3>
              <p className="ce-status mb-4">
                They reach every vessel {company?.company_name || 'you'} is engaged on. They can be
                added before they have a Cargo login.
              </p>

              <label className="mg-field">
                <span>Their email <em className="req">required</em></span>
                <input type="email" value={email} autoFocus placeholder="tom@bluewater.com"
                  onChange={(e) => { setEmail(e.target.value); setErr(null); }} />
              </label>

              <fieldset className="mgt-tiers">
                <legend className="ce-eyebrow">What they can do</legend>
                {TEAM_TIERS.map((t) => (
                  <button key={t.key} type="button" aria-pressed={tier === t.key}
                    className={`mgt-tier${tier === t.key ? ' on' : ''}`} onClick={() => setTier(t.key)}>
                    <span className="mgt-radio"><i /></span>
                    <span className="mgt-tier-t"><b>{t.label}</b><em>{t.note}</em></span>
                  </button>
                ))}
              </fieldset>

              <div className="flex justify-end gap-2 mt-5">
                <button type="button" className="ce-action" style={{ borderColor: 'var(--d-border)', color: 'var(--d-muted)' }}
                  onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
                <button type="submit" className="ce-btn-navy px-4 py-2 text-xs" disabled={busy || !email.trim()}>
                  {busy ? 'Adding…' : 'Add them'}
                </button>
              </div>
            </form>
          )}

          <div className="ce-card rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="ce-title">People</h3>
                <p className="ce-status">{live.length} at {company?.company_name || 'the office'}</p>
              </div>
            </div>

            {loading ? (
              <p className="ce-status">Loading…</p>
            ) : (
              <div className="mgt-list">
                {rows.map((r) => (
                  <div key={r.id} className={`mgt-row${r.active ? '' : ' is-off'}`}>
                    <span className={`mgt-av${r.has_login ? '' : ' pend'}`}>{initials(r)}</span>
                    <span className="mgt-who">
                      <b>{r.person_name || r.email}</b>
                      {r.person_name && <em>{r.email}</em>}
                    </span>
                    <span className="mgt-meta">
                      <span className={`mgt-pill${r.permission_tier === 'OWNER' ? ' owner' : ''}`}>
                        {tierLabel(r.permission_tier)}
                      </span>
                      {/* Only worth saying while it's still true — "signed up" on
                          every row is a column of noise. */}
                      {r.active && !r.has_login && <span className="mgt-pill warn">Not signed up</span>}
                      {!r.active && <span className="mgt-pill">Removed</span>}
                    </span>
                    {mayRun && r.active ? (
                      <button type="button" className="ce-link mgt-x" disabled={busy}
                        onClick={() => remove(r)}>Remove</button>
                    ) : <span className="mgt-x" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Why the office runs its own list, said once where it's relevant. */}
        <div className="lg:col-span-4">
          <div className="ce-card rounded-xl p-5">
            <h3 className="ce-title">Why individually?</h3>
            <p className="ce-status mb-3">Rather than one shared office login.</p>
            <p className="text-sm" style={{ color: 'var(--d-muted)', lineHeight: 1.65 }}>
              Everything anyone here does is recorded against their own name. When a month is
              signed off, the vessel and the owner see <em>who</em> signed it — not a shared
              mailbox. That record is the point of the whole arrangement.
            </p>
            <p className="text-sm mt-3" style={{ color: 'var(--d-muted)', lineHeight: 1.65 }}>
              Adding someone costs nothing and needs no captain&rsquo;s permission — they inherit
              the vessels {company?.company_name || 'your company'} is already engaged on.
            </p>
          </div>
        </div>
      </div>
    </ManagementLayout>
  );
}
