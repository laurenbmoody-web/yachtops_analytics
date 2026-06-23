import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchVesselDocExpirySummary, getExpiryStatus, formatDocDate } from '../../vessel-documents/vesselDocuments';

// A compact slice of the vault's "compliance ledger": a three-up RAG summary
// and the soonest-expiring documents that need attention. Mirrors the full
// ledger view inside the vault.
const RAIL = { expired: '#9A2B12', red: '#8A5A12', amber: '#8A5A12' };

const VesselDocRenewalsWidget = () => {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeTenantId) { setLoading(false); return; }
      try {
        const rows = await fetchVesselDocExpirySummary({ tenantId: activeTenantId });
        if (alive) setDocs(rows || []);
      } catch (err) {
        console.error('[VesselDocRenewalsWidget] error:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [activeTenantId]);

  const ranked = docs.map((d) => ({ ...d, st: getExpiryStatus(d.expiry_date) }));
  const expired = ranked.filter((d) => d.st?.level === 'expired');
  const lapsing = ranked.filter((d) => d.st?.level === 'red' || d.st?.level === 'amber');
  const valid = ranked.filter((d) => d.st?.level === 'green');
  // Attention = expired + lapsing, soonest first (most-overdue at the top).
  const attention = [...expired, ...lapsing].sort((a, b) => (a.st?.days ?? 0) - (b.st?.days ?? 0));
  const allCurrent = !loading && attention.length === 0;

  let statusText = 'All current';
  let statusAttention = false;
  if (loading) {
    statusText = 'Loading…';
  } else if (expired.length) {
    statusText = `${expired.length} expired`;
    statusAttention = true;
  } else if (lapsing.length) {
    statusText = `${lapsing.length} expiring soon`;
    statusAttention = true;
  } else if (docs.length) {
    statusText = 'All current';
  } else {
    statusText = 'Nothing tracked yet';
  }

  const Stat = ({ n, label, bg, fg, border }) => (
    <div className="rounded-xl px-3 py-3 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: '26px', lineHeight: 1, color: fg }}>
        {loading ? '—' : n}
      </div>
      <div className="mt-1" style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.6px', color: fg }}>{label}</div>
    </div>
  );

  return (
    <div className="ce-card rounded-xl p-5 cursor-pointer" onClick={() => navigate('/vessel-documents')}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="ce-title">Document renewals</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link">Open vault</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><LogoSpinner size={32} /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <Stat n={expired.length} label="EXPIRED" bg="#FDF1ED" fg="#9A2B12" border="#F3D9CF" />
            <Stat n={lapsing.length} label="≤ 90 DAYS" bg="#FDF8EC" fg="#8A5A12" border="#F0E3C4" />
            <Stat n={valid.length} label="CURRENT" bg="#fff" fg="#3F7A52" border="#ECEAE3" />
          </div>

          {allCurrent ? (
            <div className="flex items-center gap-2.5 py-3 px-3 rounded-lg" style={{ background: '#E3EFE4' }}>
              <Icon name="ShieldCheck" className="w-5 h-5" style={{ color: '#3F7A52' }} />
              <span className="text-sm font-semibold" style={{ color: '#3F7A52' }}>
                {docs.length ? 'Everything in good standing' : 'No certificates tracked yet'}
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {attention.slice(0, 4).map((d) => (
                <div key={d.id} className="flex items-center gap-2.5 py-1.5">
                  <span className="rounded-full" style={{ width: '4px', height: '26px', background: RAIL[d.st?.level] || '#AEB4C2', flex: '0 0 auto' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate" style={{ color: '#1C1B3A' }} title={d.name}>{d.name}</div>
                    <div className="text-[11px]" style={{ color: '#AEB4C2' }}>{formatDocDate(d.expiry_date)}</div>
                  </div>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
                    style={d.st?.level === 'expired'
                      ? { background: '#FBE4DC', color: '#9A2B12' }
                      : { background: '#FBEFD9', color: '#8A5A12' }}
                  >
                    {d.st?.label}
                  </span>
                </div>
              ))}
              {attention.length > 4 && (
                <div className="text-[11px] pt-1" style={{ color: '#8B8478' }}>
                  +{attention.length - 4} more in the vault
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VesselDocRenewalsWidget;
