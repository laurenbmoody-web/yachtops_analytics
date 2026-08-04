// The shore office's fleet — where a management login lands.
//
// A management company opens Cargo to answer one question: which boats need me
// today. So the vessels are ordered by that, not alphabetically (see
// managementView.sortFleet), and each one is a card you act on rather than a row
// you read — a monogram to recognise it by, a ring showing how much of its year
// is signed off, and the action it is waiting for.
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
import { sortFleet, describeScopes, SCOPES } from '../../services/managementView';
import './management.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const periodLabel = (iso) => {
  if (!iso) return '';
  const [y, m] = String(iso).slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

// Two letters to recognise a boat by at a glance, the way an app icon works.
const monogram = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 2);
  return two.toUpperCase();
};

const scopeShort = (key) => SCOPES.find((s) => s.key === key)?.label || key;

// A ring rather than a bar: it reads as a state at a glance and takes no width,
// which is what lets the card stay a card.
function Ring({ done, total, tone }) {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <span className={`mgf-ring ${tone}`}>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={r} className="track" />
        <circle cx="26" cy="26" r={r} className="fill"
          strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 26 26)" />
      </svg>
      <b>{total > 0 ? `${done}/${total}` : '—'}</b>
    </span>
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

        {/* The three numbers the office came for, before the boats that explain
            them. Clickable where clicking means something. */}
        {!loading && fleet.length > 0 && (
          <div className="mgf-stats">
            <div className={`mgf-stat${waiting ? ' is-live' : ''}`}>
              <span className="mgf-stat-ic"><Icon name="PenLine" size={16} /></span>
              <b className="mgf-stat-n">{waiting}</b>
              <span className="mgf-stat-l">To sign off</span>
              <span className="mgf-stat-s">{waiting ? 'Closed by the vessel, waiting on you' : 'Nothing outstanding'}</span>
            </div>
            <div className={`mgf-stat${queried ? ' is-query' : ''}`}>
              <span className="mgf-stat-ic"><Icon name="Undo2" size={16} /></span>
              <b className="mgf-stat-n">{queried}</b>
              <span className="mgf-stat-l">Sent back</span>
              <span className="mgf-stat-s">{queried ? 'With the crew to fix' : 'None outstanding'}</span>
            </div>
            <div className={`mgf-stat${done ? ' is-done' : ''}`}>
              <span className="mgf-stat-ic"><Icon name="BadgeCheck" size={16} /></span>
              <b className="mgf-stat-n">{done}</b>
              <span className="mgf-stat-l">Signed off</span>
              <span className="mgf-stat-s">Across the whole fleet</span>
            </div>
          </div>
        )}

        {err && <p className="mgf-err"><Icon name="AlertCircle" size={15} /> {err}</p>}

        {loading ? (
          <div className="mgf-grid">
            {[0, 1, 2].map((i) => <div key={i} className="mgf-card is-ghost" />)}
          </div>
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
            <div className="mgf-grid">
              {fleet.map((v) => {
                const needs = v.awaiting_signoff || 0;
                const back = v.queried || 0;
                const signed = v.signed_off || 0;
                const tone = needs ? 'need' : (back ? 'query' : 'calm');
                return (
                  <button key={`${v.tenant_id}-${v.company_id}`} type="button" className={`mgf-card ${tone}`}
                    onClick={() => navigate(`/management/vessel/${v.tenant_id}`)}>
                    <span className="mgf-card-top">
                      <span className="mgf-mono">{monogram(v.vessel_name)}</span>
                      <Ring done={signed} total={signed + needs + back} tone={tone} />
                    </span>

                    <span className="mgf-card-name">{v.vessel_name}</span>
                    <span className="mgf-card-scopes">
                      {(v.scopes || []).map((s) => (
                        <span key={s} className="mgf-chip">{scopeShort(s)}</span>
                      ))}
                    </span>

                    <span className="mgf-card-foot">
                      <span className={`mgf-state ${tone}`}>
                        {needs > 0
                          ? `${needs} to sign off`
                          : back > 0 ? `${back} sent back` : 'Nothing waiting'}
                      </span>
                      <span className="mgf-go">
                        {v.latest_period ? periodLabel(v.latest_period) : 'Open'}
                        <Icon name="ArrowRight" size={15} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mgf-foot">
              Ordered by what needs you. {describeScopes(fleet[0]?.scopes || [])} is what
              {fleet.length === 1 ? ' this vessel has' : ' the first vessel has'} shared — each boat decides its own.
            </p>
          </>
        )}
      </div>
    </ManagementShell>
  );
}
