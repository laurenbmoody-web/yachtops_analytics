import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchExpiringVesselDocuments, getExpiryStatus, formatDocDate } from '../../vessel-documents/vesselDocuments';

// RAG pill colours — mirror the vault's expiry pills (getExpiryStatus levels).
const PILL = {
  expired: { bg: '#FBE4DC', fg: '#9A2B12' },
  red:     { bg: '#FBE4DC', fg: '#9A2B12' },
  amber:   { bg: '#FBEFD9', fg: '#8A5A12' },
  green:   { bg: '#E3EFE4', fg: '#3F7A52' },
};

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
        const rows = await fetchExpiringVesselDocuments({ tenantId: activeTenantId, withinDays: 90 });
        if (alive) setDocs(rows || []);
      } catch (err) {
        console.error('[VesselDocRenewalsWidget] error:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [activeTenantId]);

  // Classify each expiring doc by its RAG level.
  const ranked = docs.map((d) => ({ ...d, st: getExpiryStatus(d.expiry_date) }));
  const expired = ranked.filter((d) => d.st?.level === 'expired').length;
  const soon = ranked.filter((d) => d.st?.level === 'red').length;
  const attention = expired + soon;
  const allCurrent = !loading && attention === 0;

  let statusText = 'All current';
  let statusAttention = false;
  if (loading) {
    statusText = 'Loading…';
  } else if (expired > 0) {
    statusText = `${expired} expired`;
    statusAttention = true;
  } else if (soon > 0) {
    statusText = `${soon} expiring soon`;
    statusAttention = true;
  } else if (docs.length > 0) {
    statusText = `${docs.length} on the horizon`;
  }

  return (
    <div className="ce-card rounded-xl p-5 cursor-pointer" onClick={() => navigate('/vessel-documents')}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="ce-title">Document renewals</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link">Open vault</span>
      </div>

      <div className="flex items-center justify-center py-6 mb-5">
        {loading ? (
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
            <LogoSpinner size={32} />
          </div>
        ) : (
          <div className={`w-20 h-20 rounded-full flex items-center justify-center ${allCurrent ? 'ce-bg-success' : 'ce-bg-warn'}`}>
            <Icon
              name={allCurrent ? 'ShieldCheck' : 'FileWarning'}
              className={`w-10 h-10 ${allCurrent ? 'ce-fg-success' : 'ce-fg-warn'}`}
            />
          </div>
        )}
      </div>

      <div className="text-center mb-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : allCurrent ? (
          <>
            <p className="text-lg font-semibold ce-fg-success">All current</p>
            <p className="text-xs text-muted-foreground mt-1">No certificates lapsing within 90 days</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold ce-fg-warn">{attention} need attention</p>
            <p className="text-xs text-muted-foreground mt-1">
              {`${docs.length} document${docs.length !== 1 ? 's' : ''} within 90 days`}
            </p>
          </>
        )}
      </div>

      {!loading && ranked.length > 0 && (
        <div className="space-y-2">
          {ranked.slice(0, 4).map((d) => {
            const pill = PILL[d.st?.level] || PILL.green;
            return (
              <div key={d.id} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/30">
                <span className="text-xs text-foreground truncate" title={d.name}>{d.name}</span>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
                  style={{ background: pill.bg, color: pill.fg }}
                  title={`Expires ${formatDocDate(d.expiry_date)}`}
                >
                  {d.st?.level === 'green' || d.st?.level === 'none'
                    ? formatDocDate(d.expiry_date)
                    : d.st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default VesselDocRenewalsWidget;
