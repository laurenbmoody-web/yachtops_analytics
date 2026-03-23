import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';

/* ─── Crew Calendar Mockup ───────────────────────────────────────────────── */
const DAYS = [
  { label: 'Mon', date: 16 },
  { label: 'Tue', date: 17 },
  { label: 'Wed', date: 18 },
  { label: 'Thu', date: 19 },
  { label: 'Fri', date: 20 },
  { label: 'Sat', date: 21 },
  { label: 'Sun', date: 22 },
];

const LEGEND = [
  { label: 'Crew Mess',       color: '#3B82F6' },
  { label: 'Pantries',        color: '#22c55e' },
  { label: 'Bridge',          color: '#eab308' },
  { label: 'Stairs',          color: '#ec4899' },
  { label: "Captain's Cabin", color: '#a855f7' },
  { label: 'Laundry',         color: '#ef4444' },
];

// Pills per crew member per day [dayIndex 0-6]
const CS_PILLS = [
  { label: 'Crew Mess',       color: '#3B82F6' },
  { label: 'Pantries',        color: '#22c55e' },
  { label: 'Bridge',          color: '#eab308' },
  { label: 'Stairs',          color: '#ec4899' },
  { label: "Captain's Cabin", color: '#a855f7' },
  { label: 'Laundry',         color: '#ef4444' },
  { label: 'Crew Mess',       color: '#3B82F6' },
];

const LM_PILLS = [
  { label: 'Laundry',         color: '#ef4444' },
  { label: 'Crew Mess',       color: '#3B82F6' },
  { label: 'Pantries',        color: '#22c55e' },
  { label: 'Bridge',          color: '#eab308' },
  { label: 'Stairs',          color: '#ec4899' },
  { label: "Captain's Cabin", color: '#a855f7' },
  { label: 'Laundry',         color: '#ef4444' },
];

const pill = (label, color) => (
  <span key={label} style={{
    display: 'inline-block',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: 9,
    color: 'white',
    backgroundColor: color,
    borderRadius: 4,
    padding: '2px 6px',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }}>
    {label}
  </span>
);

const CrewBadge = ({ initials }) => (
  <div style={{
    width: 28,
    height: 28,
    borderRadius: '50%',
    backgroundColor: '#4A90E2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: 10,
    color: 'white',
    flexShrink: 0,
  }}>
    {initials}
  </div>
);

const NAV_ITEMS = ['Today', 'Inventory', 'Crew', 'Trips', 'Guests', 'Defects', 'Jobs'];

