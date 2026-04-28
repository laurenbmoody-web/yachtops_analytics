import React, { useEffect } from 'react';
import './pantry.css';
import Header from '../../components/navigation/Header';
import { useGuests } from './hooks/useGuests';
import StandbyLayoutHeader  from './widgets/StandbyLayoutHeader';
import ServicePresetPicker from './widgets/ServicePresetPicker';
import DictateBar          from './widgets/DictateBar';
import GuestsWidget        from './widgets/GuestsWidget';
import TodayTimeline       from './widgets/TodayTimeline';
import StewNotesWidget     from './widgets/StewNotesWidget';
import StockWidget         from './widgets/StockWidget';
import AllergiesWidget     from './widgets/AllergiesWidget';

export default function StandbyPage() {
  const { guests } = useGuests();

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);
  const onboardCount = guests.filter(g => (g.current_state ?? 'awake') !== 'ashore').length;

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader />

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
