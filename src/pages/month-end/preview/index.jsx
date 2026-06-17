// Month-end — layout preview / sandbox. NOT the live page. Chosen direction:
// an editorial list (J) with serif task titles (L). Month-end is a hub for
// everything a command/chief closes off monthly, grouped into categories
// (Compliance & safety, Crew & payroll, Accounts & stores). Box-free — hairline
// rules + whitespace, navy ink with terracotta reserved for what needs action.
//
// Hours of Rest, breaches & sea time are REAL packs already in the product; the
// rest are PLACEHOLDERS ("Planned") so we can judge how the model scales as more
// month-end tasks land. Mounted at /month-end/preview — throwaway until signed off.

import React, { useMemo } from 'react';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import './preview.css';

// status: 'needs-action' | 'in-progress' | 'complete'
// live: real pack shipping today · planned: placeholder for the fuller model
const CATEGORIES = ['Compliance & safety', 'Crew & payroll', 'Accounts & stores'];

const TASKS = [
  { id: 'breaches',   cat: 'Compliance & safety', icon: 'AlertTriangle', title: 'Rest-hour breaches',      note: '2 breaches to sign off',         cta: 'Sign off',  done: 1,  total: 3,  status: 'needs-action', live: true },
  { id: 'hor',        cat: 'Compliance & safety', icon: 'Clock',         title: 'Hours of Rest',           note: '2 awaiting approval',            cta: 'Review',    done: 9,  total: 14, status: 'in-progress',  live: true },
  { id: 'drills',     cat: 'Compliance & safety', icon: 'LifeBuoy',      title: 'Safety drills',           note: 'MOB drill log outstanding',      cta: 'Open log',  done: 2,  total: 3,  status: 'in-progress',  planned: true },
  { id: 'seatime',    cat: 'Compliance & safety', icon: 'Anchor',        title: 'Sea time',                note: 'All service days confirmed',     cta: 'View',      done: 14, total: 14, status: 'complete',     live: true },
  { id: 'timesheets', cat: 'Crew & payroll',      icon: 'FileText',      title: 'Crew timesheets',         note: 'Overtime & leave to approve',    cta: 'Approve',   done: 0,  total: 14, status: 'needs-action', planned: true },
  { id: 'certs',      cat: 'Crew & payroll',      icon: 'Award',         title: 'Certificates & renewals', note: '3 expiring within 30 days',      cta: 'View',      done: 0,  total: 5,  status: 'needs-action', planned: true },
  { id: 'cash',       cat: 'Accounts & stores',   icon: 'Wallet',        title: 'Petty cash & accounts',   note: 'June reconciliation pending',    cta: 'Reconcile', done: 0,  total: 1,  status: 'needs-action', planned: true },
  { id: 'inventory',  cat: 'Accounts & stores',   icon: 'Package',       title: 'Inventory counts',        note: 'Bond · galley · medical · deck', cta: 'View',      done: 4,  total: 4,  status: 'complete',     planned: true },
];

// Two-state model: a pack is either OUTSTANDING or DONE — "in progress" and
// "needs action" mean the same thing (not finished), and the progress bar carries
// how far along each one is. Terracotta is the only accent, reserved for what's
// outstanding; completed packs recede into quiet grey. The underlying status field
// is kept only to sort (not-started → in-flight → done) and seed progress.
const DISPLAY = {
  outstanding: { label: 'Outstanding', dot: '#C65A1A', text: '#B14E16', bar: '#1C1B3A' },
  complete:    { label: 'Done',        dot: '#C7C3B6', text: '#9A958A', bar: '#CFCBBE' },
};
const stateOf = (t) => (t.status === 'complete' ? 'complete' : 'outstanding');
const ORDER = { 'needs-action': 0, 'in-progress': 1, 'complete': 2 };
const pct = (t) => (t.total ? Math.round((t.done / t.total) * 100) : 0);

function Row({ task }) {
  const state = stateOf(task);
  const s = DISPLAY[state];
  return (
    <div className={`mp-row${state === 'outstanding' ? ' is-action' : ' is-done'}`}>
      <span className="mp-row-ico"><Icon name={task.icon} size={19} /></span>
      <div className="mp-row-who">
        <div className="mp-row-title">
          {task.title}
          {task.planned && <span className="mp-planned">Planned</span>}
        </div>
        <div className="mp-row-note">{task.note}</div>
      </div>
      <div className="mp-row-prog">
        <div className="mp-bar"><span style={{ width: `${pct(task)}%`, background: s.bar }} /></div>
        <span className="mp-frac">{task.done}/{task.total}</span>
      </div>
      <span className="mp-status" style={{ color: s.text }}>
        <span className="mp-dot" style={{ background: s.dot }} />{s.label}
      </span>
      <div className="mp-row-act">
        <button type="button" className={`mp-link${state === 'complete' ? ' is-mut' : ''}`}>
          {state === 'complete' ? 'View' : task.cta} →
        </button>
      </div>
    </div>
  );
}

export default function MonthEndPreview() {
  const kpis = useMemo(() => {
    const totalUnits = TASKS.reduce((a, t) => a + t.total, 0);
    const doneUnits = TASKS.reduce((a, t) => a + t.done, 0);
    return {
      completion: totalUnits ? Math.round((doneUnits / totalUnits) * 100) : 0,
      outstanding: TASKS.filter((t) => t.status !== 'complete').length,
    };
  }, []);

  return (
    <>
      <Header />
      <div className="mp-page">
        <div className="mp-wrap">
          <div className="mp-banner">
            <Icon name="FlaskConical" size={14} />
            Layout preview — mock data. Hours of Rest, breaches &amp; sea time are real; the rest are placeholders for the fuller month-end model.
          </div>

          <div className="mp-head">
            <div>
              <h1 className="mp-title">Month-end</h1>
              <div className="mp-eyebrow">Monthly close-off · June 2026</div>
            </div>
          </div>

          {/* Summary — figures separated by hairlines, no box */}
          <div className="mp-sum">
            <div className="mp-s"><b>{kpis.completion}<i>%</i></b><span>Closed off</span></div>
            <span className="mp-vr" />
            <div className="mp-s"><b>{kpis.outstanding}</b><span>Outstanding</span></div>
            <span className="mp-vr" />
            <div className="mp-s"><b>2</b><span>Awaiting approval</span></div>
            <span className="mp-vr" />
            <div className="mp-s"><b>8<i> days</i></b><span>To month-end</span></div>
            <button type="button" className="mp-link mp-sum-cta">
              <Icon name="Bell" size={14} /> Send all reminders
            </button>
          </div>

          {/* One section per category — a clean hairline list, no boxes */}
          {CATEGORIES.map((cat) => {
            const tasks = TASKS.filter((t) => t.cat === cat).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
            const closed = tasks.filter((t) => t.status === 'complete').length;
            return (
              <div key={cat} className="mp-cat">
                <div className="mp-cat-head">
                  <span className="mp-dia">◆</span>
                  <span className="mp-cat-name">{cat}</span>
                  <span className="mp-cat-rule" />
                  <span className="mp-cat-meta">{closed} / {tasks.length} closed</span>
                </div>
                {tasks.map((t) => <Row key={t.id} task={t} />)}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