const CrewMockup = () => (
  <div style={{
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'Inter, sans-serif',
    userSelect: 'none',
  }}>
    {/* Browser chrome */}
    <div style={{
      backgroundColor: '#1a2844',
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#ef4444' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#22c55e' }} />
      </div>
      <div style={{
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: 10,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.01em',
      }}>
        cargotechnology.netlify.app/crew/duty-sets
      </div>
    </div>

    {/* App body */}
    <div style={{ display: 'flex', backgroundColor: '#0d1a2e', height: 420 }}>

      {/* Sidebar */}
      <div style={{
        width: 180,
        flexShrink: 0,
        backgroundColor: '#0a1628',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.05)',
      }}>
        {/* Logo */}
        <div style={{
          padding: '18px 16px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <span style={{
            fontFamily: '"Archivo Black", sans-serif',
            fontWeight: 900,
            fontSize: 14,
            color: 'white',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            CARGO
          </span>
        </div>
        {/* Nav */}
        <nav style={{ padding: '8px 0' }}>
          {NAV_ITEMS.map(item => {
            const active = item === 'Crew';
            return (
              <div key={item} style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? 'white' : 'rgba(255,255,255,0.4)',
                backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: active ? '2px solid #4A90E2' : '2px solid transparent',
                cursor: 'default',
              }}>
                {item}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '20px 24px', overflowX: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Page header */}
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white', letterSpacing: '-0.01em' }}>
            Duty Sets &amp; Rotation
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            Manage recurring task templates and crew rotation schedules
          </p>
        </div>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 7, padding: 3, gap: 2 }}>
            {['Templates', 'Rotation Calendar'].map(tab => {
              const active = tab === 'Rotation Calendar';
              return (
                <span key={tab} style={{
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'white' : 'rgba(255,255,255,0.4)',
                  backgroundColor: active ? '#3B82F6' : 'transparent',
                  borderRadius: 5,
                  padding: '5px 10px',
                  cursor: 'default',
                }}>
                  {tab}
                </span>
              );
            })}
          </div>
          {/* Spacer */}
          <div style={{ flex: 1 }} />
          {/* Interior dropdown */}
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.6)',
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'default',
          }}>
            Interior ▾
          </div>
          {/* Export Schedule */}
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.6)',
            backgroundColor: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'default',
          }}>
            Export Schedule
          </div>
          {/* New Template */}
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'white',
            backgroundColor: '#3B82F6',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'default',
          }}>
            + New Template
          </div>
        </div>

        {/* Week navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            backgroundColor: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'default',
          }}>
            ← Previous Week
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'white', flex: 1, textAlign: 'center' }}>
            March 16 – March 22, 2026
          </span>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'white',
            backgroundColor: '#3B82F6',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'default',
          }}>
            Auto Rotate
          </div>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            backgroundColor: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'default',
          }}>
            Next Week →
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {LEGEND.map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{
          flex: 1,
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
          minWidth: 0,
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px repeat(7, 1fr)',
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Team Member
            </div>
            {DAYS.map(d => (
              <div key={d.date} style={{
                padding: '8px 8px',
                fontSize: 10,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.4)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                textAlign: 'center',
                borderLeft: '1px solid rgba(255,255,255,0.05)',
              }}>
                {d.label} {d.date}
              </div>
            ))}
          </div>

          {/* Row 1: Chief Stew */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px repeat(7, 1fr)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CrewBadge initials="CS" />
              <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>Chief Stew</span>
            </div>
            {CS_PILLS.map((p, i) => (
              <div key={i} style={{
                padding: '10px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
              }}>
                {pill(p.label, p.color)}
              </div>
            ))}
          </div>

          {/* Row 2: Lauren Moody */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px repeat(7, 1fr)',
          }}>
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CrewBadge initials="LM" />
              <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>Lauren Moody</span>
            </div>
            {LM_PILLS.map((p, i) => (
              <div key={i} style={{
                padding: '10px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
              }}>
                {pill(p.label, p.color)}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  </div>
);

/* ─── Guest Preferences Mockup ──────────────────────────────────────────────── */
const GUEST_NAV_ITEMS = ['Today', 'Inventory', 'Crew', 'Trips', 'Guests', 'Defects', 'Jobs'];

const PREF_CATEGORIES = [
  { icon: '⚕', title: 'Allergies & Medical', meta: '1 preference · Allergies' },
  { icon: '🍽', title: 'Food & Drink',        meta: '16 preferences · Steak' },
  { icon: '✦',  title: 'Service Style',       meta: '12 preferences · Dining Service Style' },
];

const PERSONALITY_PILLS = [
  { label: 'Very private', active: false },
  { label: 'Social',       active: false },
  { label: 'Relaxed',      active: true  },
  { label: 'Easygoing',    active: false },
];

const DINING_ROWS = [
  { meal: 'Breakfast', style: 'Buffet' },
  { meal: 'Lunch',     style: 'Family Style' },
  { meal: 'Dinner',    style: 'American (Plated)' },
];

const GuestMockup = () => (
  <div style={{
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'Inter, sans-serif',
    userSelect: 'none',
  }}>
    {/* Browser chrome */}
    <div style={{
      backgroundColor: '#1a2844',
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#ef4444' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#22c55e' }} />
      </div>
      <div style={{
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: 10,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.01em',
      }}>
        cargotechnology.netlify.app/guests/john-doe/preferences
      </div>
    </div>

    {/* App body */}
    <div style={{ display: 'flex', backgroundColor: '#0d1a2e', height: 460 }}>

      {/* Sidebar */}
      <div style={{
        width: 180,
        flexShrink: 0,
        backgroundColor: '#0a1628',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{
            fontFamily: '"Archivo Black", sans-serif',
            fontWeight: 900,
            fontSize: 14,
            color: 'white',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>CARGO</span>
        </div>
        <nav style={{ padding: '8px 0' }}>
          {GUEST_NAV_ITEMS.map(item => {
            const active = item === 'Guests';
            return (
              <div key={item} style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? 'white' : 'rgba(255,255,255,0.4)',
                backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: active ? '2px solid #4A90E2' : '2px solid transparent',
                cursor: 'default',
              }}>{item}</div>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>

        {/* Back link */}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 2, cursor: 'default' }}>
          ← Back to Preferences
        </div>

        {/* Guest profile card */}
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: 10,
          padding: 14,
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}>
          {/* Avatar */}
          <div style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            backgroundColor: '#4A90E2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 14,
            color: 'white',
            flexShrink: 0,
          }}>JD</div>
          {/* Name + badges */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 6 }}>John Doe</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.2)',
                borderRadius: 4,
                padding: '2px 7px',
              }}>Allergies</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Cabin: Cabin 101</span>
            </div>
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {['↓ Export Preferences', '📅 Average Day'].map(label => (
              <div key={label} style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.6)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                padding: '5px 9px',
                cursor: 'default',
                whiteSpace: 'nowrap',
              }}>{label}</div>
            ))}
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#3B82F6',
              borderRadius: 6,
              padding: '5px 9px',
              cursor: 'default',
              whiteSpace: 'nowrap',
            }}>✦ Preference Assistant 100%</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: 20,
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          paddingBottom: 0,
        }}>
          {['Preferences', 'Trips', 'Comments', 'History'].map(tab => {
            const active = tab === 'Preferences';
            return (
              <div key={tab} style={{
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? '#3B82F6' : 'rgba(255,255,255,0.4)',
                paddingBottom: 8,
                borderBottom: active ? '2px solid #3B82F6' : '2px solid transparent',
                cursor: 'default',
              }}>{tab}</div>
            );
          })}
        </div>

        {/* Two-column content */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, flex: 1, minHeight: 0 }}>

          {/* Left: preference categories */}
          <div>
            {PREF_CATEGORIES.map((cat, i) => (
              <div key={cat.title} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  flexShrink: 0,
                }}>{cat.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'white', marginBottom: 2 }}>{cat.title}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{cat.meta}</div>
                </div>
                <div style={{
                  fontSize: 10,
                  color: '#4A90E2',
                  cursor: 'default',
                }}>Edit</div>
              </div>
            ))}
          </div>

          {/* Right: stacked panels */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Personality profile */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderRadius: 10,
              padding: 14,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: 10,
              }}>Personality Profile</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PERSONALITY_PILLS.map(({ label, active }) => (
                  <span key={label} style={{
                    fontSize: 10,
                    fontWeight: active ? 600 : 400,
                    color: active ? 'white' : 'rgba(255,255,255,0.45)',
                    backgroundColor: active ? '#3B82F6' : 'rgba(255,255,255,0.05)',
                    border: active ? 'none' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 20,
                    padding: '4px 10px',
                    cursor: 'default',
                  }}>{label}</span>
                ))}
              </div>
            </div>

            {/* Dining style */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderRadius: 10,
              padding: 14,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: 10,
              }}>Dining Style</div>
              {DINING_ROWS.map(({ meal, style }) => (
                <div key={meal} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{meal}</span>
                  <span style={{ fontSize: 10, color: 'white', fontWeight: 500 }}>{style}</span>
                </div>
              ))}
            </div>

          </div>
        </div>

      </div>
    </div>
  </div>
);

