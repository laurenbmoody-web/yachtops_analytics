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
//
// Built as tiles rather than the hairline rows used elsewhere in Cargo: the
// office visits a few times a month to answer one question, and the answer
// should be the thing your eye lands on.
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

  const sum = (k) => fleet.reduce((n, v) => n + (v[k] || 0), 0);
  const waiting = sum('awaiting_signoff');
  const queried = sum('queried');
  const done = sum('signed_off');

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

        {/* The three numbers the office came for, before the list of boats that
            explains them. */}
        {!loading && fleet.length > 0 && (
          <div className="mgf-stats">
            <div className={`mgf-stat${waiting ? ' is-live' : ''}`}>
              <b className="mgf-stat-n">{waiting}</b>
              <span className="mgf-stat-l">To sign off</span>
              <span className="mgf-stat-s">{waiting ? 'Closed by the vessel, waiting on you' : 'Nothing outstanding'}</span>
            </div>
            <div className={`mgf-stat${queried ? ' is-query' : ''}`}>
              <b className="mgf-stat-n">{queried}</b>
              <span className="mgf-stat-l">Sent back</span>
              <span className="mgf-stat-s">{queried ? 'With the crew to fix' : 'None outstanding'}</span>
            </div>
            <div className={`mgf-stat${done ? ' is-done' : ''}`}>
              <b className="mgf-stat-n">{done}</b>
              <span className="mgf-stat-l">Signed off</span>
              <span className="mgf-stat-s">Across the whole fleet</span>
            </div>
          </div>
        )}

        {err && <p className="mgf-err"><Icon name="AlertCircle" size={15} /> {err}</p>}

        {loading ? (
          <p className="mgf-empty">Loading…</p>
        ) : fleet.length === 0 ? (
          <div className="mgf-none">
            <span className="mgf-none-ic"><Icon name="Anchor" size={26} /></span>
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
          <>
            <p className="mgf-lab">Vessels</p>
            <div className="mgf-rows">
              {fleet.map((v) => {
                const needs = v.awaiting_signoff || 0;
                const back = v.queried || 0;
                const tone = needs ? 'need' : (back ? 'query' : '');
                return (
                  <button key={`${v.tenant_id}-${v.company_id}`} type="button" className="mgf-row"
                    onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                    <span className="mgf-name">
                      <span className={`mgf-dot ${tone}`} />
                      <span className="mgf-name-t">
                        <b>{v.vessel_name}</b>
                        <em>{describeScopes(v.scopes)}</em>
                      </span>
                    </span>
                    <span className={`mgf-state ${tone}`}>
                      {needs > 0
                        ? `${needs} ${needs === 1 ? 'month' : 'months'} to sign off`
                        : back > 0
                          ? `${back} back with the vessel`
                          : 'Nothing waiting'}
                    </span>
                    <span className="mgf-last">
                      {v.latest_period ? `to ${periodLabel(v.latest_period)}` : '—'}
                    </span>
                    <Icon name="ChevronRight" size={18} />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </ManagementShell>
  );
}
