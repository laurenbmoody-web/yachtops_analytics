import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Briefcase } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

// Brand tokens — mirror the admin NextUp card so this feels like one design system.
const BRAND = { navy: '#1E3A5F', accent: '#00A8CC', mute: '#64748B' };
const HEADING_FONT = "'Outfit', system-ui, sans-serif";
const BODY_FONT    = "'Plus Jakarta Sans', system-ui, sans-serif";
const PILL_FONT    = "'Archivo', system-ui, sans-serif";

const WASH_CONTAINER = {
  padding: '18px 22px',
  borderRadius: 12,
  background: 'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%)',
  border: '1px solid #BAE6FD',
};

// Shared row renderer — icon tile + optional eyebrow + title + CTA. Matches NextUp layout.
const HybridRow = ({ icon: Icon, eyebrow, title, subtitle, ctaLabel, ctaHref }) => (
  <div style={{ ...WASH_CONTAINER, display: 'flex', alignItems: 'center', gap: 16 }}>
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        background: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <Icon size={22} color={BRAND.navy} strokeWidth={2.2} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      {eyebrow && (
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: BRAND.mute,
            fontFamily: PILL_FONT,
            fontWeight: 800,
            marginBottom: 2,
          }}
        >
          {eyebrow}
        </div>
      )}
      <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.navy, letterSpacing: '-0.01em', fontFamily: HEADING_FONT }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: BRAND.mute, fontFamily: BODY_FONT, marginTop: 2 }}>
          {subtitle}
        </div>
      )}
    </div>
    {ctaHref && (
      <Link
        to={ctaHref}
        style={{
          background: BRAND.navy,
          color: 'white',
          padding: '10px 18px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 800,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          fontFamily: PILL_FONT,
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
          // Select * so we tolerate schemas that do or don't have avatar_url/phone/bio.
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
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
        <div style={{ ...WASH_CONTAINER, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: BRAND.navy, fontFamily: HEADING_FONT }}>
            You're all caught up
          </div>
          <div style={{ fontSize: 13, color: BRAND.mute, fontFamily: BODY_FONT, marginTop: 4 }}>
            Nothing needs your attention right now.
          </div>
        </div>
      )}
    </div>
  );
};

export default CrewDashboardCard;
