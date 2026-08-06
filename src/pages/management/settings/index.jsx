// The management company's own settings.
//
// Three questions an office actually has, in the order they ask them:
//
//   who are we        the firm's details, which the firm owns — six yachts
//                     should not each keep a stale copy of the phone number
//   what can we do    a plain table of what each tier may do, ending on the row
//                     that matters: nobody here can change what the crew entered
//   who trusts us     the vessels engaged, and what each chose to share. Read
//                     only, deliberately — that is the boat's decision, and
//                     saying so stops anyone hunting for a control that
//                     shouldn't exist
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ManagementLayout from '../components/ManagementLayout';
import useManagementCompany from '../../../hooks/useManagementCompany';
import { getManagementProfile, updateManagementCompany } from '../../../services/managementAccess';
import {
  TEAM_TIERS, TIER_POWERS, tierLabel, canRunTeam, describeScopes, engagementNote,
} from '../../../services/managementView';
import '../management.css';
import './settings.css';

const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

const FIELDS = [
  { key: 'name', label: 'Company name', placeholder: 'Blue Water Yacht Management', required: true },
  { key: 'contact_email', label: 'Contact email', placeholder: 'accounts@bluewater.com', type: 'email' },
  { key: 'phone', label: 'Phone', placeholder: '+377 00 00 00 00' },
  { key: 'website', label: 'Website', placeholder: 'bluewater.com' },
];

export default function ManagementSettings() {
  const { company } = useManagementCompany();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!company?.company_id) return;
    setLoading(true);
    const { data, error } = await getManagementProfile(company.company_id);
    if (error) { setErr(error.message || 'Could not load your company'); setLoading(false); return; }
    setProfile(data);
    setForm({
      name: data?.company?.name || '',
      contact_email: data?.company?.contact_email || '',
      phone: data?.company?.phone || '',
      website: data?.company?.website || '',
    });
    setLoading(false);
  }, [company?.company_id]);

  useEffect(() => { load(); }, [load]);

  const mayEdit = canRunTeam(profile?.my_tier);

  const save = async (e) => {
    e?.preventDefault?.();
    setBusy(true); setErr(null); setSaved(false);
    const { error } = await updateManagementCompany(company.company_id, form);
    setBusy(false);
    // The database owns uniqueness and permission — its wording is more accurate
    // than a guess made here.
    if (error) { setErr(error.message || 'Could not save'); return; }
    setSaved(true);
    load();
  };

  const engagements = profile?.engagements || [];

  return (
    <ManagementLayout
      eyebrow={`Management · ${tierLabel(profile?.my_tier)}`}
      title={<>Company<span className="accent">, and what it may do</span>.</>}
    >
      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}
      {saved && <div className="mg-banner good mb-4"><Icon name="Check" size={15} /> Saved</div>}

      {loading ? (
        <p className="ce-status">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* ── who we are ─────────────────────────────────────────────── */}
            <section className="ce-card rounded-xl p-5 lg:col-span-6">
              <div className="mgs-card-h">
                <span className="mgs-ic"><Icon name="Building2" size={17} /></span>
                <span className="mgs-card-t">
                  <b>Company details</b>
                  <em>{mayEdit ? 'Vessels see this when they engage you' : 'Only an owner or admin can change these'}</em>
                </span>
              </div>

              <form onSubmit={save}>
                {FIELDS.map((f) => (
                  <label key={f.key} className="mg-field">
                    <span>{f.label}{f.required && <em className="req">required</em>}</span>
                    <input type={f.type || 'text'} value={form[f.key] || ''} disabled={!mayEdit || busy}
                      placeholder={f.placeholder}
                      onChange={(e) => { setForm((c) => ({ ...c, [f.key]: e.target.value })); setSaved(false); setErr(null); }} />
                  </label>
                ))}
                {mayEdit && (
                  <div className="mgs-act">
                    <button type="submit" className="ce-btn-navy px-4 py-2 text-xs" disabled={busy || !form.name?.trim()}>
                      {busy ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                )}
              </form>

              <p className="mgs-note">
                On Cargo since {dmy(profile?.company?.created_at)} · {profile?.people}{' '}
                {profile?.people === 1 ? 'person' : 'people'} at the office
              </p>
            </section>

            {/* ── what we can do ─────────────────────────────────────────── */}
            <section className="ce-card rounded-xl p-5 lg:col-span-6">
              <div className="mgs-card-h">
                <span className="mgs-ic"><Icon name="ShieldCheck" size={17} /></span>
                <span className="mgs-card-t">
                  <b>What each role can do</b>
                  <em>Enforced by Cargo itself, not just hidden on screen</em>
                </span>
              </div>

              <div className="mgs-matrix">
                <div className="mgs-mrow is-head">
                  <span />
                  {TEAM_TIERS.map((t) => (
                    <span key={t.key} className={profile?.my_tier === t.key ? 'you' : ''}>
                      {t.label}
                      {profile?.my_tier === t.key && <em>you</em>}
                    </span>
                  ))}
                </div>
                {TIER_POWERS.map((p) => (
                  <div key={p.key} className={`mgs-mrow${p.tiers.length === 0 ? ' is-never' : ''}`}>
                    <span className="mgs-mlab">{p.label}</span>
                    {TEAM_TIERS.map((t) => (
                      <span key={t.key} className={profile?.my_tier === t.key ? 'you' : ''}>
                        {p.tiers.includes(t.key)
                          ? <Icon name="Check" size={15} className="yes" />
                          : <i className="no" />}
                      </span>
                    ))}
                  </div>
                ))}
              </div>

              <p className="mgs-note is-strong">
                The last row is the important one. Changing a crew member&rsquo;s entry isn&rsquo;t a
                permission anyone at a management company can be given — it doesn&rsquo;t exist in Cargo.
              </p>
            </section>

            {/* ── who trusts us ──────────────────────────────────────────── */}
            <section className="ce-card rounded-xl p-5 lg:col-span-12">
              <div className="mgs-card-h">
                <span className="mgs-ic"><Icon name="Anchor" size={17} /></span>
                <span className="mgs-card-t">
                  <b>Vessels you&rsquo;re engaged on</b>
                  <em>{engagementNote(engagements)}</em>
                </span>
              </div>

              {engagements.length === 0 ? (
                <p className="ce-status">Nothing yet — a captain engages you from their month-end page.</p>
              ) : (
                <div className="mgs-eng">
                  {engagements.map((e) => (
                    <div key={e.tenant_id} className={`mgs-engrow${e.active ? '' : ' is-off'}`}>
                      <span className="mgs-engn">
                        <b>{e.vessel_name}</b>
                        <em>Since {dmy(e.granted_at)}</em>
                      </span>
                      <span className="mgs-engs">{describeScopes(e.scopes)}</span>
                      <span className={`mgs-engst${e.active ? '' : ' off'}`}>
                        {e.active ? 'Active' : 'Ended'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
        </div>
      )}
    </ManagementLayout>
  );
}