/* ─── Inventory Mockup ───────────────────────────────────────────────────── */
const INV_NAV_ITEMS = ['Today', 'Inventory', 'Crew', 'Trips', 'Guests', 'Defects', 'Jobs'];

const FOLDERS = [
  { name: 'Galley',       count: '0 items · 11 folders', active: false },
  { name: 'Interior',     count: '0 items · 4 folders',  active: false },
  { name: 'Bridge',       count: '0 items',              active: false },
  { name: 'Engineering',  count: '0 items',              active: false },
  { name: 'Medical',      count: '341 items · 1 folder', active: true  },
  { name: 'Deck',         count: '0 items',              active: false },
  { name: 'Security',     count: '0 items',              active: false },
  { name: 'Spa',          count: '0 items',              active: false },
];

const INV_ITEMS = [
  { name: 'Aciclovir 5% cream 2g',              meta: '# CARGO–000145 · Exp 31 Jul 2027', qty: 1 },
  { name: 'Antacid - alginate sodium 500mg tab', meta: '# CARGO–000126 · Exp 01 Jan 2026', qty: 1 },
  { name: 'Anusol cream 23g',                    meta: '# CARGO–000129 · Exp 30 Apr 2027', qty: 1 },
];

const FolderIcon = () => (
  <svg width="20" height="16" viewBox="0 0 20 16" fill="none" style={{ display: 'block', marginBottom: 8 }}>
    <path d="M0 2.5A2.5 2.5 0 012.5 0h3.586a1 1 0 01.707.293L8.414 1.5H17.5A2.5 2.5 0 0120 4v9.5a2.5 2.5 0 01-2.5 2.5h-15A2.5 2.5 0 010 13.5V2.5z" fill="#4A90E2" fillOpacity="0.7"/>
  </svg>
);

