// Month-end — layout preview / sandbox. NOT the live page. This mocks a FULLER
// month-end model: month-end is a hub for everything a command/chief must close
// off each month, not just Hours of Rest. Hours of Rest + Rest-hour breaches are
// real packs already in the product; the rest are PLACEHOLDERS ("Planned") so we
// can judge how each layout direction scales once more tasks land.
//
// Same mock dataset renders three ways — flip A / B / C with the switcher:
//   A · Dashboard   — KPI tiles + a grid of pack cards
//   B · Roster      — one editorial column, agenda/checklist feel
//   C · Action board — needs-action / in-progress / complete columns
//
// Mounted at /month-end/preview. Throwaway sandbox — delete once a direction wins.

import React, { useMemo, useState } from 'react';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import './preview.css';

// status: 'needs-action' | 'in-progress' | 'complete'
// live: real pack shipping today · planned: placeholder for the fuller model
const TASKS = [
  { id: 'hor',        icon: 'Clock',         title: 'Hours of Rest',        note: '2 awaiting approval',          done: 9,  total: 14, status: 'in-progress', live: true },
  { id: 'breaches',   icon: 'AlertTriangle', title: 'Rest-hour breaches',   note: '2 breaches to sign off',       done: 1,  total: 3,  status: 'needs-action', live: true },
  { id: 'seatime',    icon: 'Anchor',        title: 'Sea time',             note: 'All service days confirmed',   done: 14, total: 14, status: 'complete',    live: true },
  { id: 'timesheets', icon: 'FileText',      title: 'Crew timesheets',      note: 'Overtime & leave to approve',  done: 0,  total: 14, status: 'needs-action', planned: true },
  { id: 'drills',     icon: 'LifeBuoy',      title: 'Safety drills',        note: 'MOB drill log outstanding',    done: 2,  total: 3,  status: 'in-progress', planned: true },
  { id: 'certs',      icon: 'Award',         title: 'Certificates & renewals', note: '3 expiring within 30 days', done: 0,  total: 5,  status: 'needs-action', planned: true },
  { id: 'cash',       icon: 'Wallet',        title: 'Petty cash & accounts', note: 'June reconciliation pending', done: 0,  total: 1,  status: 'needs-action', planned: true },
  { id: 'inventory',  icon: 'Package',       title: 'Inventory counts',     note: 'Bond · galley · medical · deck', done: 4, total: 4, status: 'complete',    planned: true },
];

const STATUS = {
  'needs-action': { label: 'Needs action', dot: '#C65A1A', text: '#B14E16', tint: '#FBEFE9' },
  'in-progress':  { label: 'In progress',  dot: '#6C6CCF', text: '#4A4AB0', tint: '#EEEEFB' },
  'complete':     { label: 'Complete',     dot: '#5C9B6A', text: '#3F7A52', tint: '#EAF3EC' },
};

const pct = (t) => (t.total ? Math.round((t.done / t.total) * 100) : 0);

function ProgressBar({ task, tone }) {
  return (
    <div className="mp-bar"><span style={{ width: `${pct(task)}%`, background: tone }} /></div>
  );
}

function PlannedTag() {
  return <span className="mp-planned">Planned</span>;
}

