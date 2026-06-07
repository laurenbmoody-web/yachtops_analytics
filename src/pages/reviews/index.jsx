import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import { useReviewItems } from './useReviewItems';
import ReviewItemCard from './ReviewItemCard';
import './reviews.css';

// ReviewsPage — the inbox for rota submissions awaiting a decision.
// Phase 4a: page shell + header + card list with Accept/Reject actions.
// Sub-commit 6 adds the empty state. timeAgo + per-card actions live
// inside ReviewItemCard.

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

  const { items, loading, refetch } = useReviewItems();

  // Toast — same shape as the rota page's destructive-variant pattern.
  // showToast(msg) for success; showToast(msg, { error: true }) for
  // destructive variant. Auto-clears at 4.2s.
  const [toast, setToast] = useState(null);
  const showToast = (msg, opts) => {
    setToast({ msg, error: !!opts?.error });
    setTimeout(() => setToast(null), 4200);
  };
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
            {!loading && items.length === 0 ? (
              <div className="rv-empty" role="status">
                <Icon name="Check" size={32} color="#8B8478" className="rv-empty-icon" />
                <div className="rv-empty-title">Nothing to review</div>
                <div className="rv-empty-sub">
                  When HODs submit rota changes, they’ll appear here for your decision.
                </div>
              </div>
            ) : (
              items.map((item) => (
                <ReviewItemCard
                  key={item.id}
                  item={item}
                  onToast={showToast}
                  onResolved={refetch}
                />
              ))
            )}
          </div>
        </div>

        {toast && (
          <div
            className={`rv-toast${toast.error ? ' error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >{toast.msg}</div>
        )}

      </div>
    </>
  );
}
