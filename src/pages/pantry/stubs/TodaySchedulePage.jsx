import React from 'react';
import Header from '../../../components/navigation/Header';
import { EditorialPageShell } from '../../../components/editorial';
import '../pantry.css';

export default function TodaySchedulePage() {
  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <EditorialPageShell
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
