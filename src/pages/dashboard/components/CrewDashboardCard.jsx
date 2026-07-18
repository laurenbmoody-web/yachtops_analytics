import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Briefcase } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

// Cargo editorial tokens — navy ink, terracotta accent, Inter / DM Serif.
const BRAND = { ink: '#1C1B3A', terra: '#C65A1A', mute: '#6B7280', faint: '#8B8478' };
const SERIF = "'DM Serif Display', Georgia, serif";
const BODY  = "'Inter', system-ui, sans-serif";

const CARD = {
  padding: '16px 18px',
  borderRadius: 14,
  background: '#FFFFFF',
  border: '1px solid #ECEAE3',
  boxShadow: '0 1px 2px rgba(28,27,58,0.04)',
};

// Shared row renderer — icon tile + optional eyebrow + title + CTA.
const HybridRow = ({ icon: Icon, eyebrow, title, subtitle, ctaLabel, ctaHref }) => (
  <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 14 }}>
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: 11,
        background: '#F4F5F9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon size={20} color={BRAND.ink} strokeWidth={1.9} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      {eyebrow && (
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: BRAND.faint,
            fontFamily: BODY,
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div style={{ fontSize: 14.5, fontWeight: 600, color: BRAND.ink, fontFamily: BODY }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12.5, color: BRAND.mute, fontFamily: BODY, marginTop: 2, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      )}
    </div>
    {ctaHref && (
      <Link
        to={ctaHref}
        style={{
          background: BRAND.terra,
          color: '#fff',
          padding: '9px 16px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          fontFamily: BODY,
        }}
      >
        {ctaLabel}
      </Link>
    )}
  </div>
);

// Hybrid card shown to crew (non-admin) members in place of the admin onboarding
// stepper. Two kinds of items:
//   - Static task: "Complete your profile" (disappears once profile is filled)
//   - Dynamic activity: "X jobs assigned to you" (count of open team_jobs)
// Future TODO slots for watches and watch swaps are commented out below.
const CrewDashboardCard = ({ userId, tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(true); // start optimistic so we don't flash the task
  const [jobsCount, setJobsCount] = useState(0);

  useEffect(() => {
    if (!userId || !tenantId) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const [{ data: profile }, { count }] = await Promise.all([
          // Explicit columns: profiles.email is column-restricted, so select('*')
          // would 403. This card only needs name + avatar (phone/bio aren't real
          // profile columns and stay undefined, as before).
          supabase.from('profiles').select('id, full_name, avatar_url').eq('id', userId).maybeSingle(),
          supabase
            .from('team_jobs')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('assigned_to', userId)
            .eq('status', 'OPEN'),
        ]);

        if (cancelled) return;

        // Profile is "complete enough" when there's a real full_name AND at least
        // one of the optional fields is populated. Missing columns are undefined,
        // not null, so chained optionality handles absent schema gracefully.
        const hasName  = !!profile?.full_name?.trim();
        const hasExtra = !!(profile?.avatar_url || profile?.phone || profile?.bio);
        setProfileComplete(hasName && hasExtra);
        setJobsCount(count ?? 0);
      } catch (err) {
        console.warn('[CrewDashboardCard] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, tenantId]);

  // Optimistic: don't render anything while loading to avoid layout flicker.
  if (loading) return <div style={{ marginTop: 18, minHeight: 80 }} />;

  const showProfile = !profileComplete;
  const showJobs    = jobsCount > 0;
  const hasAnything = showProfile || showJobs;

  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {showProfile && (
        <HybridRow
          icon={User}
          title="Complete your profile"
          subtitle="Add your name and a photo so your crew recognises you"
          ctaLabel="Start →"
          ctaHref={`/profile/${userId}`}
        />
      )}

      {showJobs && (
        <HybridRow
          icon={Briefcase}
          title={`${jobsCount} ${jobsCount === 1 ? 'job' : 'jobs'} assigned to you`}
          ctaLabel="View →"
          ctaHref="/team-jobs-management"
        />
      )}

      {/* TODO: Wire up when watches table exists
      {onWatchToday && (
        <HybridRow
          icon={Anchor}
          eyebrow="Today"
          title={`You're on watch ${watchDay}`}
          ctaLabel="View →"
          ctaHref="/watches"
        />
      )}
      */}

      {/* TODO: Wire up when watch swap feature is built
      {swapRequestsCount > 0 && (
        <HybridRow
          icon={Repeat}
          eyebrow="Swaps"
          title={`${swapRequestsCount} swap ${swapRequestsCount === 1 ? 'request' : 'requests'} to review`}
          ctaLabel="Review →"
          ctaHref="/watch-swaps"
        />
      )}
      */}

      {!hasAnything && (
        <div style={{ ...CARD, textAlign: 'center', padding: '22px 18px' }}>
          <div style={{ fontSize: 19, color: BRAND.ink, fontFamily: SERIF }}>
            You're all caught up
          </div>
          <div style={{ fontSize: 13, color: BRAND.mute, fontFamily: BODY, marginTop: 4 }}>
            Nothing needs your attention right now.
          </div>
        </div>
      )}
    </div>
  );
};

export default CrewDashboardCard;
