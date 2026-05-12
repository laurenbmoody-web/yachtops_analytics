import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../pantry/pantry.css';
import { getTripById, resolveSupabaseTripId } from '../trips-management-dashboard/utils/tripStorage';
import { useItinerary } from '../trip-itinerary-timeline/hooks/useItinerary';

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

const EDITORIAL_BG = '#F5F1EA';

export default function TripDetailV2() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [status, setStatus] = useState('loading');
  const [tripUuid, setTripUuid] = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!tripId) return;
    setStatus('loading');
    Promise.resolve(getTripById(tripId))
      .then((data) => {
        if (cancelled) return;
        if (!data) { setStatus('missing'); return; }
        setTrip(data);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [tripId]);

  // Mirror the existing trip page: resolve Supabase UUID lazily when the
  // merge layer didn't stamp it (pre-A3.5 LS trips, pending sync).
  useEffect(() => {
    if (!trip || trip?.supabaseId) return;
    let cancelled = false;
    resolveSupabaseTripId(trip).then((uuid) => {
      if (!cancelled && uuid) setTripUuid(uuid);
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
