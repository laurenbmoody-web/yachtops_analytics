import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../pantry/pantry.css';
import { getTripById, resolveSupabaseTripId } from '../trips-management-dashboard/utils/tripStorage';
import { useItinerary } from '../trip-itinerary-timeline/hooks/useItinerary';
import { useAuth } from '../../contexts/AuthContext';

import SectionHeader      from './sections/SectionHeader';
import SectionRoute       from './sections/SectionRoute';
import SectionComingUp    from './sections/SectionComingUp';
import SectionAboard      from './sections/SectionAboard';
import SectionCrew        from './sections/SectionCrew';
import SectionProvisioning from './sections/SectionProvisioning';
import SectionMemory      from './sections/SectionMemory';
import SectionDocuments   from './sections/SectionDocuments';
import SectionPhotos      from './sections/SectionPhotos';
import SectionActivity    from './sections/SectionActivity';

// Module-load probe. If this never logs, the V2 module isn't being
// imported — Routes.jsx isn't loading the file, or the bundler tree-
// shook it, or a chunk failed to download. If it logs but [v2 page]
// render doesn't, the route doesn't match `/trips/:tripId/v2` and
// React never invokes the component.
console.log('[v2 module] loaded', new Date().toISOString());

const EDITORIAL_BG = '#F5F1EA';

export default function TripDetailV2() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { tenantRole, activeTenantId, session } = useAuth();
  const [trip, setTrip] = useState(null);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState(null);
  const [tripUuid, setTripUuid] = useState(null);

  // Diagnostic — print once per render so the redirect-loop bug from the
  // legacy page can't hide. If this log never appears, V2 isn't mounting
  // at all (router miss, ProtectedRoute kick, etc.). If it appears once
  // and then the URL changes, something else is doing the redirect.
  console.log('[v2 page] render', {
    tripId,
    hasTrip: !!trip,
    status,
    tenantRole,
    activeTenantId,
    hasSession: !!session,
    pathname: typeof window !== 'undefined' ? window.location.pathname : null,
  });

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!tripId) {
      console.warn('[v2 page] no tripId in params — useParams returned undefined. Check route declaration.');
      return;
    }
    console.log('[v2 page] fetching trip', tripId);
    setStatus('loading');
    setErrorDetail(null);
    Promise.resolve(getTripById(tripId))
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          console.warn('[v2 page] getTripById returned null for', tripId);
          setStatus('missing');
          return;
        }
        console.log('[v2 page] trip loaded', { id: data?.id, name: data?.name, supabaseId: data?.supabaseId });
        setTrip(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[v2 page] getTripById threw', err);
        setErrorDetail(err?.message || String(err));
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [tripId]);

  // Mirror the existing trip page: resolve Supabase UUID lazily when the
  // merge layer didn't stamp it (pre-A3.5 LS trips, pending sync).
  useEffect(() => {
    if (!trip || trip?.supabaseId) return;
    let cancelled = false;
    resolveSupabaseTripId(trip).then((uuid) => {
      if (!cancelled && uuid) setTripUuid(uuid);
    }).catch((err) => {
      console.warn('[v2 page] resolveSupabaseTripId failed', err);
    });
    return () => { cancelled = true; };
  }, [trip]);

  const { days, loading: itineraryLoading } = useItinerary(tripUuid || trip?.supabaseId);

  if (status === 'loading') {
    return (
      <>
        <Header />
        <div className="editorial-page">
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
            Loading trip…
          </p>
        </div>
      </>
    );
  }

  if (status === 'missing' || status === 'error') {
    return (
      <>
        <Header />
        <div className="editorial-page">
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--ink)', margin: '0 0 12px' }}>
            Couldn't load this trip.
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 16px' }}>
            tripId: <code>{String(tripId)}</code>{status === 'error' && errorDetail ? <> · error: <code>{errorDetail}</code></> : null}
          </p>
          <button
            onClick={() => navigate('/trips-management-dashboard')}
            className="p-card-link"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            Back to trips
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="editorial-page">
        <SectionHeader trip={trip} days={days} />
        <SectionRoute trip={trip} days={days} loading={itineraryLoading} />
        <SectionComingUp trip={trip} days={days} />
        <SectionAboard trip={trip} />
        <SectionCrew trip={trip} />
        <SectionProvisioning trip={trip} />
        <SectionMemory trip={trip} />
        <SectionDocuments trip={trip} />
        <SectionPhotos trip={trip} />
        <SectionActivity trip={trip} />
      </div>
    </>
  );
}
