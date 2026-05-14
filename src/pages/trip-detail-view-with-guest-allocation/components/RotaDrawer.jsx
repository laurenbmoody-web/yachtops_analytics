import React, { useEffect } from 'react';
import './rota-drawer.css';
import RotaTodayGrid from './RotaTodayGrid';
import { MOCK_CREW } from '../sections/SectionCrew';

const DAY_LABELS  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_LABELS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fullDateLabel(d) {
  return `${DAY_LABELS[d.getDay()]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

export default function RotaDrawer({ open, onClose, now = new Date() }) {
  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const crewCount = MOCK_CREW.length;
  const onNowCount = MOCK_CREW.filter(c => c.onNow && !c.offToday).length;
  const metaLine = `${fullDateLabel(now)} · ${crewCount} crew on this trip · ${onNowCount} on duty now`;

  return (
    <>
      <div className="rota-drawer-backdrop" onClick={onClose} />
      <aside className="rota-drawer" role="dialog" aria-modal="true" aria-label="Rota">
        <div className="rota-drawer-head">
          <div className="rota-drawer-head-row">
            <div>
              <div className="rota-drawer-meta">{metaLine}</div>
              <h2 className="rota-drawer-title">The <em>rota</em>.</h2>
            </div>
            <button
              type="button"
              className="rota-drawer-close"
              onClick={onClose}
              aria-label="Close rota"
            >×</button>
          </div>

          <div className="rota-drawer-toolbar">
            <button type="button" className="rota-toolbar-pill active">Today</button>
            <button type="button" className="rota-toolbar-pill disabled" aria-disabled="true" title="Week view — coming later">Week</button>
            <button type="button" className="rota-toolbar-pill disabled" aria-disabled="true" title="Hours of rest log — coming later">Hours of rest log</button>
          </div>

          <div className="rota-drawer-stepper">
            <button type="button" className="rota-stepper-btn" aria-label="Previous day" disabled>←</button>
            <span className="rota-stepper-date">{fullDateLabel(now)}</span>
            <button type="button" className="rota-stepper-btn" aria-label="Next day" disabled>→</button>
            <span className="rota-stepper-helper">04:00 Fri — 04:00 Sat · 30-min cells · click any name for the rest panel</span>
          </div>
        </div>

        <div className="rota-drawer-body">
          <RotaTodayGrid now={now} />
        </div>

        <div className="rota-drawer-foot">
          <div className="rota-legend">
            <div className="rota-legend-item">
              <span className="rota-legend-swatch" style={{ background: '#1C1B3A' }} />
              <span>Scheduled</span>
            </div>
            <div className="rota-legend-item">
              <span className="rota-legend-swatch" style={{ background: '#C65A1A' }} />
              <span>On now</span>
            </div>
            <div className="rota-legend-item">
              <span className="rota-legend-swatch" style={{ background: '#FAF8F2', border: '0.5px solid #DFD8CC' }} />
              <span>Saturday</span>
            </div>
            <div className="rota-legend-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>Below 10h MLC</span>
            </div>
          </div>
          <span style={{ fontStyle: 'italic' }}>
            1 pending correction ·{' '}
            <span style={{
              color: '#C65A1A',
              textDecoration: 'underline',
              textDecorationColor: '#FAECE7',
              textUnderlineOffset: 3,
              cursor: 'pointer',
            }}>review</span>
          </span>
        </div>
      </aside>
    </>
  );
}
