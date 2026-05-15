import React from 'react';
import { useNavigate } from 'react-router-dom';
import SectionCard from './_SectionCard';
import { useRotaShifts } from '../../crew-rota/useRotaShifts';

export const DEPT_ORDER = ['Interior', 'Deck', 'Galley', 'Engineering'];

// ── Visual primitives ───────────────────────────────────────────────────────

export const MlcTriangle = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="#C65A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

// ── Section ─────────────────────────────────────────────────────────────────

export default function SectionCrew() {
  const navigate = useNavigate();
  const { crew, loading } = useRotaShifts();
  const total = crew.length;
  const onDuty = crew.filter(c => c.onNow && !c.offToday).length;

  // Department counts in canonical order.
  const byDept = new Map();
  for (const c of crew) {
    const d = c.department || 'Other';
    if (!byDept.has(d)) byDept.set(d, { on: 0, off: 0 });
    const bucket = byDept.get(d);
    if (c.onNow && !c.offToday) bucket.on += 1;
    else bucket.off += 1;
  }
  const orderedDepts = [
    ...DEPT_ORDER.filter(d => byDept.has(d)),
    ...Array.from(byDept.keys()).filter(d => !DEPT_ORDER.includes(d)),
  ];

  const warnings = crew.filter(c => c.mlcWarning);

  if (loading && crew.length === 0) {
    return (
      <SectionCard
        accent="brass"
        titleNode={<>Crew on <em>this trip</em>.</>}
        style={{ maxWidth: 220 }}
      >
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: 11,
          color: '#8B8478', fontStyle: 'italic', marginTop: 8,
        }}>
          Loading crew…
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      accent="brass"
      titleNode={<>Crew on <em>this trip</em>.</>}
      style={{ maxWidth: 220 }}
    >
      {/* Hero — on duty count */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 0, marginTop: 4 }}>
        <span style={{
          fontFamily: 'var(--font-serif)', fontSize: 32, color: '#1C1B3A', lineHeight: 1,
        }}>{onDuty}</span>
        <span style={{
          fontFamily: 'var(--font-serif)', fontSize: 32, color: '#DFD8CC', lineHeight: 1,
          margin: '0 6px',
        }}>/</span>
        <span style={{
          fontFamily: 'var(--font-serif)', fontSize: 20, color: '#8B8478', lineHeight: 1,
        }}>{total}</span>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 11, color: '#695880', marginLeft: 6,
        }}>on duty</span>
      </div>

      {/* Department breakdown */}
      <div style={{ marginTop: 16 }}>
        {orderedDepts.map(dept => {
          const { on, off } = byDept.get(dept);
          return (
            <div key={dept} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderTop: '0.5px solid #ECE6DC',
            }}>
              <span style={{
                fontSize: 9, textTransform: 'uppercase', letterSpacing: 1,
                color: '#8B8478', fontWeight: 600,
              }}>{dept}</span>
              <span style={{ fontSize: 11 }}>
                <span style={{ color: '#1C1B3A' }}>{on} on</span>
                {off > 0 && (
                  <span style={{ color: '#8B8478' }}> · {off} off</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* MLC warnings */}
      {warnings.length > 0 && (
        <div style={{
          marginTop: 4, paddingTop: 10, borderTop: '0.5px solid #ECE6DC',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {warnings.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              fontSize: 10, color: '#C65A1A', fontWeight: 500, lineHeight: 1.3,
            }}>
              <span style={{ marginTop: 1 }}><MlcTriangle /></span>
              <span>{c.name} {c.rest24h} · below MLC daily</span>
            </div>
          ))}
        </div>
      )}

      {/* Rota link */}
      <button
        type="button"
        className="v2-btn-ghost"
        onClick={() => navigate('/crew')}
        style={{ width: '100%', marginTop: 12 }}
      >
        Open the rota →
      </button>
    </SectionCard>
  );
}
