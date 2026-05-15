import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../pantry/pantry.css';
import './crew-rota.css';
import RotaTodayGrid from '../trip-detail-view-with-guest-allocation/components/RotaTodayGrid';
import { DEPT_ORDER } from '../trip-detail-view-with-guest-allocation/sections/SectionCrew';
import CrewListView from './CrewListView';
import RestPanelPopover from './RestPanelPopover';
import { useRotaShifts } from './useRotaShifts';

const EDITORIAL_BG = '#F5F1EA';

function fullDateLabel(d) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function RotaLegend({ now }) {
  const hhmm = now
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '';
  return (
    <div className="crew-rota-legend">
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#1C1B3A' }} />
        <span>Scheduled</span>
      </div>
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#F7F5F0' }} />
        <span>Off</span>
      </div>
      <div className="crew-rota-legend-item">
        <span className="crew-rota-legend-swatch" style={{ background: '#EDEAE3' }} />
        <span>Saturday</span>
      </div>
      <div className="crew-rota-legend-item">
        <span style={{ width: 1.5, height: 14, background: '#C65A1A', opacity: 0.5, borderRadius: 1 }} />
        <span>Now ({hhmm})</span>
      </div>
      <div className="crew-rota-legend-item">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Below 10h MLC</span>
      </div>
    </div>
  );
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

  const { crew, loading, error } = useRotaShifts();

  const total = crew.length;
  const onDuty = crew.filter(c => c.onNow && !c.offToday).length;
  const meta = `${fullDateLabel(now)} · ${total} crew on this trip · ${onDuty} on duty now`;

  const presentDepts = DEPT_ORDER.filter(d => crew.some(c => c.department === d));
  const cardContext = `${presentDepts.join(' · ')}  —  ${total} crew · ${onDuty} on duty`;

  return (
    <>
      <Header />
      <div className="editorial-page">

        <button type="button" className="crew-rota-back" onClick={() => navigate(-1)}>
          ← Back to trip
        </button>

        <div className="crew-rota-titleblock">
          <div className="crew-rota-meta">{meta}</div>
          <h1 className="crew-rota-title">
            The <em>rota</em>.
          </h1>
        </div>

        {/* Unified control bar — pills | date stepper */}
        <div className="crew-rota-controls">
          <div className="crew-rota-pillgroup">
            <button type="button" className="crew-rota-pill active">Today</button>
            <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Week</button>
            <button type="button" className="crew-rota-pill disabled" aria-disabled="true" title="Coming soon">Hours of rest log</button>
          </div>
          <div className="crew-rota-divider" />
          <div className="crew-rota-stepper">
            <button type="button" className="crew-rota-stepper-btn" aria-label="Previous day" disabled>←</button>
            <span className="crew-rota-stepper-date">{fullDateLabel(now)}</span>
            <button type="button" className="crew-rota-stepper-btn" aria-label="Next day" disabled>→</button>
            <span className="crew-rota-stepper-helper">
              06:00 Fri — 06:00 Sat · 30-min cells · click any name for the rest panel
            </span>
          </div>
        </div>

        {/* Body card with its own header / body / footer */}
        <div className="crew-rota-card">
          <div className="crew-rota-card-header">
            <div className="crew-rota-card-context">{cardContext}</div>
            <div className="crew-rota-pillgroup">
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
          </div>

          <div className="crew-rota-card-body">
            {loading ? (
              <div style={{
                padding: '48px 0', textAlign: 'center',
                fontFamily: 'var(--font-sans)', fontSize: 13,
                color: 'var(--ink-muted)', fontStyle: 'italic',
              }}>
                Loading the rota…
              </div>
            ) : error ? (
              <div style={{
                padding: '48px 0', textAlign: 'center',
                fontFamily: 'var(--font-sans)', fontSize: 13, color: '#7A2E1E',
              }}>
                Couldn't load the rota. {error}
              </div>
            ) : view === 'grid' ? (
              <RotaTodayGrid crew={crew} now={now} gridStartHour={6} onCrewClick={setSelectedCrew} />
            ) : (
              <CrewListView crew={crew} onCrewClick={setSelectedCrew} />
            )}
          </div>

          <div className="crew-rota-card-footer">
            {view === 'grid'
              ? <RotaLegend now={now} />
              : <span>Click a name for their rest panel.</span>}
            <span style={{ fontStyle: 'italic' }}>
              1 pending correction ·{' '}
              <a href="#review" onClick={(e) => e.preventDefault()}>review</a>
            </span>
          </div>
        </div>

      </div>

      <RestPanelPopover crew={selectedCrew} onClose={() => setSelectedCrew(null)} />
    </>
  );
}
