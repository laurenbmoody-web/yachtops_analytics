// All vessels — the office's index, not a dashboard.
//
// This page answers one question: which boat do I open. So it is a way to FIND a
// vessel — a toolbar and a gallery, nothing above them. It carries no page
// heading on purpose: the header bar already says whose workspace this is, and
// a greeting between the nav and the toolbar was pushing the vessels down the
// page for no information.
//
// The cards stay on-palette: white on the cool ground, navy ink, terracotta as
// an ACCENT and nothing more — a status pill, a figure, the open link. Earlier
// versions filled the card head with saturated colour, which CLAUDE.md rules
// out and which turned a fleet into a wall of orange slabs.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import MenuSelect from '../../components/MenuSelect';
import ManagementLayout from './components/ManagementLayout';
import useManagementCompany from '../../hooks/useManagementCompany';
import { listManagedVessels } from '../../services/managementService';
import {
  sortFleet, sortFleetBy, describeScopes, FLEET_FILTERS, FLEET_SORTS,
  fleetCounts, filterFleet, vesselBucket,
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
  const [sort, setSort] = useState('attention');
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
  const shown = useMemo(
    () => sortFleetBy(filterFleet(fleet, filter, q), sort),
    [fleet, filter, q, sort],
  );

  // The filter list carries its counts, so a choice can't turn out to be empty
  // after it's made.
  const filterOptions = FLEET_FILTERS.map((f) => ({
    key: f.key, label: f.label, count: counts[f.key],
    disabled: f.key !== 'all' && counts[f.key] === 0,
  }));

  return (
    <ManagementLayout>
      {err && <div className="mg-banner bad mb-4"><Icon name="AlertCircle" size={15} /> {err}</div>}

      <div className="mg-bar">
        <div className="mg-find">
          <Icon name="Search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vessels…" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear search">
              <Icon name="X" size={13} />
            </button>
          )}
        </div>

        <div className="mg-tools">
          <span className="mg-shown">
            {shown.length} of {fleet.length} {fleet.length === 1 ? 'vessel' : 'vessels'}
          </span>
          <MenuSelect label="Filter" icon="SlidersHorizontal"
            value={filter} options={filterOptions} onChange={setFilter} />
          <MenuSelect label="Sort" icon="ArrowUpDown"
            value={sort} options={FLEET_SORTS} onChange={setSort} />
        </div>
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
                <span className="mg-card-h">
                  <span className={`mg-mono ${tone}`}>{monogram(v.vessel_name)}</span>
                  <span className="mg-card-t">
                    <b>{v.vessel_name}</b>
                    <em>{describeScopes(v.scopes)}</em>
                  </span>
                </span>

                <span className={`mg-state ${tone}`}>
                  {n > 0 ? `${n} ${n === 1 ? 'month' : 'months'} to sign off`
                    : bucket === 'back' ? `${v.queried} sent back`
                      : 'Up to date'}
                </span>

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
