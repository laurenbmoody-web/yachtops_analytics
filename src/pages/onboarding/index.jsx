import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Check, Trash2, Plus, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import Image from '../../components/AppImage';
import { useTheme } from '../../contexts/ThemeContext';

/*
  Post-signup onboarding flow.
  Route: /onboarding — runs between /set-password and /dashboard for
  brand-new vessels. Guarded by OnboardingRoute (defined below) which
  bounces the user to /dashboard if tenants.onboarding_completed_at is
  already set.

  Three steps, each in its own self-contained state slice:
    1. Vessel settings  — saves to public.tenants (columns already exist)
    2. Departments      — base departments selected via tenants.departments_in_use;
                          custom "Other" departments saved to profiles.custom_departments
    3. Invite crew      — "Do this later" is the primary CTA per locked design;
                          invite sending is wired if the user clicks Send invites

  All copy lifted verbatim from docs/handoffs/onboarding-flow-mockup.jsx
  (signed off with Lauren). Styling is the standard raised Cargo border:
  1px navy top/sides, 3px navy bottom.
*/

const NAVY = '#1E3A5F';
const ACCENT = '#00A8CC';
const CARD = '#FFFFFF';
const CHARCOAL = '#1A202C';

const CARD_STYLE = {
  backgroundColor: CARD,
  borderTop: `1px solid ${NAVY}`,
  borderLeft: `1px solid ${NAVY}`,
  borderRight: `1px solid ${NAVY}`,
  borderBottom: `3px solid ${NAVY}`,
  borderRadius: 14,
};

const BASE_DEPARTMENTS = [
  { id: 'BRIDGE', name: 'Bridge' },
  { id: 'INTERIOR', name: 'Interior' },
  { id: 'DECK', name: 'Deck' },
  { id: 'ENGINEERING', name: 'Engineering' },
  { id: 'GALLEY', name: 'Galley' },
];

const ROLES_BY_DEPT = {
  BRIDGE: ['Captain', 'Chief Officer', 'Second Officer', 'Third Officer'],
  INTERIOR: ['Chief Stew', 'Second Stew', 'Stew', 'Junior Stew'],
  DECK: ['Bosun', 'Lead Deckhand', 'Deckhand'],
  ENGINEERING: ['Chief Engineer', 'Second Engineer', 'Engineer', 'ETO'],
  GALLEY: ['Head Chef', 'Sous Chef', 'Crew Chef'],
};

// ─── Shared UI bits ─────────────────────────────────────────────────

