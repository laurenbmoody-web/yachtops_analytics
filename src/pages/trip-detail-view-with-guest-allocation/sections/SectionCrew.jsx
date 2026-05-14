import React from 'react';
import SectionCard from './_SectionCard';

// ── Mock crew data ──────────────────────────────────────────────────────────
//
// Phase 3 renders the crew list against the same mock people shown in
// docs/crew-list-reference.html (View B · list) and docs/rota-today-
// final-reference.html. No rota / shifts Supabase table exists yet; this
// data is shared with RotaTodayGrid so both surfaces stay consistent.
//
// Export here so the rota drawer can read the same shape.

export const MOCK_CREW = [
  {
    id: 'claire',  initials: 'CL', name: 'Claire',  role: 'Chief stew',
    department: 'Interior',
    shiftText: 'today 06:00–14:00, 18:00–22:00',
    rest24h: '8h 30m', pastWeek: '64h',
    mlcWarning: false,
    onNow: true, offToday: false,
  },
  {
    id: 'marco',   initials: 'MC', name: 'Marco',   role: '2nd stew',
    department: 'Interior',
    shiftText: 'today 10:00–18:00',
    rest24h: '9h', pastWeek: '70h',
    mlcWarning: false,
    onNow: false, offToday: false,
  },
  {
    id: 'emma',    initials: 'EM', name: 'Emma',    role: '3rd stew',
    department: 'Interior',
    shiftText: 'today 14:00–22:00',
    rest24h: '7h', pastWeek: '58h',
    mlcWarning: true,
    onNow: true, offToday: false,
  },
  {
    id: 'sophie',  initials: 'SO', name: 'Sophie',  role: 'Laundry',
    department: 'Interior',
    shiftText: 'off today, back Saturday 08:00',
    rest24h: null, pastWeek: null,
    mlcWarning: false,
    onNow: false, offToday: true,
  },
  {
    id: 'james',   initials: 'JT', name: 'James',   role: 'Bosun',
    department: 'Deck',
    shiftText: 'today 08:00–16:00, on watch',
    rest24h: '9h 15m', pastWeek: '67h',
    mlcWarning: false,
    onNow: true, offToday: false,
  },
  {
    id: 'tom',     initials: 'TM', name: 'Tom',     role: 'Deckhand',
    department: 'Deck',
    shiftText: 'today 08:00–18:00',
    rest24h: '10h', pastWeek: '62h',
    mlcWarning: false,
    onNow: false, offToday: false,
  },
  {
    id: 'anders',  initials: 'AN', name: 'Anders',  role: 'Head chef',
    department: 'Galley',
    shiftText: 'today 07:30–12:30, 17:30–22:00',
    rest24h: '9h 30m', pastWeek: '68h',
    mlcWarning: false,
    onNow: true, offToday: false,
  },
];

const DEPT_ORDER = ['Interior', 'Deck', 'Galley', 'Engineering'];

// ── Visual primitives ───────────────────────────────────────────────────────

const MlcTriangle = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

function StatusPill({ kind }) {
  if (kind === 'on-now') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 11, color: '#C65A1A', fontWeight: 500,
        background: '#FAECE7', padding: '4px 10px', borderRadius: 999,
        whiteSpace: 'nowrap',
      }}>On now</div>
    );
  }
  if (kind === 'off-now') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 11, color: '#695880',
        background: '#ECE6DC', padding: '4px 10px', borderRadius: 999,
        whiteSpace: 'nowrap',
      }}>Off now</div>
    );
  }
  // 'off' — off the rota today
  return (
    <div style={{
      fontSize: 11, color: '#695880',
      background: '#ECE6DC', padding: '4px 10px', borderRadius: 999,
      whiteSpace: 'nowrap',
    }}>Off</div>
  );
}

function DepartmentDivider({ label, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0 8px',
    }}>
      <div style={{
        fontSize: 9, letterSpacing: 1.8, textTransform: 'uppercase',
        color: '#8B8478', fontWeight: 600, flexShrink: 0,
      }}>{label} · {count} crew</div>
      <div style={{ height: '0.5px', background: '#DFD8CC', flex: 1 }} />
    </div>
  );
}

