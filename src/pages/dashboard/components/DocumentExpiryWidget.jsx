import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { fetchExpiringDocuments, getExpiryStatus, EXPIRY_STATUS_CLASSES, formatDocDate } from '../../crew-profile/utils/crewDocuments';
import { getDocTypeLabel } from '../../crew-profile/documentTypes';

/**
 * Dashboard widget — crew document / certificate expiries.
 * Lists documents expired or expiring within 90 days (RLS-scoped: own for
 * crew, whole tenant for COMMAND). Each row links to that crew member's
 * Documents tab. Mirrors the 90/60/30 RAG thresholds used on the profile.
 */
const DocumentExpiryWidget = () => {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchExpiringDocuments(90);
        if (alive) setDocs(data);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const ranked = docs
    .map((d) => ({ ...d, _s: getExpiryStatus(d.expiry_date) }))
    .sort((a, b) => (a._s.days ?? 0) - (b._s.days ?? 0));
  const expired = ranked.filter((d) => d._s.level === 'expired').length;
  const soon = ranked.filter((d) => d._s.level === 'red' || d._s.level === 'amber').length;

  const attention = expired > 0 || soon > 0;
  const statusText = loading ? 'Loading…'
    : expired > 0 ? `${expired} expired`
    : soon > 0 ? `${soon} expiring soon`
    : 'All valid';

  return (
    <div className="ce-card rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="ce-title">Document expiries</h3>
          <p className={`ce-status${attention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link cursor-pointer" onClick={() => navigate('/crew-management')}>Crew</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><LogoSpinner size={28} /></div>
      ) : ranked.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="ShieldCheck" className="w-9 h-9 ce-fg-success mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">All certificates valid</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ranked.slice(0, 6).map((d) => (
            <button
              key={d.id}
              onClick={() => navigate(`/profile/${d.user_id}?tab=documents`)}
              className="w-full flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors text-left"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">
                  {getDocTypeLabel(d.doc_type, d.details)}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {d.crew_name ? `${d.crew_name} · ` : ''}{formatDocDate(d.expiry_date)}
                </div>
              </div>
              <span className={`flex-shrink-0 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${EXPIRY_STATUS_CLASSES[d._s.level]}`}>
                {d._s.label}
              </span>
            </button>
          ))}
          {ranked.length > 6 && (
            <p className="text-[11px] text-muted-foreground text-center pt-1">+{ranked.length - 6} more</p>
          )}
        </div>
      )}
    </div>
  );
};

export default DocumentExpiryWidget;
