// All vessels — the office's index, not a dashboard.
//
// This page answers one question: which boat do I open. So it is a way to FIND
// a vessel, laid out as a gallery of cards you can scan, with the three filters
// an office actually arrives with. The dashboards live INSIDE a vessel; putting
// one here as well meant two dashboards and no index.
//
// Each card is a vessel's calling card: a tinted cover carrying its type, the
// monogram sitting over the cover edge the way a profile picture does, the name
// in serif, then the three figures that decide whether you open it — months to
// sign, months signed off, and how far it has closed.
//
// Ordered by what needs the office today rather than alphabetically
// (managementView.sortFleet).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import ManagementLayout from './components/ManagementLayout';
import useManagementCompany from '../../hooks/useManagementCompany';
import { listManagedVessels } from '../../services/managementService';
import {
  sortFleet, describeScopes, FLEET_FILTERS, fleetCounts, filterFleet, vesselBucket,
} from '../../services/managementView';
import './management.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodLabel = (iso) => {
  if (!iso) return '—';
  const [y, m] = String(iso).slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

const monogram = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2);
  return two.toUpperCase();
};

const TONE = { waiting: 'need', back: 'query', clear: '' };

export default function ManagementFleet() {
  const navigate = useNavigate();
  const { company } = useManagementCompany();
  const [fleet, setFleet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

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

  const counts = useMemo(() => fleetCounts(fleet), [fleet]);
  const shown = useMemo(() => filterFleet(fleet, filter, q), [fleet, filter, q]);
  const waiting = fleet.reduce((n, v) => n + (v.awaiting_signoff || 0), 0);

  return (
    <ManagementLayout
      eyebrow={`Management · ${company?.company_name || ''}`}
      title={<>Fleet<span className="accent">, {waiting ? 'waiting on you' : 'in order'}</span>.</>}
      lede={waiting
        ? `${waiting} ${waiting === 1 ? 'month' : 'months'} closed and waiting on your signature across ${counts.waiting} ${counts.waiting === 1 ? 'vessel' : 'vessels'}.`
        : 'Nothing waiting on you. Months appear here as vessels close them.'}
    >
      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}

      {/* The three questions an office arrives with, each carrying its count so
          a filter can't turn out to be empty after you've clicked it. */}
      <div className="mg-bar">
        <div className="mg-filters">
          {FLEET_FILTERS.map((f) => (
            <button key={f.key} type="button"
              className={`mg-filter${filter === f.key ? ' on' : ''}`}
              disabled={counts[f.key] === 0 && f.key !== 'all'}
              onClick={() => setFilter(f.key)}>
              {f.label}<em>{counts[f.key]}</em>
            </button>
          ))}
        </div>
        {fleet.length > 4 && (
          <div className="mg-find">
            <Icon name="Search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a vessel" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><Icon name="X" size={13} /></button>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mg-gallery">
          {[0, 1, 2].map((i) => <div key={i} className="mg-card mg-ghost" />)}
        </div>
      ) : fleet.length === 0 ? (
        <div className="ce-card rounded-xl p-12 text-center">
          <div className="mg-empty-ic"><Icon name="Anchor" size={24} /></div>
          <h3 className="ce-title mt-4">No vessels yet</h3>
          {/* The office cannot help itself to a boat — a captain engages the
              firm — so this says who to ask, not what to click. */}
          <p className="ce-status mx-auto" style={{ maxWidth: '44ch' }}>
            A vessel appears here once its captain engages {company?.company_name || 'your company'} from
            their month-end page.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="ce-card rounded-xl p-10 text-center">
          <h3 className="ce-title">No vessel matches</h3>
          <p className="ce-status">
            Nothing under “{FLEET_FILTERS.find((f) => f.key === filter)?.label}”{q ? ` for “${q}”` : ''}.
          </p>
          <button type="button" className="ce-link mt-3"
            onClick={() => { setFilter('all'); setQ(''); }}>Show all vessels</button>
        </div>
      ) : (
        <div className="mg-gallery">
          {shown.map((v) => {
            const bucket = vesselBucket(v);
            const tone = TONE[bucket];
            const n = v.awaiting_signoff || 0;
            return (
              <button key={`${v.tenant_id}-${v.company_id}`} type="button"
                className={`mg-card ${tone}`}
                onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                <span className="mg-cover">
                  <span className="mg-cover-t">
                    {n > 0 ? `${n} to sign off` : bucket === 'back' ? `${v.queried} sent back` : 'Up to date'}
                  </span>
                </span>

                <span className={`mg-mono ${tone}`}>{monogram(v.vessel_name)}</span>

                <span className="mg-card-b">
                  <b className="mg-card-n">{v.vessel_name}</b>
                  <em className="mg-card-s">{describeScopes(v.scopes)}</em>

                  <span className="mg-figs">
                    <span className="f">
                      <b className={n ? 'hot' : ''}>{n}</b>
                      <em>To sign</em>
                    </span>
                    <span className="f">
                      <b>{v.signed_off || 0}</b>
                      <em>Signed off</em>
                    </span>
                    <span className="f">
                      <b className="sm">{periodLabel(v.latest_period)}</b>
                      <em>Through</em>
                    </span>
                  </span>
                </span>

                <span className="mg-card-f">
                  <span className="mg-open">Open vessel <Icon name="ArrowRight" size={14} /></span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </ManagementLayout>
  );
}