function CrewRow({ crew }) {
  const isOff = crew.offToday;
  const onDuty = crew.onNow && !isOff;
  const restColor = crew.mlcWarning ? '#C65A1A' : '#1C1B3A';

  const avatarBg   = onDuty ? '#FAECE7' : '#ECE6DC';
  const avatarText = onDuty ? '#7A2E1E' : '#5C5440';

  const roleLine = (() => {
    if (isOff) return crew.shiftText; // "off today, back Saturday 08:00"
    if (crew.mlcWarning) {
      return (
        <>
          {crew.role} · {crew.shiftText} ·{' '}
          <span style={{ color: '#C65A1A', fontWeight: 500 }}>rest below MLC</span>
        </>
      );
    }
    return `${crew.role} · ${crew.shiftText}`;
  })();

  const pillKind = isOff ? 'off' : (onDuty ? 'on-now' : 'off-now');

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '36px 1fr auto auto',
      gap: 14, alignItems: 'center',
      padding: '12px 0',
      borderBottom: '0.5px solid #ECE6DC',
      opacity: isOff ? 0.55 : 1,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: avatarBg, color: avatarText,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 600,
      }}>{crew.initials}</div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 17, lineHeight: 1.1,
          }}>{crew.name}</div>
          {crew.mlcWarning && <MlcTriangle />}
        </div>
        <div style={{ fontSize: 11, color: '#695880', marginTop: 2 }}>
          {isOff ? `${crew.role} · ${crew.shiftText}` : roleLine}
        </div>
      </div>

      {crew.rest24h ? (
        <div style={{ fontSize: 11, color: '#695880', textAlign: 'right' }}>
          <div style={{
            fontFamily: 'var(--font-serif)', fontSize: 14, color: restColor,
            fontWeight: crew.mlcWarning ? 600 : 400,
          }}>{crew.rest24h}</div>
          <div style={{
            fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
            color: '#8B8478', marginTop: 2,
          }}>Rest 24h</div>
        </div>
      ) : (
        <div />
      )}

      <StatusPill kind={pillKind} />
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

function todayLabel(now = new Date()) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
}

export default function SectionCrew({ onOpenRota }) {
  const crew = MOCK_CREW;
  const onNowCount = crew.filter(c => c.onNow && !c.offToday).length;
  const pendingCorrections = 1;

  if (crew.length === 0) {
    return (
      <SectionCard
        accent="brass"
        titleNode={<>Crew on <em>this trip</em>.</>}
      >
        <p style={{
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          fontSize: 16, color: 'var(--ink-muted)', margin: 0,
        }}>
          Crew list will appear when members are added.
        </p>
      </SectionCard>
    );
  }

  // Group by department, respecting DEPT_ORDER for the canonical sort order.
  const byDept = new Map();
  for (const c of crew) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c);
  }
  const orderedDepts = [
    ...DEPT_ORDER.filter(d => byDept.has(d)),
    ...Array.from(byDept.keys()).filter(d => !DEPT_ORDER.includes(d)),
  ];

  const meta = `${todayLabel()} · ${crew.length} crew on this trip · ${onNowCount} on duty now`;

  return (
    <SectionCard
      accent="brass"
      meta={meta}
      titleNode={<>Crew on <em>this trip</em>.</>}
      actions={
        <button
          className="v2-btn-ghost"
          onClick={onOpenRota}
          style={{ cursor: onOpenRota ? 'pointer' : 'default' }}
        >
          Open the rota
        </button>
      }
    >
      {orderedDepts.map(dept => (
        <div key={dept}>
          <DepartmentDivider label={dept} count={byDept.get(dept).length} />
          {byDept.get(dept).map(c => <CrewRow key={c.id} crew={c} />)}
        </div>
      ))}

      <div style={{
        marginTop: 14, paddingTop: 14,
        borderTop: '0.5px solid #DFD8CC',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: '#8B8478',
      }}>
        <span>Tap a crew member for their week.</span>
        <span style={{ fontStyle: 'italic' }}>
          {pendingCorrections} pending correction ·{' '}
          <span style={{
            color: '#C65A1A', textDecoration: 'underline',
            textDecorationColor: '#FAECE7', textUnderlineOffset: 3,
            cursor: 'pointer',
          }}>review</span>
        </span>
      </div>
    </SectionCard>
  );
}
