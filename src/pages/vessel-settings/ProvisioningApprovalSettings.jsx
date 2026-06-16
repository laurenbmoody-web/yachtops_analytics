import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import Icon from '../../components/AppIcon';
import '../provisioning/provisioning-dashboard.css';

// ── ProvisioningApprovalSettings ────────────────────────────────────────────
// Per-vessel approval routing for provisioning boards. Surfaces:
//   - 3 toggles: crew_to_dept_chief, hod_to_dept_chief, chief_to_command
//   - Per-department override picker (departments × dept-chief candidates)
//   - Command inbox multi-select (first id in the list is the explicit
//     target when chief_to_command is on; rest are advisory for PR5 UX)
//
// Persists `tenants.approval_routing jsonb`. Wrapping div carries the
// `pv-dashboard` class so the cool tokens light up.

const SECTION_DEFAULTS = {
  crew_to_dept_chief: true,
  hod_to_dept_chief:  true,
  chief_to_command:   true,
  dept_overrides:     {},
  command_inbox_user_ids: [],
};

const tierLabel = (t) => {
  const upper = String(t || '').toUpperCase();
  if (upper === 'COMMAND') return 'Command';
  if (upper === 'CHIEF')   return 'Chief';
  if (upper === 'HOD')     return 'HOD';
  if (upper === 'CREW')    return 'Crew';
  return upper || '—';
};

const memberLabel = (m) => {
  const name = m.full_name || (m.email ? m.email.split('@')[0] : 'Unnamed');
  return `${name} · ${tierLabel(m.permission_tier)}`;
};

