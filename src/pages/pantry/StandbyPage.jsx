import React from 'react';
import './pantry.css';
import { useGuests } from './hooks/useGuests';
import ContextBar          from './widgets/ContextBar';
import PageGreeting        from './widgets/PageGreeting';
import NowAndDutyStack     from './widgets/NowAndDutyStack';
import ServicePresetPicker from './widgets/ServicePresetPicker';
import DictateBar          from './widgets/DictateBar';
import GuestsWidget        from './widgets/GuestsWidget';
import TodayTimeline       from './widgets/TodayTimeline';
import StewNotesWidget     from './widgets/StewNotesWidget';
import StockWidget         from './widgets/StockWidget';
import AllergiesWidget     from './widgets/AllergiesWidget';

export default function StandbyPage() {
  const { guests } = useGuests();
  const onboardCount = guests.filter(g => (g.current_state ?? 'awake') !== 'ashore').length;

  return (
    <div id="pantry-root" className="pantry-page">
      {/* ── Header row ── */}
      <div className="p-header-row">
        <div style={{ flex: 1 }}>
          <ContextBar />
          <PageGreeting />
        </div>
        <NowAndDutyStack />
      </div>

      {/* ── Service preset picker ── */}
      <ServicePresetPicker />

      {/* ── Dictate bar ── */}
      <DictateBar />

      {/* ── Guests ── */}
      <GuestsWidget />

      {/* ── Two-col: Timeline + Stew notes ── */}
      <div className="p-two-col">
        <TodayTimeline />
        <StewNotesWidget />
      </div>

      {/* ── Two-col: Stock + Allergies ── */}
      <div className="p-two-col">
        <StockWidget guestCount={onboardCount} />
        <AllergiesWidget />
      </div>
    </div>
  );
}
