import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import { useReviewItems } from './useReviewItems';
import './reviews.css';

// ReviewsPage — the inbox for rota submissions awaiting a decision.
// Phase 4a: page shell + header + card list. Sub-commit 5 adds the
// per-card actions; sub-commit 6 adds the empty state.

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function ReviewsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentTenantMember, activeTenantId } = useTenant();

  const tier = (currentTenantMember?.permission_tier || '').toUpperCase();
  const userDeptId = currentTenantMember?.department_id || null;

  // Eyebrow: dept name resolved from departments table for CHIEF; just
  // "COMMAND" for COMMAND. Falls back to the bare tier when the dept
  // hasn't loaded yet.
  const [deptName, setDeptName] = useState(null);
  useEffect(() => {
    if (!activeTenantId || !userDeptId) { setDeptName(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('name')
        .eq('id', userDeptId)
        .maybeSingle();
      if (cancelled) return;
      if (error) { console.error('[ReviewsPage] dept fetch failed:', error); return; }
      setDeptName(data?.name || null);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId, userDeptId]);

  const eyebrow = useMemo(() => {
    if (tier === 'CHIEF') return deptName ? `CHIEF · ${deptName}` : 'CHIEF';
    if (tier === 'COMMAND') return 'COMMAND';
    return tier || '';
  }, [tier, deptName]);

  // Live pending count via direct query — same RLS-scoped read as
  // useInboxCount, surfaced as the subtitle. Polls when the page is
  // mounted only.
  const [pendingCount, setPendingCount] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('review_items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (cancelled) return;
      if (error) { console.error('[ReviewsPage] count fetch failed:', error); return; }
      setPendingCount(count || 0);
    };
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  const { items, loading } = useReviewItems();
  // Use the live list length as the source of truth for the subtitle
  // once items have loaded; fall back to pendingCount before that.
  const subtitleCount = loading ? (pendingCount ?? 0) : items.length;
  const subtitle = tier === 'COMMAND'
    ? `${subtitleCount} submission${subtitleCount === 1 ? '' : 's'} across the vessel`
    : `${subtitleCount} submission${subtitleCount === 1 ? '' : 's'} awaiting your decision`;

  return (
    <>
      <Header />
      <div className="rv-page">
        <div className="rv-container">

          <button
            type="button"
            className="rv-back"
            onClick={() => navigate('/crew')}
            aria-label="Back to rota"
          >
            <Icon name="ArrowLeft" size={14} />
            <span>Back to rota</span>
          </button>

          <div className="rv-eyebrow">{eyebrow}</div>
          <h1 className="rv-title">To review<em>.</em></h1>
          <div className="rv-subtitle">{subtitle}</div>

          <div className="rv-body">
            {items.map((item) => (
              <div key={item.id} className="rv-card">
                <div className="rv-card-head">
                  <div>
                    <div className="rv-card-dept">{item.department_name || '—'}</div>
                    <div className="rv-card-rota">{item.rota_name || ''}</div>
                  </div>
                  <div className="rv-card-meta">
                    <div>Submitted {timeAgo(item.created_at)}</div>
                    <div className="rv-card-meta-sub">
                      by {item.submitter_name || 'crew'}{item.submitter_role ? ` · ${item.submitter_role}` : ''}
                    </div>
                  </div>
                </div>
                <div className="rv-card-strip">
                  <Icon name="Calendar" size={14} />
                  <span>{item.day_count} day{item.day_count === 1 ? '' : 's'} · {item.shift_count} shift{item.shift_count === 1 ? '' : 's'}</span>
                  {item.mlc_override_count > 0 && (
                    <>
                      <span className="rv-card-strip-sep" aria-hidden />
                      <Icon name="AlertTriangle" size={14} color="#7A2E1E" />
                      <span style={{ color: '#7A2E1E' }}>
                        {item.mlc_override_count} MLC override{item.mlc_override_count === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>
                {/* Sub-commit 5 replaces the placeholder below with real action buttons. */}
                <div className="rv-card-actions-placeholder">Actions ship in sub-commit 5.</div>
              </div>
            ))}
            {/* Sub-commit 6 renders the empty state here when items.length === 0. */}
          </div>

        </div>
      </div>
    </>
  );
}