const InventoryMockup = () => (
  <div style={{
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'Inter, sans-serif',
    userSelect: 'none',
  }}>
    {/* Browser chrome */}
    <div style={{
      backgroundColor: '#1a2844',
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#ef4444' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#22c55e' }} />
      </div>
      <div style={{
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: 10,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.01em',
      }}>
        cargotechnology.netlify.app/inventory
      </div>
    </div>

    {/* App body */}
    <div style={{ display: 'flex', backgroundColor: '#0d1a2e', height: 480 }}>

      {/* Sidebar */}
      <div style={{
        width: 180,
        flexShrink: 0,
        backgroundColor: '#0a1628',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{
            fontFamily: '"Archivo Black", sans-serif',
            fontWeight: 900,
            fontSize: 14,
            color: 'white',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>CARGO</span>
        </div>
        <nav style={{ padding: '8px 0' }}>
          {INV_NAV_ITEMS.map(item => {
            const active = item === 'Inventory';
            return (
              <div key={item} style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? 'white' : 'rgba(255,255,255,0.4)',
                backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: active ? '2px solid #4A90E2' : '2px solid transparent',
                cursor: 'default',
              }}>{item}</div>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

        {/* Row 1: header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>Inventory</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Department folders</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['↓ Export', '📄 Import document'].map(label => (
              <div key={label} style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.6)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                padding: '5px 10px',
                cursor: 'default',
                whiteSpace: 'nowrap',
              }}>{label}</div>
            ))}
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#3B82F6',
              borderRadius: 6,
              padding: '5px 10px',
              cursor: 'default',
            }}>+ Add ▾</div>
          </div>
        </div>

        {/* Row 2: folder grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}>
          {FOLDERS.map(folder => (
            <div key={folder.name} style={{
              backgroundColor: folder.active ? 'rgba(74,144,226,0.05)' : 'rgba(255,255,255,0.05)',
              borderRadius: 8,
              padding: 12,
              border: folder.active ? '1px solid rgba(74,144,226,0.4)' : '1px solid rgba(255,255,255,0.06)',
              cursor: 'default',
            }}>
              <FolderIcon />
              <div style={{ fontSize: 11, fontWeight: 700, color: 'white', marginBottom: 3 }}>{folder.name}</div>
              <div style={{ fontSize: 9, color: folder.active ? '#4A90E2' : 'rgba(255,255,255,0.35)' }}>{folder.count}</div>
            </div>
          ))}
        </div>

        {/* Row 3: section label */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
          }}>Items (74)</span>
          <span style={{ fontSize: 10, color: '#4A90E2', cursor: 'default' }}>Select All</span>
        </div>

        {/* Row 4: inventory items */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {INV_ITEMS.map(item => (
            <div key={item.name} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: 7,
              padding: '9px 12px',
              marginBottom: 5,
              border: '1px solid rgba(255,255,255,0.04)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'white', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{item.meta}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  backgroundColor: 'rgba(239,68,68,0.2)',
                  color: '#ef4444',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600, cursor: 'default',
                }}>−</div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'white', minWidth: 14, textAlign: 'center' }}>{item.qty}</span>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  backgroundColor: 'rgba(34,197,94,0.2)',
                  color: '#22c55e',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600, cursor: 'default',
                }}>+</div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  </div>
);

/* ─── Jobs & Tasks Mockup ────────────────────────────────────────────────── */
const JOBS_NAV_ITEMS = ['Today', 'Inventory', 'Crew', 'Trips', 'Guests', 'Defects', 'Jobs'];

const OPEN_JOBS = [
  { title: 'Laundry',   date: 'Mar 22' },
  { title: 'Crew Mess', date: 'Mar 22' },
];

const COMPLETED_JOBS = [
  { title: "Captain's Cabin", date: 'Mar 21' },
  { title: 'Stairs',          date: 'Mar 20' },
  { title: 'Bridge',          date: 'Mar 19' },
];

const JobCard = ({ title, date, done }) => (
  <div style={{
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 6,
    border: '1px solid rgba(255,255,255,0.05)',
    opacity: done ? 0.4 : 1,
  }}>
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      color: 'white',
      marginBottom: 5,
      textDecoration: done ? 'line-through' : 'none',
    }}>{title}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{date}</span>
    </div>
  </div>
);

const JobsMockup = () => (
  <div style={{
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'Inter, sans-serif',
    userSelect: 'none',
  }}>
    {/* Browser chrome */}
    <div style={{
      backgroundColor: '#1a2844',
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#ef4444' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#22c55e' }} />
      </div>
      <div style={{
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: 10,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: '0.01em',
      }}>
        cargotechnology.netlify.app/jobs
      </div>
    </div>

    {/* App body */}
    <div style={{ display: 'flex', backgroundColor: '#0d1a2e', height: 500 }}>

      {/* Sidebar */}
      <div style={{
        width: 180,
        flexShrink: 0,
        backgroundColor: '#0a1628',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{
            fontFamily: '"Archivo Black", sans-serif',
            fontWeight: 900,
            fontSize: 14,
            color: 'white',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>CARGO</span>
        </div>
        <nav style={{ padding: '8px 0' }}>
          {JOBS_NAV_ITEMS.map(item => {
            const active = item === 'Jobs';
            return (
              <div key={item} style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? 'white' : 'rgba(255,255,255,0.4)',
                backgroundColor: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: active ? '2px solid #4A90E2' : '2px solid transparent',
                cursor: 'default',
              }}>{item}</div>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>

        {/* Row 1: header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>Jobs</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Manage all team tasks and boards</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {['Department: Interior ▾', 'Pending Acceptance (0)', '↻ Manage Rotation'].map(label => (
              <div key={label} style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                padding: '5px 9px',
                cursor: 'default',
                whiteSpace: 'nowrap',
              }}>{label}</div>
            ))}
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#3B82F6',
              borderRadius: 6,
              padding: '5px 10px',
              cursor: 'default',
            }}>+ Create Job</div>
          </div>
        </div>

        {/* Row 2: Kanban grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Column 1: Open Jobs */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>Open Jobs</span>
              <span style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.3)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                padding: '1px 7px',
                borderRadius: 10,
              }}>2 tasks</span>
            </div>
            {OPEN_JOBS.map(j => <JobCard key={j.title} title={j.title} date={j.date} done={false} />)}
            <div style={{ fontSize: 9, color: '#22c55e', margin: '6px 0 8px', cursor: 'default' }}>
              ✓ Completed today (34)
            </div>
            {COMPLETED_JOBS.map(j => <JobCard key={j.title} title={j.title} date={j.date} done={true} />)}
          </div>

          {/* Column 2: Dailies — empty state */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'white', marginBottom: 10 }}>Dailies</div>
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              paddingBottom: 24,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 10,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
                  <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
                </svg>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>No jobs for Interior</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>Nothing due today and nothing overdue.</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 12 }}>Total: 0</div>
              <div style={{ fontSize: 10, color: '#4A90E2', marginTop: 10, cursor: 'default' }}>+ Add a job...</div>
            </div>
          </div>

          {/* Column 3: New Board */}
          <div style={{
            border: '2px dashed rgba(255,255,255,0.08)',
            borderRadius: 10,
            backgroundColor: 'rgba(255,255,255,0.02)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '30px 12px',
            gap: 6,
            cursor: 'default',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: 'rgba(255,255,255,0.4)',
            }}>+</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>New Board</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>Create a custom board for your team</div>
          </div>

        </div>
      </div>
    </div>
  </div>
);

/* ─── Feature Section ─────────────────────────────────────────────────────── */
const FeatureSection = ({ eyebrow, heading, body, tags, odd, mockup }) => (
  <section style={{
    padding: '80px 0',
    backgroundColor: odd ? '#F8FAFC' : 'white',
    borderBottom: '2px solid #1E3A5F',
  }}>
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 48px' }}>
      {/* Top: two-column text row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start', marginBottom: 48 }}>
        {/* Left: eyebrow + heading + body */}
        <div>
          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#4A90E2',
            margin: '0 0 10px',
          }}>
            {eyebrow}
          </p>
          <h2 style={{
            fontFamily: '"Archivo Black", sans-serif',
            fontWeight: 900,
            fontSize: 32,
            color: '#1E3A5F',
            lineHeight: 1.1,
            margin: '0 0 14px',
          }}>
            {heading}
          </h2>
          <p style={{
            fontFamily: '"DM Sans", sans-serif',
            fontSize: 16,
            color: '#64748B',
            lineHeight: 1.65,
            margin: 0,
          }}>
            {body}
          </p>
        </div>
        {/* Right: feature tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start', paddingTop: 4 }}>
          {tags.map(tag => (
            <span key={tag} style={{
              fontFamily: '"Archivo Black", sans-serif',
              fontWeight: 700,
              fontSize: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#1E3A5F',
              padding: '4px 11px',
              borderRadius: 20,
              border: '1.5px solid #1E3A5F',
              display: 'inline-block',
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      {/* Bottom: mockup or placeholder */}
      {mockup ?? (
        <div style={{
          backgroundColor: '#0d1a2e',
          height: 400,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>
            Screen mockup coming
          </span>
        </div>
      )}
    </div>
  </section>
);

/* ─── Page ───────────────────────────────────────────────────────────────── */
const FeaturesPage = () => (
  <MarketingLayout>
    {/* Hero */}
    <section style={{ backgroundColor: '#1E3A5F', padding: '80px 32px', textAlign: 'center' }}>
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.4)',
        margin: '0 0 16px',
      }}>
        Features
      </p>
      <h1 style={{
        fontFamily: '"Archivo Black", sans-serif',
        fontWeight: 900,
        fontSize: 52,
        color: 'white',
        textTransform: 'uppercase',
        lineHeight: 0.95,
        margin: '0 0 24px',
      }}>
        EVERY FEATURE YOUR CREW NEEDS.
      </h1>
      <p style={{
        fontFamily: '"DM Sans", sans-serif',
        fontSize: 16,
        color: 'rgba(255,255,255,0.5)',
        maxWidth: 520,
        margin: '0 auto',
        lineHeight: 1.65,
      }}>
        Cargo is built deep, not wide. Each module has the features real vessel teams need — not watered-down versions of generic software.
      </p>
    </section>

    {/* Section 1: Crew & Scheduling */}
    <FeatureSection
      odd={true}
      eyebrow="Crew & Scheduling"
      heading="Your crew, organised and accountable."
      body="Duty sets, rotation planning and job lists — all connected. Every crew member knows what they're doing and when, without a spreadsheet in sight."
      tags={['Duty Sets', 'Rotation Calendar', 'Auto Rotate', 'Team Jobs', 'Crew Profiles', 'Export Schedule']}
      mockup={<CrewMockup />}
    />

    {/* Section 2: Guest & Preferences */}
    <FeatureSection
      odd={false}
      eyebrow="Guest & Preferences"
      heading="Know your guests before they board."
      body="A 10-step preference assistant captures everything — allergies, dining style, service preferences, personality — so every trip starts with the full picture."
      tags={['Guest Profiles', 'Preference Assistant', 'Allergies & Medical', 'Food & Drink', 'Service Style', 'Trip History']}
      mockup={<GuestMockup />}
    />

    {/* Section 3: Inventory */}
    <FeatureSection
      odd={true}
      eyebrow="Inventory"
      heading="Know exactly what you have and where."
      body="Department folders, location hierarchy and real-time item tracking. From the medical cabinet to the galley stores — every item accounted for, every expiry date tracked."
      tags={['Department Folders', 'Location Hierarchy', 'Bulk Import', 'Expiry Tracking', 'CARGO Item IDs', 'Export']}
      mockup={<InventoryMockup />}
    />

    {/* Section 4: Jobs & Tasks */}
    <FeatureSection
      odd={false}
      eyebrow="Jobs & Tasks"
      heading="Every task assigned, nothing lost."
      body="Department job lists, daily task boards and recurring templates. Every task has an owner, a due date and a status the whole team can see."
      tags={['Open Jobs', 'Dailies Board', 'Custom Boards', 'Department Filter', 'Task Notes', 'Manage Rotation']}
      mockup={<JobsMockup />}
    />

    {/* CTA */}
    <section style={{ backgroundColor: '#1E3A5F', padding: '80px 32px', textAlign: 'center' }}>
      <p style={{
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.35)',
        margin: '0 0 16px',
      }}>
        Want to see these in action?
      </p>
      <h2 style={{
        fontFamily: '"Archivo Black", sans-serif',
        fontWeight: 900,
        fontSize: 40,
        color: 'white',
        textTransform: 'uppercase',
        lineHeight: 1.05,
        margin: '0 auto 18px',
        maxWidth: 720,
      }}>
        BOOK A DEMO AND WE'LL WALK THROUGH EVERY MODULE WITH YOU.
      </h2>
      <p style={{
        fontFamily: '"DM Sans", sans-serif',
        fontSize: 15,
        color: 'rgba(255,255,255,0.5)',
        margin: '0 auto 32px',
        maxWidth: 400,
      }}>
        30 minutes. Your vessel in mind. No generic walkthroughs.
      </p>
      <Link
        to="/contact"
        style={{
          display: 'inline-block',
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#1E3A5F',
          backgroundColor: 'white',
          borderRadius: 50,
          padding: '14px 32px',
          textDecoration: 'none',
        }}
      >
        BOOK A DEMO
      </Link>
    </section>
  </MarketingLayout>
);

export default FeaturesPage;
