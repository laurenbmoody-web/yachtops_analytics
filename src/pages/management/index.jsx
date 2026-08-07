// The shore office's dashboard — where a management login lands.
//
// Built like the crew's overview: three columns of widgets, each one holding
// something worth reading on its own. The previous version was three stat tiles
// and a single vessel card, which on a one-boat fleet was mostly white space —
// a dashboard has to be worth opening before the fleet grows.
//
// Column shape follows pages/dashboard/index.jsx: 3 / 6 / 3 on large screens.
//   left    the work queue — what is waiting on you, what you sent back
//   centre  the fleet itself, and what it adds up to
//   right   your office — the team, the company
//
// The vessels are ordered by what needs the office today rather than
// alphabetically (managementView.sortFleet), and this page stays the front door
// on purpose: with a dozen yachts, two of them called Serenity, arriving INSIDE
// one is how a month gets signed off on the wrong boat.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import ManagementLayout from './components/ManagementLayout';
import useManagementCompany from '../../hooks/useManagementCompany';
import { listManagedVessels } from '../../services/managementService';
import { listManagementTeam, getManagementProfile } from '../../services/managementAccess';
import { sortFleet, describeScopes, tierLabel, canRunTeam } from '../../services/managementView';
import './management.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodLabel = (iso) => {
  if (!iso) return '';
  const [y, m] = String(iso).slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

// Two letters to tell two yachts apart at a glance.
const monogram = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2);
  return two.toUpperCase();
};
const initialsOf = (s) => {
  const parts = String(s || '').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(s || '?').slice(0, 2);
  return two.toUpperCase();
};