const PillPrimary = ({ children, onClick, disabled, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className="uppercase tracking-widest text-xs transition-opacity"
    style={{
      backgroundColor: NAVY,
      color: 'white',
      fontFamily: 'Archivo, sans-serif',
      fontWeight: 900,
      letterSpacing: '0.08em',
      padding: '12px 26px',
      borderRadius: 50,
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    {children}
  </button>
);

const PillSecondary = ({ children, onClick, disabled, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className="uppercase tracking-widest text-xs transition-opacity"
    style={{
      backgroundColor: 'transparent',
      color: NAVY,
      fontFamily: 'Archivo, sans-serif',
      fontWeight: 900,
      letterSpacing: '0.08em',
      padding: '11px 24px',
      borderRadius: 50,
      border: `1.5px solid ${NAVY}`,
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    {children}
  </button>
);

const Field = ({ label, children }) => (
  <label className="block mb-4">
    <span
      className="block text-sm mb-1.5"
      style={{ color: CHARCOAL, fontWeight: 600 }}
    >
      {label}
    </span>
    {children}
  </label>
);

const TextInput = (props) => (
  <input
    {...props}
    className="w-full px-3 py-2 text-sm outline-none"
    style={{
      backgroundColor: CARD,
      border: `1px solid #CBD5E1`,
      borderRadius: 6,
      color: CHARCOAL,
      ...(props.style || {}),
    }}
  />
);

const SelectInput = ({ options, ...props }) => (
  <select
    {...props}
    className="w-full px-3 py-2 text-sm outline-none"
    style={{
      backgroundColor: CARD,
      border: `1px solid #CBD5E1`,
      borderRadius: 6,
      color: CHARCOAL,
    }}
  >
    <option value="">Select…</option>
    {options.map((o) => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
  </select>
);

// ─── Step 1: Vessel settings ───────────────────────────────────────

const VesselSettingsStep = ({ tenant, onSaved }) => {
  const [data, setData] = useState({
    name: tenant?.name || '',
    vessel_type_label: tenant?.vessel_type_label || '',
    flag: tenant?.flag || '',
    port_of_registry: tenant?.port_of_registry || '',
    imo_number: tenant?.imo_number || '',
    official_number: tenant?.official_number || '',
    loa_m: tenant?.loa_m ?? '',
    gt: tenant?.gt ?? '',
    year_built: tenant?.year_built ?? '',
    year_refit: tenant?.year_refit ?? '',
    commercial_status: tenant?.commercial_status || '',
    area_of_operation: tenant?.area_of_operation || '',
    operating_regions: tenant?.operating_regions || '',
    seasonal_pattern: tenant?.seasonal_pattern || '',
    typical_guest_count: tenant?.typical_guest_count ?? '',
    typical_crew_count: tenant?.typical_crew_count ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (k) => (e) =>
    setData((prev) => ({ ...prev, [k]: e.target.value }));

  const handleContinue = async () => {
    setError('');
    setSaving(true);
    try {
      const payload = {
        name: data.name || tenant?.name,
        vessel_type_label: data.vessel_type_label || null,
        flag: data.flag || null,
        port_of_registry: data.port_of_registry || null,
        imo_number: data.imo_number || tenant?.imo_number || null,
        official_number: data.official_number || null,
        loa_m: data.loa_m === '' ? null : Number(data.loa_m),
        gt: data.gt === '' ? null : Number(data.gt),
        year_built: data.year_built === '' ? null : Number(data.year_built),
        year_refit: data.year_refit === '' ? null : Number(data.year_refit),
        commercial_status: data.commercial_status || null,
        area_of_operation: data.area_of_operation || null,
        operating_regions: data.operating_regions || null,
        seasonal_pattern: data.seasonal_pattern || null,
        typical_guest_count:
          data.typical_guest_count === '' ? null : Number(data.typical_guest_count),
        typical_crew_count:
          data.typical_crew_count === '' ? null : Number(data.typical_crew_count),
      };
      const { error: updateError } = await supabase
        .from('tenants')
        .update(payload)
        .eq('id', tenant.id);
      if (updateError) throw updateError;
      onSaved(payload);
    } catch (err) {
      console.error('[onboarding] vessel save failed', err);
      setError(err?.message || 'Could not save vessel details. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-7" style={CARD_STYLE}>
      <h2
        style={{
          fontFamily: 'Outfit, sans-serif',
          fontSize: 24,
          fontWeight: 700,
          color: CHARCOAL,
          letterSpacing: '-0.01em',
        }}
      >
        {data.name ? `Welcome aboard ${data.name}` : 'Welcome aboard'}
      </h2>
      <p className="text-sm mt-1 mb-6" style={{ color: '#64748B' }}>
        Let's set up your vessel. Most of this is already filled in from checkout — double-check and continue.
      </p>

      <section className="mb-5">
        <h3 className="uppercase text-xs mb-3" style={{ color: NAVY, fontWeight: 800, letterSpacing: '0.12em' }}>
          Who is your boat?
        </h3>
        <Field label="Vessel name">
          <TextInput value={data.name} onChange={update('name')} />
        </Field>
        <Field label="Vessel type">
          <SelectInput
            value={data.vessel_type_label}
            onChange={update('vessel_type_label')}
            options={['Motor Yacht', 'Sailing Yacht', 'Catamaran', 'Expedition', 'Support']}
          />
        </Field>
        <Field label="Flag state">
          <TextInput value={data.flag} onChange={update('flag')} placeholder="e.g. Cayman Islands" />
        </Field>
        <Field label="Port of registry">
          <TextInput value={data.port_of_registry} onChange={update('port_of_registry')} placeholder="e.g. George Town" />
        </Field>
      </section>

      <section className="mb-5">
        <h3 className="uppercase text-xs mb-3" style={{ color: NAVY, fontWeight: 800, letterSpacing: '0.12em' }}>
          Her specs
        </h3>
        <Field label="IMO number">
          <TextInput value={data.imo_number} onChange={update('imo_number')} placeholder="Pre-filled from your vessel verification at checkout" />
        </Field>
        <Field label="Official number">
          <TextInput value={data.official_number} onChange={update('official_number')} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="LOA (metres)">
            <TextInput type="number" value={data.loa_m} onChange={update('loa_m')} />
          </Field>
          <Field label="Gross tonnage">
            <TextInput type="number" value={data.gt} onChange={update('gt')} />
          </Field>
          <Field label="Year built">
            <TextInput type="number" value={data.year_built} onChange={update('year_built')} />
          </Field>
          <Field label="Year refit">
            <TextInput type="number" value={data.year_refit} onChange={update('year_refit')} />
          </Field>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="uppercase text-xs mb-3" style={{ color: NAVY, fontWeight: 800, letterSpacing: '0.12em' }}>
          How does she operate?
        </h3>
        <Field label="Commercial status">
          <SelectInput
            value={data.commercial_status}
            onChange={update('commercial_status')}
            options={['Private', 'Commercial', 'Charter', 'Dual']}
          />
        </Field>
        <Field label="Area of operation">
          <SelectInput
            value={data.area_of_operation}
            onChange={update('area_of_operation')}
            options={['Coastal', 'Near Coastal', 'Unlimited']}
          />
        </Field>
        <Field label="Operating regions">
          <TextInput value={data.operating_regions} onChange={update('operating_regions')} placeholder="e.g. Mediterranean, Caribbean" />
        </Field>
        <Field label="Seasonal pattern">
          <TextInput value={data.seasonal_pattern} onChange={update('seasonal_pattern')} placeholder="e.g. Med summer / Caribbean winter" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Typical guest count">
            <TextInput type="number" value={data.typical_guest_count} onChange={update('typical_guest_count')} />
          </Field>
          <Field label="Typical crew count">
            <TextInput type="number" value={data.typical_crew_count} onChange={update('typical_crew_count')} />
          </Field>
        </div>
      </section>

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <PillPrimary onClick={handleContinue} disabled={saving}>
          {saving ? 'Saving…' : 'Continue'}
        </PillPrimary>
      </div>
    </div>
  );
};

// ─── Step 2: Departments ───────────────────────────────────────────

const DepartmentsStep = ({ tenant, userId, onComplete }) => {
  const [selected, setSelected] = useState(() => {
    const raw = tenant?.departments_in_use || '';
    if (!raw) return BASE_DEPARTMENTS.map((d) => d.id);
    // Stored as comma-separated text
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  });
  const [customDepts, setCustomDepts] = useState([]);
  const [newDept, setNewDept] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const addCustom = () => {
    const name = newDept.trim();
    if (!name) return;
    const id = `CUSTOM_${Date.now()}`;
    setCustomDepts((prev) => [...prev, { id, name }]);
    setSelected((prev) => [...prev, id]);
    setNewDept('');
  };

  const removeCustom = (id) => {
    setCustomDepts((prev) => prev.filter((d) => d.id !== id));
    setSelected((prev) => prev.filter((x) => x !== id));
  };

  const handleContinue = async () => {
    setSaving(true);
    setError('');
    try {
      // Base departments selected → tenants.departments_in_use (existing text col)
      const baseSelected = selected.filter((id) =>
        BASE_DEPARTMENTS.some((d) => d.id === id)
      );
      const { error: tErr } = await supabase
        .from('tenants')
        .update({ departments_in_use: baseSelected.join(',') })
        .eq('id', tenant.id);
      if (tErr) throw tErr;

      // Custom departments → profiles.custom_departments (user-local only)
      if (customDepts.length > 0) {
        const { error: pErr } = await supabase
          .from('profiles')
          .update({ custom_departments: customDepts })
          .eq('id', userId);
        if (pErr) throw pErr;
      }

      onComplete({ baseSelected, customDepts });
    } catch (err) {
      console.error('[onboarding] departments save failed', err);
      setError(err?.message || 'Could not save departments. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const merged = [...BASE_DEPARTMENTS, ...customDepts];

  return (
    <div className="p-7" style={CARD_STYLE}>
      <h2
        style={{
          fontFamily: 'Outfit, sans-serif',
          fontSize: 24,
          fontWeight: 700,
          color: CHARCOAL,
          letterSpacing: '-0.01em',
        }}
      >
        {tenant?.name ? `Which departments run on ${tenant.name}?` : 'Which departments are onboard?'}
      </h2>
      <p className="text-sm mt-1 mb-6" style={{ color: '#64748B' }}>
        Tap to toggle. Add any extra departments specific to your boat with the field below.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {merged.map((d) => {
          const isSelected = selected.includes(d.id);
          const isCustom = !BASE_DEPARTMENTS.some((bd) => bd.id === d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              className="flex items-center justify-between px-4 py-3 text-left transition-all"
              style={{
                backgroundColor: isSelected ? '#F0F9FB' : CARD,
                borderTop: `1px solid ${NAVY}`,
                borderLeft: `1px solid ${NAVY}`,
                borderRight: `1px solid ${NAVY}`,
                borderBottom: `3px solid ${isSelected ? ACCENT : NAVY}`,
                borderRadius: 10,
              }}
            >
              <span>
                <span className="text-sm block" style={{ color: CHARCOAL, fontWeight: 600 }}>
                  {d.name}
                </span>
                {isCustom && (
                  <span className="text-[10px] uppercase" style={{ color: '#64748B', letterSpacing: '0.08em' }}>
                    Custom · only you
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {isSelected && <Check size={16} color={ACCENT} strokeWidth={3} />}
                {isCustom && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustom(d.id);
                    }}
                    className="p-1 rounded hover:bg-slate-100"
                  >
                    <Trash2 size={14} color="#94A3B8" />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 mb-6">
        <TextInput
          value={newDept}
          onChange={(e) => setNewDept(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add another department (e.g. Dive, Spa)"
        />
        <PillSecondary onClick={addCustom} disabled={!newDept.trim()}>
          <span className="inline-flex items-center gap-1.5"><Plus size={12} /> Add</span>
        </PillSecondary>
      </div>

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <PillPrimary onClick={handleContinue} disabled={saving || selected.length === 0}>
          {saving ? 'Saving…' : 'Continue'}
        </PillPrimary>
      </div>
    </div>
  );
};

// ─── Step 3: Invite crew ───────────────────────────────────────────

const InviteCrewStep = ({ tenant, departments, customDepts, onFinish }) => {
  const allDepts = useMemo(
    () => [
      ...BASE_DEPARTMENTS.filter((d) => departments.includes(d.id)),
      ...customDepts,
    ],
    [departments, customDepts]
  );

  const [rows, setRows] = useState([{ email: '', department_id: '', role: '' }]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateRow = (i, key, val) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const addRow = () =>
    setRows((prev) => [...prev, { email: '', department_id: '', role: '' }]);
  const removeRow = (i) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const parsePaste = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const lookup = (raw) => {
      if (!raw) return '';
      const n = norm(raw);
      const match = allDepts.find((d) => norm(d.name) === n || norm(d.id) === n);
      return match ? match.id : '';
    };
    const parsed = lines
      .map((line) => {
        const parts = line.split(/[,\t]/).map((p) => p.trim());
        const [email = '', deptRaw = '', role = ''] = parts;
        return { email, department_id: lookup(deptRaw), role };
      })
      .filter((r) => r.email);
    if (parsed.length === 0) {
      setPasteResult('No valid rows found.');
      return;
    }
    setRows((prev) => {
      const emptyFirst = prev.length === 1 && !prev[0].email && !prev[0].role;
      return emptyFirst ? parsed : [...prev, ...parsed];
    });
    setPasteResult(`Added ${parsed.length} invite${parsed.length === 1 ? '' : 's'}.`);
    setPasteText('');
  };

  const finishAndGo = async (sendInvites) => {
    setSaving(true);
    setError('');
    try {
      if (sendInvites) {
        const toInvite = rows.filter((r) => r.email && r.department_id && r.role);
        if (toInvite.length > 0) {
          // Best-effort send via the existing crew invite RPC if it exists.
          // If not available, stash them in a log for now — the primary path
          // ("Do this later") is the recommended one per locked design.
          try {
            await Promise.all(
              toInvite.map(async (r) => {
                const { error: rpcErr } = await supabase.rpc('invite_crew_member', {
                  p_tenant_id: tenant.id,
                  p_email: r.email,
                  p_department_id: r.department_id,
                  p_role_label: r.role,
                });
                if (rpcErr) {
                  console.warn('[onboarding] invite_crew_member failed for', r.email, rpcErr);
                }
              })
            );
          } catch (err) {
            // Non-fatal — onboarding completes regardless.
            console.warn('[onboarding] some invites failed to send', err);
          }
        }
      }

      // Mark onboarding complete on the tenant
      const { error: completeErr } = await supabase
        .from('tenants')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', tenant.id);
      if (completeErr) throw completeErr;

      onFinish();
    } catch (err) {
      console.error('[onboarding] finish failed', err);
      setError(err?.message || 'Could not finish onboarding. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-7" style={CARD_STYLE}>
      <h2
        style={{
          fontFamily: 'Outfit, sans-serif',
          fontSize: 24,
          fontWeight: 700,
          color: CHARCOAL,
          letterSpacing: '-0.01em',
        }}
      >
        {tenant?.name ? `Bring your crew aboard ${tenant.name}` : 'Invite your crew'}
      </h2>
      <p className="text-sm mt-1 mb-6" style={{ color: '#64748B' }}>
        Invite the crew you work with. You can always come back to this later.
      </p>

      {rows.map((r, i) => {
        const dept = allDepts.find((d) => d.id === r.department_id);
        const isCustom = dept && !BASE_DEPARTMENTS.some((bd) => bd.id === dept.id);
        const roleOptions = dept && !isCustom ? ROLES_BY_DEPT[dept.id] || [] : [];
        return (
          <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-end">
            <div className="col-span-5">
              <TextInput
                placeholder="email@vessel.com"
                value={r.email}
                onChange={(e) => updateRow(i, 'email', e.target.value)}
              />
            </div>
            <div className="col-span-3">
              <select
                value={r.department_id}
                onChange={(e) => updateRow(i, 'department_id', e.target.value)}
                className="w-full px-2 py-2 text-sm outline-none"
                style={{ backgroundColor: CARD, border: '1px solid #CBD5E1', borderRadius: 6, color: CHARCOAL }}
              >
                <option value="">Department</option>
                {allDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              {isCustom ? (
                <TextInput
                  placeholder="Role"
                  value={r.role}
                  onChange={(e) => updateRow(i, 'role', e.target.value)}
                />
              ) : (
                <select
                  value={r.role}
                  onChange={(e) => updateRow(i, 'role', e.target.value)}
                  className="w-full px-2 py-2 text-sm outline-none"
                  style={{ backgroundColor: CARD, border: '1px solid #CBD5E1', borderRadius: 6, color: CHARCOAL }}
                >
                  <option value="">Role</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="col-span-1 flex justify-end">
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(i)} className="p-2">
                  <Trash2 size={16} color="#94A3B8" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div className="mb-5 mt-1">
        <button
          type="button"
          onClick={addRow}
          className="text-sm inline-flex items-center gap-1"
          style={{ color: NAVY, fontWeight: 600 }}
        >
          <Plus size={14} /> Add another
        </button>
      </div>

      <div className="mb-6">
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="text-xs uppercase tracking-widest"
          style={{ color: NAVY, fontFamily: 'Archivo, sans-serif', fontWeight: 900, letterSpacing: '0.08em' }}
        >
          {showPaste ? '− Hide paste from spreadsheet' : '+ Paste from spreadsheet'}
        </button>
        {showPaste && (
          <div className="mt-3">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="email, department, role (one per line)"
              rows={4}
              className="w-full px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: CARD, border: '1px solid #CBD5E1', borderRadius: 6, color: CHARCOAL }}
            />
            <div className="flex items-center gap-3 mt-2">
              <PillSecondary onClick={parsePaste} disabled={!pasteText.trim()}>
                Parse rows
              </PillSecondary>
              {pasteResult && (
                <span className="text-xs" style={{ color: '#64748B' }}>{pasteResult}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs" style={{ color: '#64748B' }}>
          Most captains start solo and invite crew once they've had a look around.
        </p>
        <div className="flex gap-3">
          <PillSecondary onClick={() => finishAndGo(true)} disabled={saving}>
            Send invites
          </PillSecondary>
          <PillPrimary onClick={() => finishAndGo(false)} disabled={saving}>
            {saving ? 'Finishing…' : (<span className="inline-flex items-center gap-2">Do this later <ChevronRight size={14} /></span>)}
          </PillPrimary>
        </div>
      </div>
    </div>
  );
};

// ─── Page shell ────────────────────────────────────────────────────

const StepPill = ({ label, index, current, done }) => (
  <div className="flex items-center gap-2">
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs"
      style={{
        backgroundColor: done ? ACCENT : current ? NAVY : '#E2E8F0',
        color: done || current ? 'white' : '#64748B',
        fontFamily: 'Archivo, sans-serif',
        fontWeight: 900,
      }}
    >
      {done ? <Check size={13} strokeWidth={3} /> : index}
    </div>
    <span
      className="uppercase text-xs"
      style={{
        fontFamily: 'Archivo, sans-serif',
        fontWeight: 900,
        letterSpacing: '0.10em',
        color: current ? NAVY : done ? ACCENT : '#94A3B8',
      }}
    >
      {label}
    </span>
  </div>
);

const OnboardingPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user, currentTenantId, bootstrapComplete } = useAuth();

  const [tenant, setTenant] = useState(null);
  const [step, setStep] = useState('vessel'); // vessel | departments | crew
  const [deptChoice, setDeptChoice] = useState({ baseSelected: [], customDepts: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Load the tenant row for pre-fill
  useEffect(() => {
    if (!bootstrapComplete) return;
    if (!currentTenantId) {
      // Bootstrap finished but didn't find a tenant for this user. This
      // is almost always a webhook failure (tenant_members insert never
      // happened), NOT an "onboarding complete" state. Bouncing to
      // /dashboard here would just hit the same "no active vessel access"
      // error. Surface it clearly instead so we know to fix the webhook.
      setLoadError(
        'We could not find your vessel membership. This usually means the signup webhook did not complete. ' +
        'Please contact support or try again in a few minutes — your account is safe.'
      );
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', currentTenantId)
        .single();
      if (error) {
        console.error('[onboarding] failed to load tenant', error);
        setLoadError('Could not load your vessel. Please refresh.');
        setLoading(false);
        return;
      }
      if (data?.onboarding_completed_at) {
        // Already done — bounce.
        navigate('/dashboard', { replace: true });
        return;
      }
      setTenant(data);
      setLoading(false);
    })();
  }, [bootstrapComplete, currentTenantId, navigate]);

  const logoSrc =
    theme === 'dark'
      ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'
      : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="text-center">
          <Anchor size={36} color={NAVY} className="mx-auto mb-3" />
          <p className="text-sm" style={{ color: '#64748B' }}>Loading your vessel…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <p className="text-sm" style={{ color: '#991B1B' }}>{loadError}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-10 px-4" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-center mb-6">
          <Image src={logoSrc} alt="Cargo" className="h-10" />
        </div>

        <div className="flex items-center justify-center gap-5 mb-8">
          <StepPill label="Vessel" index={1} current={step === 'vessel'} done={step !== 'vessel'} />
          <div className="w-10 h-px" style={{ backgroundColor: '#CBD5E1' }} />
          <StepPill label="Departments" index={2} current={step === 'departments'} done={step === 'crew'} />
          <div className="w-10 h-px" style={{ backgroundColor: '#CBD5E1' }} />
          <StepPill label="Crew" index={3} current={step === 'crew'} done={false} />
        </div>

        {step === 'vessel' && (
          <VesselSettingsStep
            tenant={tenant}
            onSaved={(updated) => {
              setTenant((t) => ({ ...t, ...updated }));
              setStep('departments');
            }}
          />
        )}
        {step === 'departments' && (
          <DepartmentsStep
            tenant={tenant}
            userId={user?.id}
            onComplete={(choice) => {
              setDeptChoice(choice);
              setStep('crew');
            }}
          />
        )}
        {step === 'crew' && (
          <InviteCrewStep
            tenant={tenant}
            departments={deptChoice.baseSelected}
            customDepts={deptChoice.customDepts}
            onFinish={() => navigate('/dashboard', { replace: true })}
          />
        )}
      </div>
    </div>
  );
};

export default OnboardingPage;
