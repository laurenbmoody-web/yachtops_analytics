import React from 'react';
import './pantry.css';
import Header from '../../components/navigation/Header';
import { useGuests } from './hooks/useGuests';
import { EditorialPageShell } from '../../components/editorial';
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
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <EditorialPageShell />

        <ServicePresetPicker />
        <DictateBar />
        <GuestsWidget />

        <div className="p-two-col">
          <TodayTimeline />
          <StewNotesWidget />
        </div>

        <div className="p-two-col">
          <StockWidget guestCount={onboardCount} />
          <AllergiesWidget />
        </div>
      </div>
    </>
  );
}
