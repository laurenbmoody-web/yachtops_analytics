import React, { useMemo } from 'react';
import SectionCard from './_SectionCard';
import { useTripGuests } from '../hooks/useTripGuests';
import { TRIP_PHASE, computeTripPhase } from '../utils/tripPhase';

// ── Visual primitives ───────────────────────────────────────────────────────

const BalloonIcon = ({ size = 13, color = '#C65A1A' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <ellipse cx="12" cy="9" rx="5.5" ry="7"/>
    <path d="M12 16v3"/>
    <path d="M11 19h2"/>
    <path d="M13.5 22 12 19l-1.5 3"/>
  </svg>
);

const ShoreIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 20h20M5 20l3-7 4 7M14 20l3-9 5 9"/>
  </svg>
);

function initials(g) {
  const f = (g?.first_name || '').trim();
  const l = (g?.last_name || '').trim();
  const a = f ? f[0] : '';
  const b = l ? l[0] : '';
  return (a + b).toUpperCase() || '?';
}

function StatusBadge({ kind }) {
  // 'A' allergy · 'H' housekeeping note
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 19, height: 19, borderRadius: '50%',
      background: '#FAECE7', color: '#7A2E1E',
      fontSize: 10, fontWeight: 700, lineHeight: 1,
    }}>{kind}</span>
  );
}

function AshoreLabel() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, color: '#C65A1A', fontWeight: 500,
    }}>
      <ShoreIcon />
      <span>Ashore</span>
    </span>
  );
}

// One guest within a cabin card.
function GuestBlock({ guest, isLeader, showState }) {
  const ashore = showState && guest?.current_state === 'ashore';
  const hasAllergies = Array.isArray(guest?.allergies) ? guest.allergies.length > 0 : !!guest?.allergies;
  const hasNote = !!(guest?.special_notes && String(guest.special_notes).trim());
  const fullName = [guest?.first_name, guest?.last_name].filter(Boolean).join(' ') || 'Guest';
  const isPrincipal = !!guest?.is_principal;

  const avatarBaseSize = isLeader ? 44 : 40;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{
          width: avatarBaseSize, height: avatarBaseSize, borderRadius: '50%',
          background: '#1C1B3A', color: '#F5F1EA',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: isLeader ? 14 : 13, fontWeight: 600, flexShrink: 0,
          opacity: ashore ? 0.55 : 1,
        }}>{initials(guest)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              fontFamily: 'var(--font-serif)',
              fontSize: isLeader ? 18 : 17,
              lineHeight: 1.1,
            }}>{fullName}</div>
            {isPrincipal && <BalloonIcon />}
          </div>
          {isPrincipal && (
            <div style={{
              fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
              color: '#C65A1A', fontWeight: 600, marginTop: 3,
            }}>Principal</div>
          )}
          {guest?.role_label && (
            <div style={{ fontSize: 11, color: '#695880', marginTop: 2 }}>
              {guest.role_label}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', minHeight: 19 }}>
        {hasAllergies && <StatusBadge kind="A" />}
        {hasNote && <StatusBadge kind="H" />}
        {ashore && <AshoreLabel />}
      </div>
    </div>
  );
}

// Cabin label — prefer cabin_name + cabin_number combination, fall back gracefully.
function cabinTitle(cabin) {
  const name = (cabin.cabin_name || '').toString().trim();
  const number = (cabin.cabin_number || '').toString().trim();
  if (name && number) return `${name} · cabin ${number}`;
  if (name) return name;
  if (number) return `Cabin ${number}`;
  return 'Unassigned';
}

