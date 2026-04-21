import React, { useEffect } from 'react';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import '../pantry.css';

export default function TodaySchedulePage() {
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="Today"
          subtitle="The day ahead — full schedule. Coming in a future sprint."
          backTo="/pantry/standby"
        />
        <div className="p-card top-navy">
          <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
            Full day view not yet built. Events are shown on the Standby page timeline.
          </p>
        </div>
      </div>
    </>
  );
}