export default function ProvisioningApprovalSettings({ tenantId }) {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [savedAt, setSavedAt]   = useState(null);

  const [routing, setRouting]   = useState(SECTION_DEFAULTS);
  const [initial, setInitial]   = useState(SECTION_DEFAULTS);
  const [departments, setDepartments] = useState([]); // [{ id, name }]
  const [members, setMembers]   = useState([]);       // [{ user_id, permission_tier, department_id, full_name, email }]

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        // tenants.approval_routing
        const { data: tenant, error: tErr } = await supabase
          ?.from('tenants')
          ?.select('approval_routing')
          ?.eq('id', tenantId)
          ?.maybeSingle();
        if (tErr) throw tErr;

        // departments — global table; filter to those used on this vessel
        // would be nicer but the seed list works for now.
        const { data: depts, error: dErr } = await supabase
          ?.from('departments')
          ?.select('id, name')
          ?.order('name');
        if (dErr) throw dErr;

        // active tenant members + their profile name for the dropdowns
        const { data: tms, error: mErr } = await supabase
          ?.from('tenant_members')
          ?.select('user_id, permission_tier, department_id, active')
          ?.eq('tenant_id', tenantId);
        if (mErr) throw mErr;
        const active = (tms || []).filter(tm => tm.active !== false);
        const userIds = active.map(tm => tm.user_id);
        let profiles = [];
        if (userIds.length > 0) {
          const { data: pData } = await supabase
            ?.from('profiles')
            ?.select('id, full_name, email')
            ?.in('id', userIds) || {};
          profiles = pData || [];
        }
        const enriched = active.map(tm => {
          const p = profiles.find(pp => pp.id === tm.user_id) || {};
          return {
            user_id: tm.user_id,
            permission_tier: tm.permission_tier,
            department_id: tm.department_id,
            full_name: p.full_name || null,
            email: p.email || null,
          };
        });

        if (cancelled) return;
        setDepartments(depts || []);
        setMembers(enriched);

        const raw = tenant?.approval_routing && typeof tenant.approval_routing === 'object'
          ? tenant.approval_routing
          : {};
        const merged = {
          ...SECTION_DEFAULTS,
          ...raw,
          dept_overrides: raw.dept_overrides && typeof raw.dept_overrides === 'object'
            ? raw.dept_overrides
            : {},
          command_inbox_user_ids: Array.isArray(raw.command_inbox_user_ids)
            ? raw.command_inbox_user_ids
            : [],
        };
        setRouting(merged);
        setInitial(merged);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load approval routing.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const isDirty = useMemo(
    () => JSON.stringify(routing) !== JSON.stringify(initial),
    [routing, initial],
  );

  const handleSave = async () => {
    if (!tenantId || !isDirty) return;
    setSaving(true);
    setError('');
    try {
      const { error: uErr } = await supabase
        ?.from('tenants')
        ?.update({ approval_routing: routing })
        ?.eq('id', tenantId);
      if (uErr) throw uErr;
      setInitial(routing);
      setSavedAt(new Date());
    } catch (err) {
      setError(err?.message || 'Failed to save approval routing.');
    } finally {
      setSaving(false);
    }
  };

  // Candidate approvers per department: members with that department_id
  // AND CHIEF or COMMAND tier (the people who can realistically own a
  // dept-scoped approval queue). Falls back to all CHIEF/COMMAND if the
  // dept has no scoped chief, so the dropdown is never empty.
  const candidatesForDept = (deptId) => {
    const seniors = members.filter(m => {
      const t = String(m.permission_tier || '').toUpperCase();
      return t === 'CHIEF' || t === 'COMMAND';
    });
    const scoped = seniors.filter(m => m.department_id === deptId);
    return scoped.length > 0 ? scoped : seniors;
  };

  const commandCandidates = members.filter(m =>
    String(m.permission_tier || '').toUpperCase() === 'COMMAND'
  );

  return (
    <div className="pv-dashboard pv-approval-settings">
      <header className="pv-approval-settings-head">
        <h2 className="pv-approval-settings-title">Provisioning approval routing</h2>
        <p className="pv-approval-settings-sub">
          Sets where Submit for Approval requests land for this vessel. Defaults send CREW and HOD
          submissions to the relevant department chief, and CHIEF submissions to Command.
        </p>
      </header>

      {loading ? (
        <p className="pv-approval-settings-status">Loading…</p>
      ) : error ? (
        <p className="pv-approval-settings-status pv-approval-settings-error">{error}</p>
      ) : (
        <>
          {/* ── Rules ─────────────────────────────────────────────────── */}
          <section className="pv-approval-card">
            <h3 className="pv-approval-card-title">Routing rules</h3>
            <ul className="pv-approval-rules">
              {[
                {
                  key: 'crew_to_dept_chief',
                  title: 'Crew → Department chief',
                  desc:  'Submissions from CREW-tier users route to the chief of their department.',
                },
                {
                  key: 'hod_to_dept_chief',
                  title: 'HOD → Department chief',
                  desc:  'HOD submissions also route to the dept chief (turn off if HODs should go straight to Command).',
                },
                {
                  key: 'chief_to_command',
                  title: 'Chief → Command',
                  desc:  'CHIEF submissions route to Command. Off means the submission falls through to the per-department override, then to any active Command member.',
                },
              ].map(rule => (
                <li key={rule.key} className="pv-approval-rule">
                  <button
                    type="button"
                    aria-pressed={!!routing[rule.key]}
                    className="pv-approval-rule-toggle"
                    onClick={() => setRouting(r => ({ ...r, [rule.key]: !r[rule.key] }))}
                  >
                    <span className={`pv-board-toggle-track${routing[rule.key] ? ' is-on' : ''}`}>
                      <span className="pv-board-toggle-knob" />
                    </span>
                  </button>
                  <div className="pv-approval-rule-text">
                    <div className="pv-approval-rule-title">{rule.title}</div>
                    <div className="pv-approval-rule-desc">{rule.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Department overrides ──────────────────────────────────── */}
          <section className="pv-approval-card">
            <h3 className="pv-approval-card-title">Department overrides</h3>
            <p className="pv-approval-card-sub">
              Force a specific approver per department. Wins over the routing rules above.
            </p>
            <table className="pv-approval-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Approver</th>
                </tr>
              </thead>
              <tbody>
                {departments.map(d => {
                  const current = routing.dept_overrides[d.name] || '';
                  const opts = candidatesForDept(d.id);
                  return (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td>
                        <select
                          className="pv-edit-modal-select"
                          value={current}
                          onChange={e => {
                            const v = e.target.value;
                            setRouting(r => {
                              const next = { ...(r.dept_overrides || {}) };
                              if (v) next[d.name] = v;
                              else delete next[d.name];
                              return { ...r, dept_overrides: next };
                            });
                          }}
                        >
                          <option value="">— Use routing rules —</option>
                          {opts.map(o => (
                            <option key={o.user_id} value={o.user_id}>
                              {memberLabel(o)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {departments.length === 0 && (
                  <tr><td colSpan={2}>No departments configured.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          {/* ── Command inbox ─────────────────────────────────────────── */}
          <section className="pv-approval-card">
            <h3 className="pv-approval-card-title">Command inbox</h3>
            <p className="pv-approval-card-sub">
              When Chief → Command is on, requests go to the first user listed here. Empty means any
              active Command member of the vessel.
            </p>
            <div className="pv-approval-chip-picker">
              {commandCandidates.length === 0 ? (
                <p className="pv-approval-settings-status">No active Command members on this vessel.</p>
              ) : commandCandidates.map(c => {
                const checked = routing.command_inbox_user_ids.includes(c.user_id);
                return (
                  <label
                    key={c.user_id}
                    className={`pv-approval-chip${checked ? ' is-on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setRouting(r => {
                          const set = new Set(r.command_inbox_user_ids || []);
                          if (set.has(c.user_id)) set.delete(c.user_id);
                          else set.add(c.user_id);
                          return { ...r, command_inbox_user_ids: Array.from(set) };
                        });
                      }}
                    />
                    <span>{memberLabel(c)}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* ── Footer ───────────────────────────────────────────────── */}
          <div className="pv-approval-foot">
            {savedAt && !isDirty && (
              <span className="pv-edit-modal-saved">Saved {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            <div className="pv-edit-modal-actions">
              <button
                type="button"
                className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
                disabled={!isDirty || saving}
                onClick={() => setRouting(initial)}
              >
                Revert
              </button>
              <button
                type="button"
                className="pv-edit-modal-btn pv-edit-modal-btn-primary"
                disabled={!isDirty || saving}
                onClick={handleSave}
              >
                {saving ? 'Saving…' : 'Save routing'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
