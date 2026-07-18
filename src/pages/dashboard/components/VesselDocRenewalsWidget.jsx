import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchVesselDocExpirySummary, fetchCrewDocExpirySummary, getExpiryStatus, formatDocDate } from '../../vessel-documents/vesselDocuments';
import './doc-renewals.css';

// A compact slice of the vault's compliance ledger: a three-up RAG summary and
// the soonest-expiring documents that need attention. Ship's papers and crew
// certs together; each attention row deep-links to the document.
const VesselDocRenewalsWidget = () => {
  const navigate = useNavigate();
  const { activeTenantId, currentTenantMember } = useTenant();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Renewals span ship's papers and crew certificates — a Command/Chief concern.
  const tier = String(
    currentTenantMember?.permission_tier
    || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('cargo_tenant_member_role') : '')
    || '',
  ).toUpperCase();
  const canView = tier === 'COMMAND' || tier === 'CHIEF';

  const load = useCallback(async () => {
    if (!activeTenantId || !canView) { setLoading(false); return; }
    setError(false);
    try {
      const [vessel, crew] = await Promise.all([
        fetchVesselDocExpirySummary({ tenantId: activeTenantId }),
        fetchCrewDocExpirySummary({ tenantId: activeTenantId }),
      ]);
      setDocs([...(vessel || []), ...(crew || [])]);
    } catch (err) {
      console.error('[VesselDocRenewalsWidget] error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, canView]);

  useEffect(() => { load(); }, [load]);

  // Keep it honest — refetch when the crew returns to the tab (a cert may have
  // been renewed in the vault meanwhile).
  useEffect(() => {
    const onFocus = () => { if (activeTenantId && canView) load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, activeTenantId, canView]);

  if (!canView) return null;

  const openVault = () => navigate('/vessel-documents');
  const openDoc = (d) => {
    if (d.kind === 'crew' && d.userId) navigate(`/profile/${d.userId}?tab=documents`);
    else openVault();
  };

  const ranked = docs.map((d) => ({ ...d, st: getExpiryStatus(d.expiry_date) }));
  const expired = ranked.filter((d) => d.st?.level === 'expired');
  const lapsing = ranked.filter((d) => d.st?.level === 'red' || d.st?.level === 'amber');
  const valid = ranked.filter((d) => d.st?.level === 'green');
  // Attention = expired + lapsing, most-overdue first.
  const attention = [...expired, ...lapsing].sort((a, b) => (a.st?.days ?? 0) - (b.st?.days ?? 0));

  let statusText = 'All current';
  let attn = false;
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (expired.length) { statusText = `${expired.length} expired`; attn = true; }
  else if (lapsing.length) { statusText = `${lapsing.length} expiring soon`; attn = true; }
  else if (docs.length) statusText = 'All current';
  else statusText = 'Nothing tracked yet';

  return (
    <div className="ce-card dr rounded-xl p-5">
      <div className="dr-head">
        <div>
          <h3 className="ce-title">Document renewals</h3>
          <p className={`dr-status${attn ? ' att' : ''}`}>{statusText}</p>
        </div>
        <button type="button" className="ce-link" onClick={openVault}>View all</button>
      </div>

      {loading ? (
        <div className="dr-load"><LogoSpinner size={32} /></div>
      ) : error ? (
        <div className="dr-err">
          <Icon name="AlertTriangle" size={16} />
          Couldn’t load renewals.
          <button type="button" className="dr-retry" onClick={load}>Retry</button>
        </div>
      ) : (
        <>
          <div className="dr-stats">
            <div className="dr-stat">
              <div className={`dr-num${expired.length ? '' : ' zero'}`} data-sev={expired.length ? 'expired' : ''}>{expired.length}</div>
              <div className="dr-lbl">Expired</div>
            </div>
            <div className="dr-stat">
              <div className={`dr-num${lapsing.length ? '' : ' zero'}`} data-sev={lapsing.length ? 'amber' : ''}>{lapsing.length}</div>
              <div className="dr-lbl">≤ 90 days</div>
            </div>
            <div className="dr-stat">
              <div className="dr-num" data-sev="ok">{valid.length}</div>
              <div className="dr-lbl">Current</div>
            </div>
          </div>

          {attention.length > 0 && (
            <div className="dr-list">
              {attention.slice(0, 4).map((d) => (
                <button type="button" key={d.id} className="dr-row" onClick={() => openDoc(d)} title={d.name}>
                  <span className="dr-dot" data-sev={d.st?.level} />
                  <span className="dr-main">
                    <span className="dr-name">{d.name}</span>
                    <span className="dr-date">Expires {formatDocDate(d.expiry_date)}</span>
                  </span>
                  <span className="dr-when" data-sev={d.st?.level}>{d.st?.label}</span>
                </button>
              ))}
              {attention.length > 4 && (
                <button type="button" className="dr-more" onClick={openVault}>+{attention.length - 4} more in the vault</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VesselDocRenewalsWidget;