// ── A · Dashboard ──────────────────────────────────────────────────────────
function Dashboard({ tasks, kpis }) {
  return (
    <>
      <div className="mp-kpis">
        <div className="mp-kpi">
          <div className="mp-kpi-num">{kpis.completion}<span className="mp-kpi-unit">%</span></div>
          <div className="mp-kpi-lbl">Overall complete</div>
          <div className="mp-kpi-bar"><span style={{ width: `${kpis.completion}%` }} /></div>
        </div>
        <div className="mp-kpi">
          <div className="mp-kpi-num">{kpis.outstanding}</div>
          <div className="mp-kpi-lbl">Tasks outstanding</div>
        </div>
        <div className="mp-kpi">
          <div className="mp-kpi-num">{kpis.awaiting}</div>
          <div className="mp-kpi-lbl">Awaiting approval</div>
        </div>
        <div className="mp-kpi">
          <div className="mp-kpi-num">8<span className="mp-kpi-unit"> days</span></div>
          <div className="mp-kpi-lbl">To month-end</div>
        </div>
      </div>

      <div className="mp-grid">
        {tasks.map((t) => {
          const s = STATUS[t.status];
          return (
            <div key={t.id} className={`mp-card${t.planned ? ' is-planned' : ''}`}>
              <div className="mp-card-top">
                <span className="mp-ico" style={{ background: s.tint, color: s.text }}><Icon name={t.icon} size={16} /></span>
                <div className="mp-card-title">{t.title}{t.planned && <PlannedTag />}</div>
                <span className="mp-pct">{pct(t)}%</span>
              </div>
              <ProgressBar task={t} tone={s.dot} />
              <div className="mp-card-foot">
                <span className="mp-status" style={{ color: s.text }}><span className="mp-dot" style={{ background: s.dot }} />{s.label}</span>
                <span className="mp-note">{t.note}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── B · Roster (editorial column) ──────────────────────────────────────────
function Roster({ tasks, kpis }) {
  return (
    <div className="mp-roster">
      <div className="mp-roster-summary">
        <strong>{kpis.complete} of {tasks.length}</strong> packs closed
        <span className="mp-sep">·</span>
        {kpis.completion}% across the board
        <span className="mp-sep">·</span>
        {kpis.outstanding} need action
      </div>
      {tasks.map((t) => {
        const s = STATUS[t.status];
        return (
          <div key={t.id} className={`mp-line${t.status === 'needs-action' ? ' is-action' : ''}`}>
            <span className="mp-ico sm" style={{ background: s.tint, color: s.text }}><Icon name={t.icon} size={15} /></span>
            <div className="mp-line-who">
              <div className="mp-line-title">{t.title}{t.planned && <PlannedTag />}</div>
              <div className="mp-line-note">{t.note}</div>
            </div>
            <div className="mp-line-prog">
              <ProgressBar task={t} tone={s.dot} />
              <span className="mp-frac">{t.done}/{t.total}</span>
            </div>
            <span className="mp-status end" style={{ color: s.text }}><span className="mp-dot" style={{ background: s.dot }} />{s.label}</span>
            <Icon name="ChevronRight" size={16} className="mp-chev" />
          </div>
        );
      })}
    </div>
  );
}

// ── C · Action board (columns) ─────────────────────────────────────────────
function Board({ tasks }) {
  const cols = [
    { key: 'needs-action', title: 'Needs action' },
    { key: 'in-progress',  title: 'In progress' },
    { key: 'complete',     title: 'Complete' },
  ];
  return (
    <div className="mp-board">
      {cols.map((col) => {
        const items = tasks.filter((t) => t.status === col.key);
        const s = STATUS[col.key];
        return (
          <div key={col.key} className="mp-col">
            <div className="mp-col-head">
              <span className="mp-dot" style={{ background: s.dot }} />
              <span className="mp-col-title">{col.title}</span>
              <span className="mp-col-count">{items.length}</span>
            </div>
            {items.map((t) => (
              <div key={t.id} className={`mp-tile${t.planned ? ' is-planned' : ''}`}>
                <div className="mp-tile-top">
                  <span className="mp-ico sm" style={{ background: s.tint, color: s.text }}><Icon name={t.icon} size={14} /></span>
                  <span className="mp-tile-title">{t.title}</span>
                </div>
                <div className="mp-tile-note">{t.note}</div>
                <ProgressBar task={t} tone={s.dot} />
                <div className="mp-tile-foot">
                  <span className="mp-frac">{t.done}/{t.total}</span>
                  {t.planned ? <PlannedTag /> : <span className="mp-live">Live</span>}
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="mp-col-empty">Nothing here</div>}
          </div>
        );
      })}
    </div>
  );
}

const VIEWS = [
  { key: 'A', label: 'Dashboard' },
  { key: 'B', label: 'Roster' },
  { key: 'C', label: 'Action board' },
];

export default function MonthEndPreview() {
  const [view, setView] = useState('A');

  const kpis = useMemo(() => {
    const complete = TASKS.filter((t) => t.status === 'complete').length;
    const outstanding = TASKS.filter((t) => t.status !== 'complete').length;
    const awaiting = 2; // mocked
    const totalUnits = TASKS.reduce((a, t) => a + t.total, 0);
    const doneUnits = TASKS.reduce((a, t) => a + t.done, 0);
    const completion = totalUnits ? Math.round((doneUnits / totalUnits) * 100) : 0;
    return { complete, outstanding, awaiting, completion };
  }, []);

  return (
    <>
      <Header />
      <div className="mp-page">
        <div className="mp-wrap">
          <div className="mp-banner">
            <Icon name="FlaskConical" size={14} />
            Layout preview — mock data. Hours of Rest, breaches & sea time are real; the rest are placeholders for the fuller month-end model.
          </div>

          <div className="mp-head">
            <div>
              <h1 className="mp-title">Month-end</h1>
              <div className="mp-eyebrow">Monthly close-off · June 2026</div>
            </div>
            <div className="mp-switch" role="tablist" aria-label="Layout direction">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={view === v.key}
                  className={view === v.key ? 'on' : ''}
                  onClick={() => setView(v.key)}
                >
                  <span className="mp-switch-key">{v.key}</span>{v.label}
                </button>
              ))}
            </div>
          </div>

          {view === 'A' && <Dashboard tasks={TASKS} kpis={kpis} />}
          {view === 'B' && <Roster tasks={TASKS} kpis={kpis} />}
          {view === 'C' && <Board tasks={TASKS} />}
        </div>
      </div>
    </>
  );
}
