// The shore office's fleet — where a management login lands.
//
// Built out of the same widget language as the crew's overview dashboard:
// .ce-card / .ce-title / .ce-status / .ce-link on the --d-* token surface. A
// card here and a card on the crew dashboard are the same card, deliberately —
// the office is a different user, not a different product.
//
// Vessels are ordered by what needs the office today rather than alphabetically
// (managementView.sortFleet), and this page is the front door on purpose: with a
// dozen yachts on the books, two of them called Serenity, arriving INSIDE one is
// how a month gets signed off on the wrong boat.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import ManagementLayout from './components/ManagementLayout';
import useManagementCompany from '../../hooks/useManagementCompany';
import { listManagedVessels } from '../../services/managementService';
import { sortFleet, describeScopes } from '../../services/managementView';
import './management.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodLabel = (iso) => {
  if (!iso) return '';
  const [y, m] = String(iso).slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

// Two letters to recognise a boat by in a grid of them.
const monogram = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2);
  return two.toUpperCase();
};

function Stat({ icon, value, label, sub, tone }) {
  return (
    <div className="ce-card rounded-xl p-5 mg-stat">
      <div className={`mg-stat-ic ${tone || ''}`}><Icon name={icon} size={16} /></div>
      <p className="mg-stat-n">{value}</p>
      <p className="ce-eyebrow mt-2">{label}</p>
      <p className="ce-status">{sub}</p>
    </div>
  );
}

export default function ManagementFleet() {
  const navigate = useNavigate();
  const { company } = useManagementCompany();
  const [fleet, setFleet] = useState([]);
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

  const sum = (k) => fleet.reduce((n, v) => n + (v[k] || 0), 0);
  const waiting = sum('awaiting_signoff');
  const queried = sum('queried');
  const done = sum('signed_off');

  return (
    <ManagementLayout
      eyebrow={`Management · ${company?.company_name || ''}`}
      title={<>Fleet<span className="accent">, {waiting ? 'waiting on you' : 'in order'}</span>.</>}
    >
      {err && (
        <div className="ce-card rounded-xl p-4 mb-5 flex items-center gap-2">
          <Icon name="AlertCircle" size={16} className="ce-ico-muted" />
          <span className="text-sm ce-fg-danger">{err}</span>
        </div>
      )}

      {/* The three numbers the office came for. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat icon="PenLine" value={waiting} label="To sign off" tone={waiting ? 'is-live' : ''}
          sub={waiting ? 'Closed by the vessel' : 'Nothing outstanding'} />
        <Stat icon="Undo2" value={queried} label="Sent back" tone={queried ? 'is-warn' : ''}
          sub={queried ? 'With the crew to fix' : 'None outstanding'} />
        <Stat icon="BadgeCheck" value={done} label="Signed off" tone={done ? 'is-good' : ''}
          sub="Across the whole fleet" />
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="ce-eyebrow m-0">Vessels</p>
        <span className="ce-status">{fleet.length} {fleet.length === 1 ? 'vessel' : 'vessels'}</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="ce-card rounded-xl mg-ghost" />)}
        </div>
      ) : fleet.length === 0 ? (
        <div className="ce-card rounded-xl p-10 text-center">
          <div className="mg-empty-ic"><Icon name="Anchor" size={24} /></div>
          <h3 className="ce-title mt-3">No vessels yet</h3>
          {/* The office cannot help itself to a boat — a captain has to engage
              the firm — so this says who to ask rather than offering an action
              that doesn't exist. */}
          <p className="ce-status mx-auto" style={{ maxWidth: '44ch' }}>
            A vessel appears here once its captain engages {company?.company_name || 'your company'} from
            their month-end page.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {fleet.map((v) => {
            const needs = v.awaiting_signoff || 0;
            const back = v.queried || 0;
            const tone = needs ? 'need' : (back ? 'query' : '');
            return (
              <button key={`${v.tenant_id}-${v.company_id}`} type="button"
                className={`ce-card rounded-xl p-5 mg-vessel ${tone}`}
                onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                <div className="flex items-start justify-between gap-3">
                  <span className={`mg-mono ${tone}`}>{monogram(v.vessel_name)}</span>
                  <span className={`mg-tag ${tone}`}>
                    {needs > 0 ? `${needs} to sign off` : back > 0 ? `${back} sent back` : 'Up to date'}
                  </span>
                </div>

                <h3 className="ce-title mt-4">{v.vessel_name}</h3>
                <p className="ce-status">{describeScopes(v.scopes)}</p>

                <div className="mg-vessel-foot">
                  <span className="ce-status m-0">
                    {v.latest_period ? `Through ${periodLabel(v.latest_period)}` : 'No closed months yet'}
                  </span>
                  <span className="ce-link mg-open">Open <Icon name="ArrowRight" size={13} /></span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </ManagementLayout>
  );
}