export default function ManagementFleet() {
  const navigate = useNavigate();
  const { company } = useManagementCompany();
  const [fleet, setFleet] = useState([]);
  const [team, setTeam] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await listManagedVessels();
      if (!live) return;
      if (error) setErr(error.message || 'Could not load your vessels');
      setFleet(sortFleet(data));
      setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  // The office's own side of the page. Failures here cost a widget, not the
  // dashboard, so they are swallowed rather than shown as a page error.
  useEffect(() => {
    if (!company?.company_id) return undefined;
    let live = true;
    listManagementTeam(company.company_id).then(({ data }) => { if (live) setTeam(data || []); });
    getManagementProfile(company.company_id).then(({ data }) => { if (live) setProfile(data); });
    return () => { live = false; };
  }, [company?.company_id]);

  const sum = (k) => fleet.reduce((n, v) => n + (v[k] || 0), 0);
  const waiting = sum('awaiting_signoff');
  const queried = sum('queried');
  const done = sum('signed_off');

  const needs = fleet.filter((v) => (v.awaiting_signoff || 0) > 0);
  const back = fleet.filter((v) => (v.queried || 0) > 0);
  const liveTeam = team.filter((t) => t.active);

  return (
    <ManagementLayout
      eyebrow={`Management · ${company?.company_name || ''}`}
      title={<>Fleet<span className="accent">, {waiting ? 'waiting on you' : 'in order'}</span>.</>}
      lede={waiting
        ? `${waiting} ${waiting === 1 ? 'month' : 'months'} closed and waiting on your signature across ${needs.length} ${needs.length === 1 ? 'vessel' : 'vessels'}.`
        : 'Nothing waiting on you. Months appear here as vessels close them.'}
    >
      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── LEFT: the work queue ─────────────────────────────────────── */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="ce-card rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="ce-title">To sign off</h3>
                <p className={`ce-status${waiting ? ' is-attention' : ''}`}>
                  {waiting ? `${waiting} waiting` : 'Nothing waiting'}
                </p>
              </div>
              <span className="mg-count">{waiting}</span>
            </div>

            {needs.length === 0 ? (
              <p className="mg-quiet">Months a vessel has closed land here.</p>
            ) : (
              <div className="mg-queue">
                {needs.map((v) => (
                  <button key={v.tenant_id} type="button" className="mg-queue-row"
                    onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                    <span className="mg-mono sm need">{monogram(v.vessel_name)}</span>
                    <span className="t">
                      <b>{v.vessel_name}</b>
                      <em>{v.awaiting_signoff} {v.awaiting_signoff === 1 ? 'month' : 'months'}
                        {v.latest_period ? ` · to ${periodLabel(v.latest_period)}` : ''}</em>
                    </span>
                    <Icon name="ChevronRight" size={15} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ce-card rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="ce-title">Sent back</h3>
                <p className="ce-status">{queried ? `${queried} with the crew` : 'None outstanding'}</p>
              </div>
              <span className="mg-count">{queried}</span>
            </div>
            {back.length === 0 ? (
              <p className="mg-quiet">Months you query go back to the vessel and show here until they re-close them.</p>
            ) : (
              <div className="mg-queue">
                {back.map((v) => (
                  <button key={v.tenant_id} type="button" className="mg-queue-row"
                    onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                    <span className="mg-mono sm query">{monogram(v.vessel_name)}</span>
                    <span className="t">
                      <b>{v.vessel_name}</b>
                      <em>{v.queried} awaiting the crew</em>
                    </span>
                    <Icon name="ChevronRight" size={15} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── CENTRE: the fleet ────────────────────────────────────────── */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <div className="ce-card rounded-xl p-5">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="ce-title">Your fleet</h3>
                <p className="ce-status">
                  {fleet.length} {fleet.length === 1 ? 'vessel' : 'vessels'} engaged with {company?.company_name || 'you'}
                </p>
              </div>
              {canRunTeam(company?.permission_tier) && (
                <button type="button" className="ce-link" onClick={() => navigate('/management/settings')}>
                  Engagements
                </button>
              )}
            </div>

            {loading ? (
              <div className="mg-ghost rounded-lg" style={{ minHeight: 120 }} />
            ) : fleet.length === 0 ? (
              <div className="text-center py-8">
                <div className="mg-empty-ic"><Icon name="Anchor" size={22} /></div>
                <h4 className="ce-title mt-3" style={{ fontSize: 18 }}>No vessels yet</h4>
                {/* The office cannot help itself to a boat — a captain engages
                    the firm — so this says who to ask, not what to click. */}
                <p className="ce-status mx-auto" style={{ maxWidth: '40ch' }}>
                  A vessel appears once its captain engages {company?.company_name || 'your company'} from
                  their month-end page.
                </p>
              </div>
            ) : (
              <div className="mg-fleet">
                {fleet.map((v) => {
                  const n = v.awaiting_signoff || 0;
                  const q = v.queried || 0;
                  const tone = n ? 'need' : (q ? 'query' : '');
                  return (
                    <button key={`${v.tenant_id}-${v.company_id}`} type="button" className="mg-fleet-row"
                      onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                      <span className={`mg-mono ${tone}`}>{monogram(v.vessel_name)}</span>
                      <span className="t">
                        <b>{v.vessel_name}</b>
                        <em>{describeScopes(v.scopes)}</em>
                      </span>
                      <span className="m">
                        <span className={`mg-tag ${tone}`}>
                          {n > 0 ? `${n} to sign off` : q > 0 ? `${q} sent back` : 'Up to date'}
                        </span>
                        <em>{v.latest_period ? `Through ${periodLabel(v.latest_period)}` : 'No closed months'}</em>
                      </span>
                      <Icon name="ChevronRight" size={17} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ce-card rounded-xl p-5">
            <h3 className="ce-title">Across the fleet</h3>
            <p className="ce-status mb-4">Every month these vessels have closed</p>
            <div className="mg-tiles">
              <div className="mg-tile">
                <span className="mg-tile-n" style={{ color: waiting ? 'var(--d-orange)' : undefined }}>{waiting}</span>
                <span className="mg-tile-l">To sign off</span>
              </div>
              <div className="mg-tile">
                <span className="mg-tile-n">{queried}</span>
                <span className="mg-tile-l">Sent back</span>
              </div>
              <div className="mg-tile">
                <span className="mg-tile-n">{done}</span>
                <span className="mg-tile-l">Signed off</span>
              </div>
              <div className="mg-tile">
                <span className="mg-tile-n">{fleet.length}</span>
                <span className="mg-tile-l">Vessels</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: your office ───────────────────────────────────────── */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="ce-card rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="ce-title">Your team</h3>
                <p className="ce-status">{liveTeam.length} at the office</p>
              </div>
              <button type="button" className="ce-link" onClick={() => navigate('/management/team')}>
                {canRunTeam(company?.permission_tier) ? 'Manage' : 'View'}
              </button>
            </div>
            <div className="mg-team">
              {liveTeam.slice(0, 5).map((t) => (
                <div key={t.id} className="mg-team-row">
                  <span className={`mg-av${t.has_login ? '' : ' pend'}`}>{initialsOf(t.person_name || t.email)}</span>
                  <span className="t">
                    <b>{t.person_name || t.email}</b>
                    <em>{tierLabel(t.permission_tier)}{t.has_login ? '' : ' · not signed up'}</em>
                  </span>
                </div>
              ))}
              {liveTeam.length > 5 && (
                <p className="mg-quiet mt-2">+{liveTeam.length - 5} more</p>
              )}
            </div>
          </div>

          <div className="ce-card rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="ce-title">Company</h3>
                <p className="ce-status">{tierLabel(company?.permission_tier)}</p>
              </div>
              <button type="button" className="ce-link" onClick={() => navigate('/management/settings')}>
                Settings
              </button>
            </div>
            <div className="mg-meta">
              <div className="r"><span>Name</span><b>{profile?.company?.name || company?.company_name || '—'}</b></div>
              <div className="r"><span>Contact</span><b>{profile?.company?.contact_email || 'Not set'}</b></div>
              <div className="r"><span>Phone</span><b>{profile?.company?.phone || 'Not set'}</b></div>
            </div>
            {/* The one line the office most often needs to be able to repeat. */}
            <p className="mg-quiet mt-3">
              Nobody here can change what a vessel&rsquo;s crew entered — only sign a closed month
              off or send it back.
            </p>
          </div>
        </div>
      </div>
    </ManagementLayout>
  );
}