function CabinCard({ cabin, isPrincipalCabin, showState, fullWidth = false }) {
  const guests = cabin.guests;

  return (
    <div style={{
      border: '0.5px solid #DFD8CC',
      borderRadius: 12,
      padding: '18px 22px',
      background: '#FFFFFF',
      gridColumn: fullWidth ? '1 / -1' : 'auto',
    }}>
      <div style={{
        textAlign: 'center',
        fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
        color: isPrincipalCabin ? '#C65A1A' : '#695880',
        fontWeight: 600, marginBottom: 16,
      }}>
        {cabinTitle(cabin)}
      </div>

      {guests.length >= 2 && isPrincipalCabin ? (
        // Two-up horizontal layout for the principal's cabin (couple)
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: 22, alignItems: 'flex-start' }}>
          <GuestBlock guest={guests[0]} isLeader showState={showState} />
          <div style={{ background: '#DFD8CC', width: 1, minHeight: 90 }} />
          <GuestBlock guest={guests[1]} isLeader showState={showState} />
        </div>
      ) : (
        // Stacked layout for cabins with 1+ guests
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {guests.map((g, i) => (
            <React.Fragment key={g.id}>
              {i > 0 && <div style={{ height: '0.5px', background: '#DFD8CC' }} />}
              <GuestBlock guest={g} showState={showState} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

export default function SectionAboard({ trip }) {
  const { guests, loading } = useTripGuests(trip);
  const phase = computeTripPhase(trip, new Date());
  // Live state (onboard/ashore) is only meaningful during the Aboard phase.
  // Planning/Settling/Archived show the manifest without state pills.
  const showState = phase === TRIP_PHASE.ABOARD;

  // Group guests by cabin. Prefer cabin_number as the join key; fall back to
  // cabin_name. Guests without either land in a single "Unassigned" bucket.
  const cabins = useMemo(() => {
    const buckets = new Map();
    for (const g of guests) {
      const key = (g.cabin_number || g.cabin_name || 'unassigned').toString();
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          cabin_number: g.cabin_number,
          cabin_name: g.cabin_name,
          guests: [],
          hasPrincipal: false,
        });
      }
      const bucket = buckets.get(key);
      bucket.guests.push(g);
      if (g.is_principal) bucket.hasPrincipal = true;
    }
    // Principals' cabin first, then sorted by cabin_number (numeric where possible).
    return Array.from(buckets.values()).sort((a, b) => {
      if (a.hasPrincipal !== b.hasPrincipal) return a.hasPrincipal ? -1 : 1;
      const an = Number(a.cabin_number);
      const bn = Number(b.cabin_number);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return (a.cabin_number || '').toString().localeCompare((b.cabin_number || '').toString());
    });
  }, [guests]);

  const totalGuests = guests.length;
  const aboardCount = showState
    ? guests.filter(g => (g.current_state ?? 'onboard') !== 'ashore').length
    : totalGuests;
  const cabinCount = cabins.length;

  const metaLine = totalGuests === 0
    ? null
    : showState
      ? `${aboardCount} of ${totalGuests} onboard · ${cabinCount} ${cabinCount === 1 ? 'cabin' : 'cabins'} occupied`
      : `${totalGuests} guest${totalGuests === 1 ? '' : 's'} · ${cabinCount} ${cabinCount === 1 ? 'cabin' : 'cabins'} assigned`;

  return (
    <SectionCard
      accent="navy"
      meta={metaLine}
      titleNode={<>Aboard for <em>this trip</em>.</>}
      actions={<button className="v2-btn-ghost">Add a guest</button>}
    >
      {loading && guests.length === 0 ? (
        <p style={{
          fontFamily: 'var(--font-sans)', fontStyle: 'italic',
          fontSize: 12, color: 'var(--ink-muted)', margin: 0,
        }}>
          Loading the manifest…
        </p>
      ) : guests.length === 0 ? (
        <p style={{
          fontFamily: 'var(--font-serif)', fontStyle: 'italic',
          fontSize: 16, color: 'var(--ink-muted)', margin: 0,
        }}>
          No guests added yet.{' '}
          <span style={{
            color: 'var(--accent)', textDecoration: 'underline',
            textUnderlineOffset: 3, cursor: 'pointer',
          }}>Add a guest →</span>
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Principal cabin: full width row */}
          {cabins.filter(c => c.hasPrincipal).map(c => (
            <CabinCard
              key={c.key}
              cabin={c}
              isPrincipalCabin
              showState={showState}
              fullWidth
            />
          ))}

          {/* Non-principal cabins: 2-col grid below */}
          {cabins.some(c => !c.hasPrincipal) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
              {cabins.filter(c => !c.hasPrincipal).map(c => (
                <CabinCard
                  key={c.key}
                  cabin={c}
                  showState={showState}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
