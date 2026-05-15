import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../pantry/pantry.css';
import './crew-rota.css';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { MOCK_CREW } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import RestPanelPopover from './RestPanelPopover';

const EDITORIAL_BG = '#F5F1EA';

function fullDateLabel(d) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export default function CrewRotaPage() {
  const navigate = useNavigate();
  const now = new Date();
  const [view, setView] = useState('grid');      // 'grid' | 'list'
  const [selectedCrew, setSelectedCrew] = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  const total = MOCK_CREW.length;
  const onDuty = MOCK_CREW.filter(c => c.onNow && !c.offToday).length;
  const meta = `${fullDateLabel(now)} · ${total} crew on this trip · ${onDuty} on duty now`;

  return (
    <>
      <Header />
      <div className="editorial-page">

        <button type="button" className="crew-rota-back" onClick={() => navigate(-1)}>
          ← Back to trip
        </button>

        {/* Title block */}
        <div>
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 9, fontWeight: 500, letterSpacing: 1.5,
            textTransform: 'uppercase', color: '#8B8478', marginBottom: 6,
          }}>{meta}</div>
          <h1 style={{
            fontFamily: 'var(--font-serif)', fontWeight: 500,
            fontSize: 28, lineHeight: 1, margin: 0, color: '#1C1B3A',
          }}>
            The <em style={{ color: '#C65A1A', fontWeight: 400, fontStyle: 'italic' }}>rota</em>.
          </h1>
        </div>

        {/* Toolbar — Today / Week / HoR log */}
        <div className="crew-rota-toolbar">
          <button type="button" className="crew-rota-pill active">Today</button>
          <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Week</button>
          <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Hours of rest log</button>
        </div>

        {/* Date stepper */}
        <div className="crew-rota-stepper">
          <button type="button" className="crew-rota-stepper-btn" aria-label="Previous day" disabled>←</button>
          <span className="crew-rota-stepper-date">{fullDateLabel(now)}</span>
          <button type="button" className="crew-rota-stepper-btn" aria-label="Next day" disabled>→</button>
          <span className="crew-rota-stepper-helper">
            04:00 Fri — 04:00 Sat · 30-min cells · click any name for the rest panel
          </span>
        </div>

        {/* View toggle */}
        <div className="crew-rota-viewtoggle">
          <button
            type="button"
            className={`crew-rota-pill${view === 'grid' ? ' active' : ''}`}
            onClick={() => setView('grid')}
          >Grid</button>
          <button
            type="button"
            className={`crew-rota-pill${view === 'list' ? ' active' : ''}`}
            onClick={() => setView('list')}
          >List</button>
        </div>

        {/* Body card */}
        <div className="crew-rota-card">
          {view === 'grid'
            ? <RotaTodayGrid now={now} onCrewClick={setSelectedCrew} />
            : <CrewListView onCrewClick={setSelectedCrew} />}
        </div>

      </div>

      <RestPanelPopover crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
    </>
  );
}
