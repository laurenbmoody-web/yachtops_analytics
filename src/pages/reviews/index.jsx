import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import './reviews.css';

// ReviewsPage — the inbox for rota submissions awaiting a decision.
// Phase 4a: page shell + header. Sub-commit 4 adds the list; sub-commit
// 5 adds the per-card actions; sub-commit 6 adds the empty state.

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

  const subtitleCount = pendingCount ?? 0;
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
            {/* Sub-commit 4 renders the list here; sub-commit 6 the empty state. */}
          </div>

        </div>
      </div>
    </>
  );
}
