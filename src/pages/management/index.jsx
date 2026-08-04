// The shore office's fleet — where a management login lands.
//
// A management company opens Cargo to answer one question: which boats need me
// today. So the list is ordered by that, not alphabetically — vessels waiting on
// a signature first, then ones the office has queried and is waiting on, then
// the quiet ones (see managementView.sortFleet).
//
// It is also the front door on purpose. With a dozen yachts on the books, and
// two of them called Serenity, arriving INSIDE one is how a month gets signed
// off on the wrong boat. You pick a vessel here; you never land in one.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import '../../styles/editorial.css';
import ManagementShell from './components/ManagementShell';
import useManagementCompany from '../../hooks/useManagementCompany';
import { listManagedVessels } from '../../services/managementService';
import { sortFleet, fleetHeadline, describeScopes } from '../../services/managementView';
import './management.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (iso) => {
  if (!iso) return '';
  const [y, m] = String(iso).slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

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

  const waiting = fleet.reduce((n, v) => n + (v.awaiting_signoff || 0), 0);

  return (
    <ManagementShell>
      <div className="mgf">
        <p className="editorial-meta">
          <span className="dot">●</span><span>Management</span>
          {company?.company_name && (<><span className="bar" /><span className="muted">{company.company_name}</span></>)}
          <span className="bar" />
          <span className="muted">{fleet.length} {fleet.length === 1 ? 'vessel' : 'vessels'}</span>
        </p>
        <h1 className="editorial-greeting">
          Fleet<span className="period">,</span> <em>{waiting ? 'waiting on you' : 'in order'}</em><span className="period">.</span>
        </h1>
        <p className="mgf-say">{fleetHeadline(fleet)}</p>

        {err && <p className="mgf-err"><Icon name="AlertCircle" size={15} /> {err}</p>}

        {loading ? (
          <p className="mgf-empty">Loading…</p>
        ) : fleet.length === 0 ? (
          <div className="mgf-none">
            <Icon name="Anchor" size={40} />
            <p>No vessels yet</p>
            {/* The office cannot help itself to a boat — a captain has to engage
                the firm — so the empty state says who to ask rather than
                offering an action that doesn't exist. */}
            <p className="mgf-none-sub">
              A vessel appears here once its captain engages {company?.company_name || 'your company'} from
              their month-end page. Ask them to add {company?.company_name || 'you'} and it will show up.
            </p>
          </div>
        ) : (
          <div className="mgf-rows">
            {fleet.map((v) => {
              const needs = v.awaiting_signoff || 0;
              const queried = v.queried || 0;
              return (
                <button key={`${v.tenant_id}-${v.company_id}`} type="button" className="mgf-row"
                  onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                  <span className={`mgf-dot${needs ? ' need' : (queried ? ' query' : '')}`} />
                  <span className="mgf-name">
                    <b>{v.vessel_name}</b>
                    <em>{describeScopes(v.scopes)}</em>
                  </span>
                  <span className="mgf-state">
                    {needs > 0
                      ? `${needs} ${needs === 1 ? 'month' : 'months'} to sign off`
                      : queried > 0
                        ? `${queried} back with the vessel`
                        : 'Nothing waiting'}
                  </span>
                  <span className="mgf-last">
                    {v.latest_period ? `to ${periodLabel(v.latest_period)}` : '—'}
                  </span>
                  <Icon name="ChevronRight" size={17} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ManagementShell>
  );
}
