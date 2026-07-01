import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Anchor, Check, Trash2, Plus, ChevronRight, ChevronLeft, Ship, User, Users, Building2, Utensils, Briefcase, ClipboardList, MapPin, Camera } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { showToast } from '../../utils/toast';
import { createCrewInvite, sendCrewInvite } from '../../utils/crewInvites';
import { getAllDecks, createDeck } from '../locations-management-settings/utils/locationsHierarchyStorage';
import './onboarding.css';

/*
  Post-signup onboarding flow.
  Route: /onboarding — runs between /set-password and /dashboard for
  brand-new vessels. Guarded by OnboardingRoute (defined below) which
  bounces the user to /dashboard if tenants.onboarding_completed_at is
  already set.

  Three steps, each in its own self-contained state slice:
    1. Vessel settings  — saves to public.tenants (columns already exist)
    2. Departments      — base departments selected via tenants.departments_in_use;
                          custom "Other" departments saved to profiles.custom_departments
    3. Invite crew      — "Do this later" is the primary CTA per locked design;
                          invite sending is wired if the user clicks Send invites

  All copy lifted verbatim from docs/handoffs/onboarding-flow-mockup.jsx
  (signed off with Lauren). Styling is the standard raised Cargo border:
  1px navy top/sides, 3px navy bottom.
*/

// ── Brand tokens — Cargo editorial (see CLAUDE.md) ────────────────
const NAVY      = '#1C1B3A'; // navy ink — headings, structural fills
const NAVY_DARK = '#141330'; // deeper ink for hover states
const ACCENT    = '#C65A1A'; // terracotta — primary actions, selected, emphasis
const ACCENT_HOVER = '#B14E16';
const ACCENT_SOFT  = '#FBEFE9'; // tinted terracotta pill/selection background
const CHARCOAL  = '#1C1B3A'; // body/label text — unified with navy ink
const MUTED     = '#8B8478';
const MUTED_SOFT = '#6B7280';
const BORDER    = '#ECEAE3'; // soft hairline
const CARD      = '#FFFFFF';

const HEADING_FONT = "'DM Serif Display', 'DM Serif Text', Georgia, serif";
const BODY_FONT    = "'Inter', system-ui, sans-serif";
const PILL_FONT    = "'Inter', system-ui, sans-serif";

// Editorial panel — soft hairline border, 14px radius, gentle shadow.
// Replaces the old "raised Cargo border" (1px navy sides / 3px navy
// bottom) — see CLAUDE.md: "No heavy boxed cards."
const CARD_STYLE = {
  backgroundColor: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  boxShadow: '0 8px 24px -14px rgba(28,27,58,0.18)',
};

// ── Department data (Departments + InviteCrewStep) ────────────────
const DEPARTMENT_ICONS = {
  BRIDGE:      Anchor,
  INTERIOR:    Users,
  DECK:        Ship,
  ENGINEERING: Building2,
  GALLEY:      Utensils,
};

const BASE_DEPARTMENTS = [
  { id: 'BRIDGE',      name: 'Bridge',      icon: Anchor    },
  { id: 'INTERIOR',    name: 'Interior',    icon: Users     },
  { id: 'DECK',        name: 'Deck',        icon: Ship      },
  { id: 'ENGINEERING', name: 'Engineering', icon: Building2 },
  { id: 'GALLEY',      name: 'Galley',      icon: Utensils  },
];

const ROLES_BY_DEPT = {
  BRIDGE:      ['Captain', 'Chief Officer', 'Second Officer', 'Third Officer'],
  INTERIOR:    ['Chief Stew', 'Second Stew', 'Stew', 'Junior Stew'],
  DECK:        ['Bosun', 'Lead Deckhand', 'Deckhand'],
  ENGINEERING: ['Chief Engineer', 'Second Engineer', 'Engineer', 'ETO'],
  GALLEY:      ['Head Chef', 'Sous Chef', 'Crew Chef'],
};

// ── Vessel data constants (VesselSettingsStep) ────────────────────
const VESSEL_TYPES        = ['Motor Yacht', 'Sailing Yacht', 'Catamaran', 'Explorer', 'Sport Yacht', 'Superyacht'];
const COMMERCIAL_STATUSES = ['Private', 'Charter', 'Dual-use'];
const AREAS_OF_OPERATION  = ['Coastal', 'Near Coastal', 'Unlimited'];

// Stored as free text on vessels.seasonal_pattern (same column Vessel
// Settings edits as a plain input) — these are just friendly presets so
// most captains never have to type it out. "Other" reveals a text field.
const SEASONAL_PATTERNS = [
  'Single season (stays in one region year-round)',
  'Dual season (e.g., Summer Med, Winter Caribbean)',
  'Multi-season (relocates several times a year)',
];

// ── Operating regions — ISO 3166-1 alpha-2 ────────────────────────
const REGION_GROUPS = [
  { id: 'caribbean',       label: 'Caribbean',       codes: ['AG','AI','AW','BB','BL','BS','CU','CW','DM','DO','GD','GP','HT','JM','KN','KY','LC','MF','MQ','MS','PR','SX','TC','TT','VC','VG','VI'] },
  { id: 'mediterranean',   label: 'Mediterranean',   codes: ['AL','BA','CY','DZ','EG','ES','FR','GR','HR','IL','IT','LB','LY','MA','MC','ME','MT','RS','SI','SM','TN','TR'] },
  { id: 'northern_europe', label: 'Northern Europe', codes: ['BE','DE','DK','EE','FI','FO','GB','GG','IE','IM','IS','JE','LT','LV','NL','NO','PL','SE'] },
  { id: 'atlantic',        label: 'Atlantic',        codes: ['BM','BR','CV','GH','GL','MR','NA','PM','PT','SH','SN','US'] },
  { id: 'pacific',         label: 'Pacific',         codes: ['AU','CK','FJ','FM','GU','KI','MH','NC','NR','NZ','PF','PG','PW','SB','TO','TV','VU','WS'] },
  { id: 'indian_ocean',    label: 'Indian Ocean',    codes: ['BH','DJ','IN','KE','KM','LK','MG','MU','MV','MZ','OM','PK','QA','RE','SA','SC','SO','TZ','YE','ZA'] },
];

const ALL_COUNTRIES = [
  { code: 'AD', name: 'Andorra' }, { code: 'AE', name: 'United Arab Emirates' }, { code: 'AG', name: 'Antigua & Barbuda' },
  { code: 'AI', name: 'Anguilla' }, { code: 'AL', name: 'Albania' }, { code: 'AO', name: 'Angola' },
  { code: 'AR', name: 'Argentina' }, { code: 'AU', name: 'Australia' }, { code: 'AW', name: 'Aruba' },
  { code: 'BA', name: 'Bosnia & Herzegovina' }, { code: 'BB', name: 'Barbados' }, { code: 'BE', name: 'Belgium' },
  { code: 'BH', name: 'Bahrain' }, { code: 'BL', name: 'St Barthélemy' }, { code: 'BM', name: 'Bermuda' },
  { code: 'BR', name: 'Brazil' }, { code: 'BS', name: 'Bahamas' }, { code: 'CA', name: 'Canada' },
  { code: 'CK', name: 'Cook Islands' }, { code: 'CU', name: 'Cuba' }, { code: 'CV', name: 'Cape Verde' },
  { code: 'CW', name: 'Curaçao' }, { code: 'CY', name: 'Cyprus' }, { code: 'DE', name: 'Germany' },
  { code: 'DJ', name: 'Djibouti' }, { code: 'DK', name: 'Denmark' }, { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominican Republic' }, { code: 'DZ', name: 'Algeria' }, { code: 'EE', name: 'Estonia' },
  { code: 'EG', name: 'Egypt' }, { code: 'ES', name: 'Spain' }, { code: 'FI', name: 'Finland' },
  { code: 'FJ', name: 'Fiji' }, { code: 'FM', name: 'Micronesia' }, { code: 'FO', name: 'Faroe Islands' },
  { code: 'FR', name: 'France' }, { code: 'GB', name: 'United Kingdom' }, { code: 'GD', name: 'Grenada' },
  { code: 'GG', name: 'Guernsey' }, { code: 'GH', name: 'Ghana' }, { code: 'GL', name: 'Greenland' },
  { code: 'GP', name: 'Guadeloupe' }, { code: 'GR', name: 'Greece' }, { code: 'GU', name: 'Guam' },
  { code: 'HR', name: 'Croatia' }, { code: 'HT', name: 'Haiti' }, { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' }, { code: 'IM', name: 'Isle of Man' }, { code: 'IN', name: 'India' },
  { code: 'IS', name: 'Iceland' }, { code: 'IT', name: 'Italy' }, { code: 'JE', name: 'Jersey' },
  { code: 'JM', name: 'Jamaica' }, { code: 'JP', name: 'Japan' }, { code: 'KE', name: 'Kenya' },
  { code: 'KI', name: 'Kiribati' }, { code: 'KM', name: 'Comoros' }, { code: 'KN', name: 'St Kitts & Nevis' },
  { code: 'KY', name: 'Cayman Islands' }, { code: 'LB', name: 'Lebanon' }, { code: 'LC', name: 'St Lucia' },
  { code: 'LK', name: 'Sri Lanka' }, { code: 'LT', name: 'Lithuania' }, { code: 'LV', name: 'Latvia' },
  { code: 'LY', name: 'Libya' }, { code: 'MA', name: 'Morocco' }, { code: 'MC', name: 'Monaco' },
  { code: 'ME', name: 'Montenegro' }, { code: 'MF', name: 'St Martin (French)' }, { code: 'MG', name: 'Madagascar' },
  { code: 'MH', name: 'Marshall Islands' }, { code: 'MQ', name: 'Martinique' }, { code: 'MR', name: 'Mauritania' },
  { code: 'MS', name: 'Montserrat' }, { code: 'MT', name: 'Malta' }, { code: 'MU', name: 'Mauritius' },
  { code: 'MV', name: 'Maldives' }, { code: 'MX', name: 'Mexico' }, { code: 'MZ', name: 'Mozambique' },
  { code: 'NA', name: 'Namibia' }, { code: 'NC', name: 'New Caledonia' }, { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' }, { code: 'NR', name: 'Nauru' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'OM', name: 'Oman' }, { code: 'PF', name: 'French Polynesia' }, { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PH', name: 'Philippines' }, { code: 'PK', name: 'Pakistan' }, { code: 'PL', name: 'Poland' },
  { code: 'PM', name: 'St Pierre & Miquelon' }, { code: 'PR', name: 'Puerto Rico' }, { code: 'PT', name: 'Portugal' },
  { code: 'PW', name: 'Palau' }, { code: 'QA', name: 'Qatar' }, { code: 'RE', name: 'Réunion' },
  { code: 'RS', name: 'Serbia' }, { code: 'SA', name: 'Saudi Arabia' }, { code: 'SB', name: 'Solomon Islands' },
  { code: 'SC', name: 'Seychelles' }, { code: 'SE', name: 'Sweden' }, { code: 'SH', name: 'St Helena' },
  { code: 'SI', name: 'Slovenia' }, { code: 'SM', name: 'San Marino' }, { code: 'SN', name: 'Senegal' },
  { code: 'SO', name: 'Somalia' }, { code: 'SX', name: 'Sint Maarten' }, { code: 'TC', name: 'Turks & Caicos' },
  { code: 'TN', name: 'Tunisia' }, { code: 'TO', name: 'Tonga' }, { code: 'TR', name: 'Turkey' },
  { code: 'TT', name: 'Trinidad & Tobago' }, { code: 'TV', name: 'Tuvalu' }, { code: 'TZ', name: 'Tanzania' },
  { code: 'US', name: 'United States' }, { code: 'VC', name: 'St Vincent & Grenadines' }, { code: 'VG', name: 'British Virgin Islands' },
  { code: 'VI', name: 'US Virgin Islands' }, { code: 'VN', name: 'Vietnam' }, { code: 'VU', name: 'Vanuatu' },
  { code: 'WS', name: 'Samoa' }, { code: 'YE', name: 'Yemen' }, { code: 'ZA', name: 'South Africa' },
];

// ── Department icon map (keyed by normalized department name substring) ──
const DEPT_ICON_MAP = {
  deck: Anchor,
  bridge: Ship, engineering: Ship, engine: Ship,
  interior: Users, service: Users, stew: Users, housekeeping: Users,
  galley: Utensils, culinary: Utensils, chef: Utensils, kitchen: Utensils,
  purser: Briefcase, admin: Briefcase, management: Briefcase, office: Briefcase,
  operations: ClipboardList, ops: ClipboardList, logistics: ClipboardList,
  security: Building2, spa: Building2, wellness: Building2,
};

function iconForDept(name) {
  if (!name) return Briefcase;
  const n = String(name).toLowerCase();
  for (const key of Object.keys(DEPT_ICON_MAP)) {
    if (n.includes(key)) return DEPT_ICON_MAP[key];
  }
  return Briefcase;
}

// ── Shared UI atoms ───────────────────────────────────────────────

// ? pill tooltip — NAVY background, white text, keyboard-accessible via :focus-within
const Tooltip = ({ text }) => (
  <span className="relative inline-flex items-center group" tabIndex={0}>
    <span
      className="ml-1.5 w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] cursor-help"
      style={{ backgroundColor: '#E2E8F0', color: '#475569', fontFamily: BODY_FONT, fontWeight: 700 }}
    >
      ?
    </span>
    <span
      className="pointer-events-none absolute left-6 top-0 z-20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150"
      style={{
        backgroundColor: NAVY,
        color: 'white',
        fontFamily: BODY_FONT,
        fontSize: 11,
        lineHeight: 1.4,
        padding: '6px 10px',
        borderRadius: 6,
        width: 220,
        boxShadow: '0 6px 20px rgba(30,58,95,0.25)',
      }}
    >
      {text}
    </span>
  </span>
);

// Editorial panel — soft hairline border, gentle shadow (see CARD_STYLE)
const Card = ({ children, className = '' }) => (
  <div className={`p-6 ${className}`} style={CARD_STYLE}>
    {children}
  </div>
);

// Tracked-caps editorial section label
const SectionHeading = ({ children }) => (
  <h2
    className="mb-4"
    style={{
      fontFamily: PILL_FONT,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: MUTED,
    }}
  >
    {children}
  </h2>
);

// Field wrapper — label + optional required asterisk + tooltip + input slot
const Field = ({ label, required, tooltip, children }) => (
  <div>
    <label
      className="flex items-center text-sm mb-1.5"
      style={{ color: CHARCOAL, fontFamily: BODY_FONT, fontWeight: 600 }}
    >
      <span>
        {label}
        {required && <span style={{ color: '#DC2626' }}> *</span>}
      </span>
      {tooltip && <Tooltip text={tooltip} />}
    </label>
    {children}
  </div>
);

// Base inline fallback (kept for the `...(props.style || {})` merge below);
// border/background/focus now live in onboarding.css under .ob-field so a
// real CSS :focus halo can apply (inline border-color can't be beaten by a
// stylesheet rule of the same property).
const inputStyle = {
  fontFamily: BODY_FONT,
  color: CHARCOAL,
  fontSize: 14,
};

const TextInput = (props) => (
  <input {...props} className={`ob-field ${props.className || ''}`} style={{ ...inputStyle, ...(props.style || {}) }} />
);

const SelectInput = ({ options, ...props }) => (
  <select {...props} className={`ob-field ${props.className || ''}`} style={{ ...inputStyle, appearance: 'auto', ...(props.style || {}) }}>
    <option value="">Select…</option>
    {options.map((o) => (
      <option key={o} value={o}>{o}</option>
    ))}
  </select>
);

const Checkbox = ({ checked, onChange, label }) => (
  <label className="inline-flex items-center gap-2 cursor-pointer" style={{ fontFamily: BODY_FONT }}>
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 rounded"
      style={{ accentColor: ACCENT }}
    />
    <span className="text-sm" style={{ color: CHARCOAL }}>{label}</span>
  </label>
);

const PillPrimary = ({ children, onClick, disabled, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-2 transition-colors ${disabled ? '' : 'cg-breath'}`}
    style={{
      backgroundColor: ACCENT,
      color: 'white',
      borderRadius: 50,
      fontFamily: PILL_FONT,
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '12px 26px',
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = ACCENT_HOVER; }}
    onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = ACCENT; }}
  >
    {children}
  </button>
);

const PillSecondary = ({ children, onClick, disabled, type = 'button' }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center justify-center gap-2 transition-colors"
    style={{
      backgroundColor: '#fff',
      color: NAVY,
      border: `1px solid ${BORDER}`,
      borderRadius: 50,
      fontFamily: PILL_FONT,
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '11px 24px',
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.backgroundColor = ACCENT_SOFT; e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; } }}
    onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = NAVY; } }}
  >
    {children}
  </button>
);

const LinkButton = ({ children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 text-sm"
    style={{ color: NAVY, fontFamily: BODY_FONT }}
  >
    {children}
  </button>
);

// ─── Collapsed section summary row ────────────────────────────────
// Editorial hairline card + animated terracotta tick + EDIT affordance.
const CollapsedSection = ({ title, summary, onEdit }) => (
  <div className="mt-6 cg-anim-enter">
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center justify-between rounded-xl px-5 py-4 text-left cg-hover-lift"
      style={{ ...CARD_STYLE, fontFamily: BODY_FONT }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center cg-tick-pop"
          style={{ backgroundColor: ACCENT }}
        >
          <Check size={15} color="white" strokeWidth={3} />
        </div>
        <div>
          <div style={{ fontFamily: HEADING_FONT, fontWeight: 500, fontSize: 17, color: CHARCOAL }}>{title}</div>
          <div className="text-xs" style={{ color: MUTED_SOFT }}>{summary}</div>
        </div>
      </div>
      <span
        className="text-xs uppercase"
        style={{ fontFamily: PILL_FONT, color: ACCENT, letterSpacing: '0.08em', fontWeight: 700 }}
      >
        Edit
      </span>
    </button>
  </div>
);

// ── Operating regions searchable combobox ─────────────────────────
const RegionsCombobox = ({ value, onChange }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      const insideTrigger = containerRef.current?.contains(e.target);
      const insidePanel = panelRef.current?.contains(e.target);
      if (!insideTrigger && !insidePanel) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // The dropdown is portaled to <body> — it lives inside .onb-panel, which
  // scrolls (overflow-y: auto) for the taller vessel-particulars sections,
  // and an absolutely-positioned child there was getting clipped by that
  // scroll container instead of floating above it. Portaling means we have
  // to compute its screen position ourselves, and close it if the panel
  // scrolls underneath (rather than trying to track it in real time).
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    updatePosition();
    const closeOnScroll = () => setOpen(false);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const toggle = (code) =>
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  const toggleGroup = (group) => {
    const allIn = group.codes.every((c) => value.includes(c));
    onChange(allIn ? value.filter((c) => !group.codes.includes(c)) : [...new Set([...value, ...group.codes])]);
  };

  const q = query.toLowerCase();
  const filteredGroups    = REGION_GROUPS.filter((g) => !q || g.label.toLowerCase().includes(q));
  const filteredCountries = ALL_COUNTRIES.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  const selectedCountries = ALL_COUNTRIES.filter((c) => value.includes(c.code));

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ob-field"
        style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ color: value.length ? CHARCOAL : '#AEB4C2' }}>
          {value.length ? `${value.length} region${value.length !== 1 ? 's' : ''} selected` : 'Select regions…'}
        </span>
        <ChevronRight size={14} color={MUTED_SOFT} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease', flexShrink: 0 }} />
      </button>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          className="rounded-xl"
          style={{
            position: 'fixed', top: coords.top, left: coords.left, width: coords.width,
            zIndex: 1000, backgroundColor: CARD, border: `1px solid ${BORDER}`,
            boxShadow: '0 10px 30px rgba(28,27,58,0.15)', maxHeight: 300, overflowY: 'auto',
          }}
        >
          <div className="sticky top-0 p-2" style={{ backgroundColor: CARD, borderBottom: `1px solid ${BORDER}` }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search regions or countries…"
              autoFocus
              className="ob-field"
              style={{ ...inputStyle, padding: '6px 10px', fontSize: 13 }}
            />
          </div>
          {filteredGroups.length > 0 && (
            <div className="p-2" style={{ borderBottom: '1px solid #F0F1F5' }}>
              <div className="px-2 pb-1 text-[10px] uppercase" style={{ fontFamily: PILL_FONT, fontWeight: 700, letterSpacing: '0.10em', color: MUTED }}>Regions</div>
              {filteredGroups.map((group) => {
                const allIn = group.codes.every((c) => value.includes(c));
                const someIn = !allIn && group.codes.some((c) => value.includes(c));
                return (
                  <button key={group.id} type="button" onClick={() => toggleGroup(group)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between"
                    style={{ fontFamily: BODY_FONT, backgroundColor: allIn ? ACCENT_SOFT : 'transparent', color: CHARCOAL }}
                  >
                    <span>{group.label}</span>
                    {allIn && <Check size={13} color={ACCENT} />}
                    {someIn && <span className="text-xs" style={{ color: MUTED_SOFT }}>{group.codes.filter((c) => value.includes(c)).length}/{group.codes.length}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="p-2">
            <div className="px-2 pb-1 text-[10px] uppercase" style={{ fontFamily: PILL_FONT, fontWeight: 700, letterSpacing: '0.10em', color: MUTED }}>Countries</div>
            {filteredCountries.map((country) => (
              <button key={country.code} type="button" onClick={() => toggle(country.code)}
                className="w-full text-left px-2 py-1 rounded-lg text-sm flex items-center justify-between"
                style={{ fontFamily: BODY_FONT, backgroundColor: value.includes(country.code) ? ACCENT_SOFT : 'transparent', color: CHARCOAL }}
              >
                <span>{country.name}</span>
                {value.includes(country.code) && <Check size={12} color={ACCENT} />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {selectedCountries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedCountries.slice(0, 5).map((c) => (
            <span key={c.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{ backgroundColor: ACCENT_SOFT, color: ACCENT, fontFamily: BODY_FONT, fontWeight: 600 }}
            >
              {c.name}
              <button type="button" onClick={() => toggle(c.code)} style={{ color: ACCENT, lineHeight: 1, marginLeft: 2 }}>×</button>
            </span>
          ))}
          {selectedCountries.length > 5 && (
            <span className="text-xs" style={{ color: MUTED_SOFT, fontFamily: BODY_FONT, alignSelf: 'center' }}>
              +{selectedCountries.length - 5} more
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Step 1: Vessel settings — progressive disclosure ──────────────
// Three sub-sections: identity → specs → profile.
// Only the active section renders as a full Card; confirmed sections
// collapse to a CollapsedSection summary row. Clicking a collapsed row
// reopens that section.

const VesselSettingsStep = ({ tenant, onSaved }) => {
  const [section, setSection] = useState('identity'); // 'identity' | 'specs' | 'profile' | 'company'
  const [data, setData] = useState({
    vessel_name:          tenant?.name              || '',
    vessel_type_label:    tenant?.vessel_type_label  || '',
    flag:                 tenant?.flag               || '',
    port_of_registry:     tenant?.port_of_registry   || '',
    imo_number:           tenant?.imo_number          || '',
    official_number:      tenant?.official_number     || '',
    loa_m:                tenant?.loa_m     ?? '',
    gt:                   tenant?.gt        ?? '',
    year_built:           tenant?.year_built ?? '',
    year_refit:           tenant?.year_refit ?? '',
    propulsion_kw:        '',
    commercial_status:    tenant?.commercial_status    || '',
    certified_commercial: tenant?.certified_commercial ?? false,
    area_of_operation:    tenant?.area_of_operation    || '',
    operating_regions:    Array.isArray(tenant?.operating_regions) ? tenant.operating_regions : [],
    seasonal_pattern:     '',
    typical_guest_count:  tenant?.typical_guest_count  ?? '',
    typical_crew_count:   tenant?.typical_crew_count   ?? '',
    company_name:         '',
    company_address:      '',
    company_email:        '',
    company_phone:        '',
    company_postcode:     '',
    company_country:      '',
    logo_url:             '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [seasonalOtherMode, setSeasonalOtherMode] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState('');
  const logoFileInputRef = useRef(null);

  const set   = (k, v) => setData((prev) => ({ ...prev, [k]: v }));
  const field = (k)    => (e)  => set(k, e.target.value);

  // Propulsion/seasonal-pattern/company-details/logo live on public.vessels
  // (keyed by tenant_id), not public.tenants — mirrors how Vessel Settings
  // reads them. The row may not exist yet this early, hence maybeSingle().
  useEffect(() => {
    if (!tenant?.id) return;
    supabase
      .from('vessels')
      .select('propulsion_kw, seasonal_pattern, company_name, company_address, company_email, company_phone, company_postcode, company_country, logo_url')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
      .then(({ data: v }) => {
        if (!v) return;
        setData((prev) => ({
          ...prev,
          propulsion_kw:    v.propulsion_kw ?? '',
          seasonal_pattern: v.seasonal_pattern || '',
          company_name:     v.company_name || '',
          company_address:  v.company_address || '',
          company_email:    v.company_email || '',
          company_phone:    v.company_phone || '',
          company_postcode: v.company_postcode || '',
          company_country:  v.company_country || '',
          logo_url:         v.logo_url || '',
        }));
        if (v.seasonal_pattern && !SEASONAL_PATTERNS.includes(v.seasonal_pattern)) {
          setSeasonalOtherMode(true);
        }
      });
  }, [tenant?.id]);

  const identityDone = section !== 'identity';
  const specsDone    = section === 'profile' || section === 'company';
  const profileDone  = section === 'company';
  const heroTitle    = data.vessel_name ? `Welcome aboard ${data.vessel_name}` : 'Welcome aboard';

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setLogoUploadError('Logo must be a PNG or JPEG.');
      return;
    }
    if (file.size > 5242880) {
      setLogoUploadError('Image must be smaller than 5MB');
      return;
    }
    setUploadingLogo(true);
    setLogoUploadError('');
    try {
      const fileExt = file.type === 'image/png' ? 'png' : 'jpg';
      const filePath = `${tenant.id}/logo.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('vessel-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('vessel-assets').getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
      if (!publicUrl) throw new Error('Failed to get public URL');
      set('logo_url', publicUrl);
      await supabase.from('vessels').upsert({ tenant_id: tenant.id, logo_url: publicUrl }, { onConflict: 'tenant_id' });
    } catch (err) {
      console.error('[onboarding] logo upload failed', err);
      setLogoUploadError(err?.message || 'Upload failed. Try again.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    set('logo_url', '');
    await supabase.from('vessels').upsert({ tenant_id: tenant.id, logo_url: null }, { onConflict: 'tenant_id' });
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const payload = {
        name:               data.vessel_name      || tenant?.name || null,
        vessel_type_label:  data.vessel_type_label || null,
        flag:               data.flag              || null,
        port_of_registry:   data.port_of_registry  || null,
        imo_number:         data.imo_number         || tenant?.imo_number || null,
        official_number:    data.official_number    || null,
        loa_m:              data.loa_m     === '' ? null : Number(data.loa_m),
        gt:                 data.gt        === '' ? null : Number(data.gt),
        year_built:         data.year_built === '' ? null : Number(data.year_built),
        year_refit:         data.year_refit === '' ? null : Number(data.year_refit),
        commercial_status:  data.commercial_status  || null,
        certified_commercial: Boolean(data.certified_commercial),
        area_of_operation:  data.area_of_operation  || null,
        operating_regions:  data.operating_regions.length > 0 ? data.operating_regions : null,
        typical_guest_count:
          data.typical_guest_count === '' ? null : Number(data.typical_guest_count),
        typical_crew_count:
          data.typical_crew_count  === '' ? null : Number(data.typical_crew_count),
      };
      const { error: updateError } = await supabase
        .from('tenants')
        .update(payload)
        .eq('id', tenant.id);
      if (updateError) throw updateError;

      // Secondary — propulsion/seasonal pattern/company details live on
      // public.vessels. Best-effort: don't block onboarding if this fails,
      // since none of it is required to run the vessel day to day.
      const { error: vesselError } = await supabase
        .from('vessels')
        .upsert(
          {
            tenant_id:         tenant.id,
            propulsion_kw:     data.propulsion_kw === '' ? null : parseFloat(data.propulsion_kw),
            seasonal_pattern:  data.seasonal_pattern || null,
            company_name:      data.company_name?.trim() || null,
            company_address:   data.company_address?.trim() || null,
            company_email:     data.company_email?.trim() || null,
            company_phone:     data.company_phone?.trim() || null,
            company_postcode:  data.company_postcode?.trim() || null,
            company_country:   data.company_country?.trim() || null,
            logo_url:          data.logo_url || null,
          },
          { onConflict: 'tenant_id' }
        );
      if (vesselError) {
        console.error('[onboarding] vessel details save failed (non-fatal)', vesselError);
        showToast('Vessel saved — a few extra details (propulsion, company info) could not be saved. You can add them later in Vessel Settings.', 'warning');
      }

      onSaved(payload);
    } catch (err) {
      console.error('[onboarding] vessel save failed', err);
      setError(err?.message || 'Could not save vessel details. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cg-step-enter">
      {/* Hero */}
      <div className="mb-2">
        <h1 style={{ fontFamily: HEADING_FONT, fontSize: 26, fontWeight: 500, color: CHARCOAL, letterSpacing: '-0.02em' }}>
          {heroTitle}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
          Four quick sections. Everything here is editable later in Vessel Settings.
        </p>
      </div>

      {/* ── Section 1: Identity ── */}
      {section === 'identity' ? (
        <div className="mt-8 cg-anim-enter">
          <Card>
            <SectionHeading>Who is your boat?</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Vessel name" required tooltip="Used across Cargo and on crew-facing screens.">
                <TextInput value={data.vessel_name} placeholder="M/Y Belongers" onChange={field('vessel_name')} />
              </Field>
              <Field label="Vessel Type" required tooltip="Drives which default compliance modules show (sail vs motor vs commercial).">
                <SelectInput value={data.vessel_type_label} onChange={(e) => set('vessel_type_label', e.target.value)} options={VESSEL_TYPES} />
              </Field>
              <Field label="Flag" required tooltip="Determines which flag-state rules apply — REG, MCA, Marshall, etc.">
                <TextInput value={data.flag} placeholder="e.g., Cayman Islands" onChange={field('flag')} />
              </Field>
              <Field label="Port of Registry" required tooltip="Shown on official documents. Usually matches the port stamped on your certificate of registry.">
                <TextInput value={data.port_of_registry} placeholder="e.g., George Town" onChange={field('port_of_registry')} />
              </Field>
            </div>
            <div className="flex items-center justify-end mt-6">
              <PillPrimary onClick={() => setSection('specs')}>Continue</PillPrimary>
            </div>
          </Card>
        </div>
      ) : (
        <CollapsedSection
          title="Who is your boat?"
          summary={`${data.vessel_name || '—'} · ${data.vessel_type_label || '—'} · ${data.flag || '—'}`}
          onEdit={() => setSection('identity')}
        />
      )}

      {/* ── Section 2: Specs ── */}
      {section === 'specs' && (
        <div className="mt-6 cg-anim-enter">
          <Card>
            <SectionHeading>Her specs</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="IMO Number" tooltip="Pre-filled from your vessel verification at checkout. Can be corrected here.">
                <TextInput value={data.imo_number} placeholder="IMO 1234567" onChange={field('imo_number')} />
              </Field>
              <Field label="Official Number" tooltip="The flag-state assigned number on your certificate of registry. Optional.">
                <TextInput value={data.official_number} placeholder="e.g., 123456" onChange={field('official_number')} />
              </Field>
              <Field label="LOA (meters)" required tooltip="Length overall. Drives MLC watchkeeping ratios and berth planning.">
                <TextInput type="number" value={data.loa_m} placeholder="e.g., 50.5" onChange={field('loa_m')} />
              </Field>
              <Field label="Gross Tonnage (GT)" required tooltip="Used to determine tier of certification required for officers and engineers.">
                <TextInput type="number" value={data.gt} placeholder="e.g., 500" onChange={field('gt')} />
              </Field>
              <Field label="Year Built">
                <TextInput type="number" value={data.year_built} placeholder="e.g., 2015" onChange={field('year_built')} />
              </Field>
              <Field label="Year Refit">
                <TextInput type="number" value={data.year_refit} placeholder="e.g., 2020" onChange={field('year_refit')} />
              </Field>
              <Field label="Propulsion (kW)" tooltip="Engine power. Used for engineer sea-service testimonials.">
                <TextInput type="number" value={data.propulsion_kw} placeholder="e.g., 1200" onChange={field('propulsion_kw')} />
              </Field>
            </div>
            <div className="flex items-center justify-between mt-6">
              <LinkButton onClick={() => setSection('identity')}>
                <ChevronLeft size={14} /> Back
              </LinkButton>
              <PillPrimary onClick={() => setSection('profile')}>Continue</PillPrimary>
            </div>
          </Card>
        </div>
      )}
      {specsDone && (
        <CollapsedSection
          title="Her specs"
          summary={`${data.loa_m ? `LOA ${data.loa_m}m` : '—'} · ${data.gt ? `GT ${data.gt}` : '—'} · ${data.year_built || '—'}`}
          onEdit={() => setSection('specs')}
        />
      )}

      {/* ── Section 3: Operational Profile ── */}
      {section === 'profile' && (() => {
        const profileValid =
          Number(data.typical_guest_count) >= 1 &&
          Number(data.typical_crew_count) >= 1;
        return (
          <div className="mt-6 cg-anim-enter">
            <Card>
              <SectionHeading>How does she operate?</SectionHeading>

              {/* Vessel use — dropdown + the certification tick as its own
                  clearly-separated row, not crammed into the same column. */}
              <div className="mb-5 pb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Field label="Vessel Use" tooltip="Private, charter, or both — affects which compliance workflows are active.">
                    <select
                      value={data.commercial_status}
                      onChange={(e) => set('commercial_status', e.target.value)}
                      className="ob-field"
                      style={{ appearance: 'auto', fontFamily: BODY_FONT, color: CHARCOAL, fontSize: 14 }}
                    >
                      <option value="">Select…</option>
                      <option value="Private">Private</option>
                      <option value="Charter">Charter</option>
                      <option value="Dual-use">Both</option>
                    </select>
                  </Field>
                  <Field label="Area of Operation" tooltip="Coastal / Near Coastal / Unlimited — matches what's on your Safe Manning document.">
                    <SelectInput value={data.area_of_operation} onChange={(e) => set('area_of_operation', e.target.value)} options={AREAS_OF_OPERATION} />
                  </Field>
                </div>
                <div className="mt-4">
                  <Checkbox
                    checked={!!data.certified_commercial}
                    onChange={(e) => set('certified_commercial', e.target.checked)}
                    label="Certified Commercial"
                  />
                  <p className="text-xs mt-1 ml-6" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
                    Vessel holds MCA or flag-state commercial certification.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <Field label="Operating Regions" tooltip="Select countries or use regional shortcuts. Stored as ISO-3166-1 alpha-2 codes.">
                    <RegionsCombobox
                      value={data.operating_regions}
                      onChange={(codes) => set('operating_regions', codes)}
                    />
                  </Field>
                </div>

                <div className="md:col-span-2">
                  <Field label="Seasonal Pattern" tooltip="How the vessel moves through the year — informational, not a compliance field.">
                    <select
                      value={seasonalOtherMode ? '__other__' : data.seasonal_pattern}
                      onChange={(e) => {
                        if (e.target.value === '__other__') { setSeasonalOtherMode(true); set('seasonal_pattern', ''); }
                        else { setSeasonalOtherMode(false); set('seasonal_pattern', e.target.value); }
                      }}
                      className="ob-field"
                      style={{ appearance: 'auto', fontFamily: BODY_FONT, color: CHARCOAL, fontSize: 14 }}
                    >
                      <option value="">Select…</option>
                      {SEASONAL_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                      <option value="__other__">Other…</option>
                    </select>
                    {seasonalOtherMode && (
                      <TextInput
                        className="mt-2"
                        value={data.seasonal_pattern}
                        placeholder="e.g., Summer Med, Winter Caribbean"
                        onChange={field('seasonal_pattern')}
                      />
                    )}
                  </Field>
                </div>

                <Field label="Typical Guest Count" required tooltip="Minimum 1. Used for crew-to-guest ratio calculations.">
                  <TextInput
                    type="number"
                    min="1"
                    value={data.typical_guest_count}
                    placeholder="e.g., 12"
                    onChange={field('typical_guest_count')}
                  />
                </Field>
                <Field label="Typical Crew Count" required tooltip="Minimum 1. Used for Safe Manning and MLC compliance checks.">
                  <TextInput
                    type="number"
                    min="1"
                    value={data.typical_crew_count}
                    placeholder="e.g., 15"
                    onChange={field('typical_crew_count')}
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between mt-6">
                <LinkButton onClick={() => setSection('specs')}>
                  <ChevronLeft size={14} /> Back
                </LinkButton>
                <PillPrimary onClick={() => setSection('company')} disabled={!profileValid}>
                  Continue
                </PillPrimary>
              </div>
            </Card>
          </div>
        );
      })()}
      {profileDone && (
        <CollapsedSection
          title="How does she operate?"
          summary={`${data.commercial_status === 'Dual-use' ? 'Both' : (data.commercial_status || '—')} · ${data.typical_crew_count || '—'} crew · ${data.typical_guest_count || '—'} guests`}
          onEdit={() => setSection('profile')}
        />
      )}

      {/* ── Section 4: Company details ── */}
      {section === 'company' && (
        <div className="mt-6 cg-anim-enter">
          <Card>
            <SectionHeading>Who operates her?</SectionHeading>
            <p className="text-xs mb-4" style={{ color: '#64748B', fontFamily: BODY_FONT, marginTop: -8 }}>
              The owning / employing entity as it appears on crew contracts and sea-service testimonials.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Company / Owner Name">
                <TextInput value={data.company_name} placeholder="Registered owning / employing entity" onChange={field('company_name')} />
              </Field>
              <Field label="Company Email">
                <TextInput type="email" value={data.company_email} placeholder="Official company / yacht email" onChange={field('company_email')} />
              </Field>
              <Field label="Company Phone">
                <TextInput value={data.company_phone} placeholder="e.g., +44 …" onChange={field('company_phone')} />
              </Field>
              <Field label="Country">
                <TextInput value={data.company_country} placeholder="Country of the company / owner" onChange={field('company_country')} />
              </Field>
              <Field label="Post Code">
                <TextInput value={data.company_postcode} placeholder="ZIP / post code" onChange={field('company_postcode')} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Company Address">
                  <textarea
                    value={data.company_address}
                    onChange={field('company_address')}
                    rows={3}
                    className="ob-field"
                    style={{ fontFamily: BODY_FONT, color: CHARCOAL, fontSize: 14, resize: 'vertical' }}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Field label="Logo" tooltip="PNG or JPEG. Added to the page header of generated crew contracts.">
                <div className="flex items-center gap-3 mt-1">
                  {data.logo_url ? (
                    <img src={data.logo_url} alt="Company logo" className="h-12 object-contain rounded" style={{ maxWidth: 160, border: `1px solid ${BORDER}`, background: 'white', padding: 4 }} />
                  ) : (
                    <div className="h-12 flex items-center justify-center text-xs rounded" style={{ width: 160, border: `1px dashed ${BORDER}`, color: MUTED_SOFT, fontFamily: BODY_FONT }}>
                      No logo
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                    <PillSecondary onClick={() => logoFileInputRef.current?.click()} disabled={uploadingLogo}>
                      {uploadingLogo ? 'Uploading…' : data.logo_url ? 'Replace' : 'Upload'}
                    </PillSecondary>
                    {data.logo_url && (
                      <button type="button" onClick={handleRemoveLogo} className="text-xs" style={{ color: MUTED_SOFT, fontFamily: BODY_FONT }}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {logoUploadError && <p className="text-xs mt-1" style={{ color: '#A32D2D', fontFamily: BODY_FONT }}>{logoUploadError}</p>}
              </Field>
            </div>

            <p className="text-xs mt-5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
              Compliance fields (ISM, ISPS, MLC) and the dashboard hero image can be filled in later from Vessel Settings.
            </p>
            {error && (
              <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FCEBEB', color: '#A32D2D' }}>
                {error}
              </div>
            )}
            <div className="flex items-center justify-between mt-6">
              <LinkButton onClick={() => setSection('profile')}>
                <ChevronLeft size={14} /> Back
              </LinkButton>
              <PillPrimary onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Continue'}
              </PillPrimary>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ─── Step 2: Personal profile ──────────────────────────────────────
// Who's actually running this vessel — name + photo, so crew know who's
// aboard. Writes to profiles.full_name / profiles.avatar_url only; the
// tenant_members row (role COMMAND) is already set from signup.

const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_MB = 5;

const PersonalProfileStep = ({ userId, onSaved }) => {
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        setFullName(data?.full_name || '');
        setAvatarUrl(data?.avatar_url || '');
        setLoading(false);
      });
  }, [userId]);

  const handleFilePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setError(`Image must be under ${MAX_AVATAR_MB}MB.`);
      return;
    }
    setError('');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      setError('Please enter your name.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      let nextAvatarUrl = avatarUrl;
      if (avatarFile) {
        const filePath = `${userId}/${Date.now()}-${avatarFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .upload(filePath, avatarFile, { cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;
        const { data: urlData } = await supabase.storage
          .from(AVATAR_BUCKET)
          .createSignedUrl(filePath, 60 * 60 * 24 * 365);
        nextAvatarUrl = urlData?.signedUrl || nextAvatarUrl;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), avatar_url: nextAvatarUrl || null })
        .eq('id', userId);
      if (updateError) throw updateError;

      onSaved({ full_name: fullName.trim(), avatar_url: nextAvatarUrl });
    } catch (err) {
      console.error('[onboarding] profile save failed', err);
      setError(err?.message || 'Could not save your profile. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const initials = (fullName || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <div className="cg-step-enter">
      <div className="mb-4">
        <h1 style={{ fontFamily: HEADING_FONT, fontSize: 24, fontWeight: 500, color: CHARCOAL, letterSpacing: '-0.02em' }}>
          First, make it yours
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
          Add your name and a photo so your crew knows exactly who&rsquo;s aboard.
        </p>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: ACCENT }} />
          </div>
        ) : (
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-shrink-0">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: ACCENT_SOFT, border: `2px solid ${BORDER}` }}
              >
                {avatarPreview || avatarUrl ? (
                  <img src={avatarPreview || avatarUrl} alt="Your avatar" className="w-full h-full object-cover" />
                ) : (
                  <span style={{ fontFamily: HEADING_FONT, fontSize: 20, color: ACCENT }}>{initials}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ backgroundColor: NAVY, border: '2px solid white' }}
                aria-label="Upload photo"
              >
                <Camera size={11} color="white" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />
            </div>
            <div className="flex-1">
              <Field label="Your name" required>
                <TextInput
                  value={fullName}
                  placeholder="Jane Smith"
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FCEBEB', color: '#A32D2D' }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end">
          <PillPrimary onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Continue'}
          </PillPrimary>
        </div>
      </Card>
    </div>
  );
};

// ─── Step 3: Departments ────────────────────────────────────────────

const DepartmentsStep = ({ tenant, userId, onBack, onComplete }) => {
  const [depts, setDepts]               = useState([]);
  const [loadError, setLoadError]       = useState('');
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState([]);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState('');
  const [customDeptList, setCustomDeptList] = useState([]);
  const [customInput, setCustomInput]   = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const customInputRef = useRef(null);

  const loadDepts = async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .order('name', { ascending: true });
    if (error) {
      setLoadError(error.message || 'Could not load departments.');
      setLoading(false);
      return;
    }
    const rows = data || [];
    setDepts(rows);
    // Pre-select all returned departments by default (first load only)
    setSelected((prev) => (prev.length ? prev : rows.map((d) => d.id)));
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    // Restore prior selection from profile if user has been here before
    supabase
      .from('profiles')
      .select('custom_departments')
      .eq('id', userId)
      .single()
      .then(({ data: profile }) => {
        const saved = profile?.custom_departments;
        // New format: array of ID strings (not objects)
        if (Array.isArray(saved) && saved.length > 0 && typeof saved[0] === 'string') {
          setSelected(saved);
        }
      });
    loadDepts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tenant?.id]);

  const toggle = (id) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleContinue = async () => {
    setSaving(true);
    setSaveError('');
    try {
      // Persist selected dept IDs to profiles.custom_departments
      const { error: pErr } = await supabase
        .from('profiles')
        .update({ custom_departments: selected })
        .eq('id', userId);
      if (pErr) throw pErr;

      const allDeptObjects = [...depts, ...customDeptList];
      const selectedDepts = allDeptObjects.filter((d) => selected.includes(d.id));
      onComplete({ baseSelected: selected, customDepts: customDeptList, departments: selectedDepts });
    } catch (err) {
      console.error('[onboarding] departments save failed', err);
      setSaveError(err?.message || 'Could not save departments. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cg-step-enter">
      {/* Hero */}
      <div className="mb-2">
        <h1 style={{ fontFamily: HEADING_FONT, fontSize: 26, fontWeight: 500, color: CHARCOAL, letterSpacing: '-0.02em' }}>
          {tenant?.name ? `Which departments run on ${tenant.name}?` : 'Which departments are onboard?'}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
          Pick the ones your vessel runs — Cargo tailors visibility and boards to match.
        </p>
      </div>

      <Card className="mt-8">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: ACCENT }} />
          </div>
        ) : loadError ? (
          <div className="text-center py-6">
            <p className="text-sm px-3 py-2 rounded mb-4" style={{ backgroundColor: '#FCEBEB', color: '#A32D2D' }}>
              {loadError}
            </p>
            <PillSecondary onClick={loadDepts}>Retry</PillSecondary>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 cg-stagger">
              {depts.map((d, i) => {
                const DIcon = iconForDept(d.name);
                const isSelected = selected.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggle(d.id)}
                    className="relative rounded-xl p-4 text-left transition-all cg-anim-enter cg-hover-lift"
                    style={{ '--i': i, backgroundColor: isSelected ? ACCENT : 'white', border: `1px solid ${isSelected ? ACCENT : BORDER}`, color: isSelected ? 'white' : CHARCOAL }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                      style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.18)' : '#F6F5F2', color: isSelected ? 'white' : ACCENT }}
                    >
                      <DIcon size={18} />
                    </div>
                    <div className="text-sm" style={{ fontFamily: BODY_FONT, fontWeight: 600 }}>{d.name}</div>
                    {isSelected && (
                      <div
                        key={`tick-${d.id}`}
                        className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center cg-tick-pop"
                        style={{ backgroundColor: ACCENT }}
                      >
                        <Check size={12} color="white" />
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Custom (Other) department tiles */}
              {customDeptList.map((d) => {
                const isSelected = selected.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggle(d.id)}
                    className="relative rounded-xl p-4 text-left transition-all cg-hover-lift"
                    style={{ backgroundColor: isSelected ? ACCENT : 'white', border: `1px dashed ${isSelected ? ACCENT : '#AEB4C2'}`, color: isSelected ? 'white' : CHARCOAL }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                      style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.18)' : '#F6F5F2', color: isSelected ? 'white' : ACCENT }}
                    >
                      <Briefcase size={18} />
                    </div>
                    <div className="text-sm" style={{ fontFamily: BODY_FONT, fontWeight: 600 }}>{d.name}</div>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center cg-tick-pop" style={{ backgroundColor: ACCENT }}>
                        <Check size={12} color="white" />
                      </div>
                    )}
                  </button>
                );
              })}

              {/* "+ Other" tile */}
              {showCustomInput ? (
                <div
                  className="rounded-xl p-4"
                  style={{ border: `1px dashed ${ACCENT}`, backgroundColor: ACCENT_SOFT }}
                >
                  <input
                    ref={customInputRef}
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const name = customInput.trim();
                        if (!name) return;
                        const newDept = { id: `custom-${Date.now()}`, name };
                        setCustomDeptList((prev) => [...prev, newDept]);
                        setSelected((prev) => [...prev, newDept.id]);
                        setCustomInput('');
                        setShowCustomInput(false);
                      } else if (e.key === 'Escape') {
                        setCustomInput('');
                        setShowCustomInput(false);
                      }
                    }}
                    placeholder="Department name"
                    autoFocus
                    className="w-full text-sm outline-none bg-transparent"
                    style={{ fontFamily: BODY_FONT, color: CHARCOAL }}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        const name = customInput.trim();
                        if (!name) return;
                        const newDept = { id: `custom-${Date.now()}`, name };
                        setCustomDeptList((prev) => [...prev, newDept]);
                        setSelected((prev) => [...prev, newDept.id]);
                        setCustomInput('');
                        setShowCustomInput(false);
                      }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ backgroundColor: ACCENT, color: 'white', fontFamily: PILL_FONT, fontWeight: 700 }}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomInput(''); setShowCustomInput(false); }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ backgroundColor: '#F0F1F5', color: CHARCOAL, fontFamily: PILL_FONT, fontWeight: 700 }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomInput(true);
                    setTimeout(() => customInputRef.current?.focus(), 0);
                  }}
                  className="rounded-xl p-4 text-left cg-hover-lift"
                  style={{ border: `1px dashed ${BORDER}`, backgroundColor: 'white', color: MUTED_SOFT }}
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: '#F6F5F2', color: '#AEB4C2' }}>
                    <Plus size={18} />
                  </div>
                  <div className="text-sm" style={{ fontFamily: BODY_FONT, fontWeight: 600 }}>+ Other</div>
                </button>
              )}
            </div>

            <p className="text-xs mt-4" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
              {selected.length} department{selected.length !== 1 ? 's' : ''} selected. Add or remove departments later in Role Management.
            </p>

            {saveError && (
              <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FCEBEB', color: '#A32D2D' }}>
                {saveError}
              </div>
            )}
          </>
        )}
      </Card>

      <div className="flex items-center justify-between mt-8">
        <LinkButton onClick={onBack}><ChevronLeft size={14} /> Back</LinkButton>
        <PillPrimary onClick={handleContinue} disabled={saving || loading || !!loadError || selected.length === 0}>
          {saving ? 'Saving…' : 'Continue'}
        </PillPrimary>
      </div>
    </div>
  );
};

// ─── Step 4: Invite crew ───────────────────────────────────────────

const InviteCrewStep = ({ tenant, departments, customDepts, deptObjs, onBack, onFinish }) => {
  const { user } = useAuth();

  // Fetch departments from DB to get real UUID IDs — mirrors InviteCrewModal.
  // allDepts is derived from DB objects so dropdown option values and the
  // crew_invites department_id column always receive valid UUIDs, never the
  // BASE_DEPARTMENTS string keys ('BRIDGE', 'GALLEY', …).
  // deptObjs prop is used as an instant initial value so the UI renders
  // immediately while the fetch is in flight.
  const [dbDepts, setDbDepts] = useState(() =>
    (deptObjs || []).filter((d) => !String(d.id).startsWith('custom-'))
  );
  useEffect(() => {
    const dbIds = departments.filter((id) => !String(id).startsWith('custom-'));
    if (!dbIds.length) return;
    supabase
      .from('departments')
      .select('id, name')
      .in('id', dbIds)
      .order('name', { ascending: true })
      .then(({ data }) => { if (data) setDbDepts(data); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allDepts = useMemo(
    () => [
      ...dbDepts.filter((d) => departments.includes(d.id)),
      ...customDepts.filter((d) => departments.includes(d.id)),
    ],
    [dbDepts, departments, customDepts]
  );

  // Map of deptId (UUID) → [{id, name, department_id, default_permission_tier, source}]
  // Merges the global roles catalog with this tenant's custom roles so "Other"-
  // created roles from prior sessions show up alongside the seeded ones.
  const [deptRoles, setDeptRoles] = useState({});

  useEffect(() => {
    const dbDeptIds = allDepts.map((d) => d.id).filter((id) => !String(id).startsWith('custom-'));
    if (!dbDeptIds.length) return;
    (async () => {
      const [{ data: globalData }, { data: customData }] = await Promise.all([
        supabase
          .from('roles')
          .select('id, name, department_id, default_permission_tier')
          .in('department_id', dbDeptIds)
          .order('name', { ascending: true }),
        tenant?.id
          ? supabase
              .from('tenant_custom_roles')
              .select('id, name, department_id, default_permission_tier')
              .eq('tenant_id', tenant.id)
              .in('department_id', dbDeptIds)
              .order('name', { ascending: true })
          : Promise.resolve({ data: [] }),
      ]);
      const map = {};
      for (const role of (globalData || [])) {
        if (!map[role.department_id]) map[role.department_id] = [];
        map[role.department_id].push({ ...role, source: 'global' });
      }
      for (const role of (customData || [])) {
        if (!map[role.department_id]) map[role.department_id] = [];
        map[role.department_id].push({ ...role, source: 'custom' });
      }
      setDeptRoles(map);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDepts.length, tenant?.id]);

  const [rows, setRows] = useState([{ name: '', email: '', department_id: '', role: '', roleIsOther: false }]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateRow = (i, key, val) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const addRow = () =>
    setRows((prev) => [...prev, { name: '', email: '', department_id: '', role: '', roleIsOther: false }]);
  const removeRow = (i) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const parsePaste = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const lookup = (raw) => {
      if (!raw) return '';
      const n = norm(raw);
      const match = allDepts.find((d) => norm(d.name) === n || norm(d.id) === n);
      return match ? match.id : '';
    };
    const parsed = lines
      .map((line) => {
        const parts = line.split(/[,\t]/).map((p) => p.trim());
        const [email = '', deptRaw = '', role = ''] = parts;
        return { email, department_id: lookup(deptRaw), role };
      })
      .filter((r) => r.email);
    if (parsed.length === 0) {
      setPasteResult('No valid rows found.');
      return;
    }
    setRows((prev) => {
      const emptyFirst = prev.length === 1 && !prev[0].email && !prev[0].role;
      return emptyFirst ? parsed : [...prev, ...parsed];
    });
    setPasteResult(`Added ${parsed.length} invite${parsed.length === 1 ? '' : 's'}.`);
    setPasteText('');
  };

  const finishAndGo = async (sendInvites) => {
    setSaving(true);
    setError('');
    try {
      if (sendInvites) {
        const toInvite = rows.filter((r) => r.email && r.department_id && r.role);
        if (toInvite.length > 0) {
          const deptLookup = Object.fromEntries(allDepts.map((d) => [d.id, d.name]));

          const results = await Promise.allSettled(
            toInvite.map(async (r) => {
              const deptLabel = deptLookup[r.department_id] || '';
              // Custom "Other" departments use a 'custom-*' pseudo-ID, not a
              // real DB UUID.  Pass null for department_id so the UUID FK column
              // in crew_invites stays clean; keep the label for display.
              const isCustomDept = String(r.department_id).startsWith('custom-');
              const departmentId = isCustomDept ? null : r.department_id;

              // Resolve role to either a global roles.id, a tenant_custom_roles.id,
              // or (for a free-text "Other" role on a real department) upsert a new
              // tenant_custom_roles row and use its id. Free-text roles on custom
              // departments can't have a UUID, so both ids stay null.
              const deptRoleList = isCustomDept ? [] : (deptRoles[r.department_id] || []);
              const matchedRole = deptRoleList.find((ro) => ro.name === r.role);

              let roleId = null;
              let customRoleId = null;
              let permissionTier = 'CREW';

              if (matchedRole) {
                permissionTier = matchedRole.default_permission_tier || 'CREW';
                if (matchedRole.source === 'custom') {
                  customRoleId = matchedRole.id;
                } else {
                  roleId = matchedRole.id;
                }
              } else if (!isCustomDept && r.roleIsOther && r.role?.trim()) {
                // Free-text role on a real department — upsert into tenant_custom_roles
                const { data: upserted, error: upsertErr } = await supabase
                  .from('tenant_custom_roles')
                  .upsert(
                    {
                      tenant_id: tenant.id,
                      department_id: r.department_id,
                      name: r.role.trim(),
                      default_permission_tier: 'CREW',
                      created_by: user?.id,
                    },
                    { onConflict: 'tenant_id,department_id,name' }
                  )
                  .select('id, default_permission_tier')
                  .single();
                if (upsertErr) throw upsertErr;
                customRoleId = upserted?.id;
                permissionTier = upserted?.default_permission_tier || 'CREW';
              }

              return createCrewInvite({
                email: r.email,
                tenantId: tenant.id,
                invitedBy: user?.id,
                departmentId,
                departmentLabel: deptLabel,
                roleId,
                customRoleId,
                roleLabel: r.role,
                permissionTier,
                firstName: r.name?.trim() || null,
              });
            })
          );

          // allSettled never throws — inspect each result explicitly.
          // Supabase JS v2 returns { data, error } (never throws), so a failed
          // insert comes back as status='fulfilled' with value.error set.
          const succeeded = results.filter(
            (r) => r.status === 'fulfilled' && !r.value?.error
          );
          const failed = results.filter(
            (r) => r.status === 'rejected' || r.value?.error
          );

          if (succeeded.length === 0 && failed.length > 0) {
            // Every insert failed — surface the first error and stay on the form.
            const firstErr =
              failed[0].status === 'rejected' ? failed[0].reason : failed[0].value?.error;
            console.error('[onboarding] crew_invites insert failed', firstErr);
            const msg = firstErr?.message || 'Could not send invites. Check your permissions and try again.';
            showToast(msg, 'error');
            setError(msg);
            return; // do NOT navigate
          }

          if (failed.length > 0) {
            // Partial failure — some rows went through, report the ones that didn't.
            const firstErr =
              failed[0].status === 'rejected' ? failed[0].reason : failed[0].value?.error;
            console.error('[onboarding] some crew_invites inserts failed', firstErr, { failed: failed.length, succeeded: succeeded.length });
          }

          // Send invitation emails for all successfully inserted rows.
          const insertedIds = succeeded.map((r) => r.value?.data?.id).filter(Boolean);
          let emailFailCount = 0;
          if (insertedIds.length > 0) {
            const emailResults = await Promise.allSettled(
              insertedIds.map((id) => sendCrewInvite(id))
            );
            emailFailCount = emailResults.filter(
              (r) => r.status === 'rejected' || r.value?.error
            ).length;
            if (emailFailCount > 0) {
              console.warn('[onboarding] some invite emails failed to send', { emailFailCount });
            }
          }

          // Build toast — always mention how many invites were created.
          const insertNote = failed.length > 0
            ? `${succeeded.length} invite${succeeded.length === 1 ? '' : 's'} sent (${failed.length} row${failed.length === 1 ? '' : 's'} failed — check the console).`
            : `Invited ${succeeded.length} crew member${succeeded.length === 1 ? '' : 's'}.`;
          const emailNote = emailFailCount > 0
            ? ` (${emailFailCount} email${emailFailCount === 1 ? '' : 's'} failed — you can resend from the crew page)`
            : '';
          showToast(insertNote + emailNote, emailFailCount > 0 || failed.length > 0 ? 'warning' : 'success');
        }
      }

      // Mark onboarding complete. This is non-blocking for navigation — even if it
      // fails the user should proceed to the dashboard (they can re-run onboarding
      // via admin settings if needed).
      const { error: completeErr } = await supabase
        .from('tenants')
        .update({
          onboarding_completed_at: new Date().toISOString(),
          skipped_invite_crew: !sendInvites,
        })
        .eq('id', tenant.id);
      if (completeErr) {
        console.error('[onboarding] tenants update failed', completeErr);
        // Non-fatal — show a warning but still navigate.
        showToast('Onboarding marked complete locally — could not save to server. Contact support if this persists.', 'warning');
      }

      onFinish();
    } catch (err) {
      console.error('[onboarding] finish failed', err);
      const msg = err?.message || 'Could not finish onboarding. Try again.';
      showToast(msg, 'error');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cg-step-enter">
      {/* Hero */}
      <div className="mb-6">
        <h2
          style={{
            fontFamily: HEADING_FONT,
            fontSize: 24,
            fontWeight: 500,
            color: CHARCOAL,
            letterSpacing: '-0.01em',
          }}
        >
          {tenant?.name ? `Bring your crew aboard ${tenant.name}` : 'Invite your crew'}
        </h2>
        <p className="text-sm mt-1" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
          Add teammates by email — assign a department and role. Most captains do this after exploring the dashboard.
        </p>
      </div>

      {/* Paste-from-spreadsheet block — above the rows */}
      <div className="mb-5">
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="inline-flex items-center gap-2 text-xs uppercase"
          style={{ color: ACCENT, fontFamily: PILL_FONT, fontWeight: 700, letterSpacing: '0.08em' }}
        >
          <ClipboardList size={14} />
          {showPaste ? '− Hide paste from spreadsheet' : '+ Paste from spreadsheet'}
        </button>
        {showPaste && (
          <Card className="mt-3">
            <p className="text-xs mb-2" style={{ color: MUTED_SOFT, fontFamily: BODY_FONT }}>
              One row per line — <span style={{ fontFamily: 'monospace' }}>email, department, role</span>
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="janet@vessel.com, Bridge, First Officer"
              rows={4}
              className="ob-field w-full px-3 py-2 text-sm resize-none"
              style={{
                borderRadius: 8,
                color: CHARCOAL,
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            />
            <div className="flex items-center gap-3 mt-3">
              <PillSecondary onClick={parsePaste} disabled={!pasteText.trim()}>
                Add rows
              </PillSecondary>
              {pasteResult && (
                <span className="text-xs" style={{ color: MUTED_SOFT, fontFamily: BODY_FONT }}>{pasteResult}</span>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Invite rows — inside a raised Cargo card */}
      <Card>
        {rows.map((r, i) => {
          const dept = allDepts.find((d) => d.id === r.department_id);
          const isCustomDept = dept && String(dept.id).startsWith('custom-');
          const dbRoles = (dept && !isCustomDept) ? (deptRoles[dept.id] || []) : [];
          const showRoleText = isCustomDept || r.roleIsOther;
          return (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <div className="col-span-12 md:col-span-2">
                <TextInput
                  placeholder="Name"
                  value={r.name}
                  onChange={(e) => updateRow(i, 'name', e.target.value)}
                />
              </div>
              <div className="col-span-12 md:col-span-3">
                <TextInput
                  placeholder="email@vessel.com"
                  value={r.email}
                  onChange={(e) => updateRow(i, 'email', e.target.value)}
                />
              </div>
              <div className="col-span-6 md:col-span-3">
                <select
                  value={r.department_id}
                  onChange={(e) => {
                    setRows((prev) => prev.map((row, idx) =>
                      idx === i ? { ...row, department_id: e.target.value, role: '', roleIsOther: false } : row
                    ));
                  }}
                  className="ob-field w-full px-2 py-2 text-sm"
                  style={{ borderRadius: 6, fontFamily: BODY_FONT }}
                >
                  <option value="">Department</option>
                  {allDepts.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-5 md:col-span-3">
                {showRoleText ? (
                  <TextInput
                    placeholder="Role"
                    value={r.role}
                    onChange={(e) => updateRow(i, 'role', e.target.value)}
                  />
                ) : (
                  <select
                    value={r.role}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__other__') {
                        setRows((prev) => prev.map((row, idx) =>
                          idx === i ? { ...row, roleIsOther: true, role: '' } : row
                        ));
                      } else {
                        updateRow(i, 'role', val);
                      }
                    }}
                    className="ob-field w-full px-2 py-2 text-sm"
                    style={{ borderRadius: 6, fontFamily: BODY_FONT }}
                  >
                    <option value="">Role</option>
                    {dbRoles.map((role) => (
                      <option key={role.id} value={role.name}>{role.name}</option>
                    ))}
                    {dept && <option value="__other__">Other…</option>}
                  </select>
                )}
              </div>
              <div className="col-span-1 flex justify-end">
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)} className="p-2">
                    <Trash2 size={16} color="#AEB4C2" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add another — text link */}
        <div className="mt-2">
          <button
            type="button"
            onClick={addRow}
            className="text-sm"
            style={{ color: NAVY, fontFamily: BODY_FONT, fontWeight: 600 }}
          >
            + Add another
          </button>
        </div>

        {/* Permission helper */}
        <p className="text-xs mt-3" style={{ color: '#94A3B8', fontFamily: BODY_FONT }}>
          Permission tier auto-populates from the selected role.
        </p>
      </Card>

      {error && (
        <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FCEBEB', color: '#A32D2D' }}>
          {error}
        </div>
      )}

      {/* Footer — Back + dual CTAs */}
      <div className="flex items-center justify-between mt-8">
        <LinkButton onClick={onBack}>
          <ChevronLeft size={14} /> Back
        </LinkButton>
        <div className="flex items-center gap-3">
          <PillSecondary onClick={() => finishAndGo(true)} disabled={saving}>
            Send invites
          </PillSecondary>
          <PillPrimary onClick={() => finishAndGo(false)} disabled={saving}>
            {saving ? 'Finishing…' : (
              <span className="inline-flex items-center gap-2">Do this later <ChevronRight size={14} /></span>
            )}
          </PillPrimary>
        </div>
      </div>

      {/* Caption */}
      <p className="text-right text-xs mt-3" style={{ color: '#94A3B8', fontFamily: BODY_FONT }}>
        Most captains start solo and invite crew once they've had a look around.
      </p>
    </div>
  );
};

// ─── Step 5: Set locations ──────────────────────────────────────────
// Top-level decks only (the full Deck → Zone → Space builder lives in
// Vessel Settings > Locations for later). Reuses the same
// public.vessel_locations helpers as that page — getAllDecks/createDeck —
// so this isn't a parallel implementation of the same table.

const SUGGESTED_DECKS = ['Bridge', 'Sun Deck', 'Upper Deck', 'Main Deck', 'Lower Deck', "Crew Mess", 'Engine Room'];

const LocationsStep = ({ onBack, onFinish }) => {
  const [existingDecks, setExistingDecks] = useState([]);
  const [selected, setSelected] = useState([]);
  const [customInput, setCustomInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getAllDecks().then((decks) => {
      setExistingDecks(decks);
      setSelected(decks.map((d) => d.name));
      setLoading(false);
    });
  }, []);

  const toggle = (name) =>
    setSelected((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  const addCustom = () => {
    const name = customInput.trim();
    if (!name || selected.includes(name)) return;
    setSelected((prev) => [...prev, name]);
    setCustomInput('');
  };

  const handleContinue = async () => {
    setSaving(true);
    setError('');
    try {
      const existingNames = new Set(existingDecks.map((d) => d.name));
      const toCreate = selected.filter((name) => !existingNames.has(name));
      const results = await Promise.allSettled(toCreate.map((name) => createDeck(name)));
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) {
        console.error('[onboarding] some decks failed to save', failed.reason);
        showToast('Some locations could not be saved — you can add them later in Vessel Settings.', 'warning');
      }
      onFinish();
    } catch (err) {
      console.error('[onboarding] locations save failed', err);
      setError(err?.message || 'Could not save locations. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cg-step-enter">
      <div className="mb-6">
        <h1 style={{ fontFamily: HEADING_FONT, fontSize: 26, fontWeight: 500, color: CHARCOAL, letterSpacing: '-0.02em' }}>
          Map your vessel
        </h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
          Add the decks on board — you can break each one into zones and spaces later in Vessel Settings.
        </p>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: ACCENT }} />
          </div>
        ) : (
          <>
            <SectionHeading>Suggested decks</SectionHeading>
            <div className="flex flex-wrap gap-2 mb-5">
              {SUGGESTED_DECKS.map((name) => {
                const isSelected = selected.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggle(name)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm transition-colors"
                    style={{
                      fontFamily: BODY_FONT, fontWeight: 600,
                      backgroundColor: isSelected ? ACCENT : 'white',
                      border: `1px solid ${isSelected ? ACCENT : BORDER}`,
                      color: isSelected ? 'white' : CHARCOAL,
                    }}
                  >
                    {isSelected && <Check size={13} strokeWidth={3} />}
                    {name}
                  </button>
                );
              })}
            </div>

            <SectionHeading>Add another</SectionHeading>
            <div className="flex items-center gap-2 mb-5">
              <TextInput
                value={customInput}
                placeholder="e.g., Beach Club"
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
              />
              <PillSecondary onClick={addCustom} disabled={!customInput.trim()}>Add</PillSecondary>
            </div>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {selected.filter((name) => !SUGGESTED_DECKS.includes(name)).map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
                    style={{ backgroundColor: ACCENT_SOFT, color: ACCENT, fontFamily: BODY_FONT, fontWeight: 600 }}
                  >
                    {name}
                    <button type="button" onClick={() => toggle(name)} style={{ color: ACCENT, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs mt-3" style={{ color: '#94A3B8', fontFamily: BODY_FONT }}>
              {selected.length} deck{selected.length !== 1 ? 's' : ''} selected. Skip for now if you&rsquo;d rather set this up later.
            </p>
          </>
        )}

        {error && (
          <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FCEBEB', color: '#A32D2D' }}>
            {error}
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between mt-8">
        <LinkButton onClick={onBack}><ChevronLeft size={14} /> Back</LinkButton>
        <PillPrimary onClick={handleContinue} disabled={saving || loading}>
          {saving ? 'Saving…' : (
            <span className="inline-flex items-center gap-2">Continue <ChevronRight size={14} /></span>
          )}
        </PillPrimary>
      </div>
    </div>
  );
};

// ─── "Wrapped" tour shell ──────────────────────────────────────────
// Matches the CargoOnboarding.jsx reference design: per-screen colour
// theme, giant numeral, scrolling marquee, circular glyph, hard-shadow
// CTAs, confetti finale. The real data-collection steps above render
// unchanged inside .onb-panel (a white card) so their fields stay
// legible regardless of the step's background colour.

const SCREEN_ORDER = ['welcome', 'vessel', 'profile', 'departments', 'crew', 'locations', 'done'];
const STEP_KEYS = ['vessel', 'profile', 'departments', 'crew', 'locations'];

// Colour choreography follows the CargoOnboarding.jsx reference's rhythm
// (cream → cream → dark → peach → pale → dark → peach), but the "dark"
// screens use the real Cargo brand navy ink (#1C1B3A per CLAUDE.md) —
// the reference's #1E3A5F is the old marketing-site navy, not this one.
const THEMES = {
  welcome:     { bg: '#F7F2E9', fg: '#1C1B3A', ac: '#C65A1A' },
  vessel:      { bg: '#F4F1EC', fg: '#1C1B3A', ac: '#C65A1A' },
  profile:     { bg: '#1C1B3A', fg: '#F4F1EC', ac: '#E8915A' },
  departments: { bg: '#EFC8A6', fg: '#1C1B3A', ac: '#C65A1A' },
  crew:        { bg: '#DCE3EA', fg: '#1C1B3A', ac: '#C65A1A' },
  locations:   { bg: '#1C1B3A', fg: '#F4F1EC', ac: '#E8915A' },
  done:        { bg: '#EFC8A6', fg: '#1C1B3A', ac: '#C65A1A' },
};

// Dark (navy) step screens — these need the inverted logo (see logoSrc below).
const DARK_SCREENS = ['profile', 'locations'];

const STEP_META = {
  vessel:      { numeral: '01', label: 'Vessel',      icon: Ship },
  profile:     { numeral: '02', label: 'Profile',     icon: User },
  departments: { numeral: '03', label: 'Departments', icon: Building2 },
  crew:        { numeral: '04', label: 'Crew',         icon: Users },
  locations:   { numeral: '05', label: 'Locations',   icon: MapPin },
};

const DONE_CHIPS = [
  { icon: Users,         title: 'Crew' },
  { icon: ClipboardList, title: 'Provisioning' },
  { icon: Briefcase,     title: 'Team Jobs' },
  { icon: Anchor,        title: 'Defects' },
];

// Confetti burst — done screen only. Random spread is fine here (this
// runs client-side at render time, not inside a deterministic workflow).
const Confetti = () => {
  const bits = useRef(
    Array.from({ length: 22 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 0.45, dur: 1.5 + Math.random() * 1.1,
      rot: Math.random() * 360, color: ['var(--wac)', '#1E3A5F', '#E0823F', '#3E6491'][i % 4],
      w: 5 + Math.random() * 5, round: Math.random() > 0.5,
    }))
  ).current;
  return (
    <div className="onb-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className="bit"
          style={{
            left: b.left + '%', animationDelay: b.delay + 's', animationDuration: b.dur + 's',
            background: b.color, width: b.w, height: b.w, borderRadius: b.round ? '50%' : 2,
            transform: `rotate(${b.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
};

const OnboardingPage = () => {
  const navigate = useNavigate();
  const { user, activeTenantId, bootstrapComplete, retryBootstrap } = useAuth();

  const [tenant, setTenant] = useState(null);
  const [screen, setScreen] = useState('welcome'); // welcome | vessel | departments | crew | done
  const [deptChoice, setDeptChoice] = useState({ baseSelected: [], customDepts: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [membershipRetries, setMembershipRetries] = useState(0);
  const retriedRef = useRef(false); // guard: only call retryBootstrap once
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  const handleRecovery = async () => {
    setRecovering(true);
    setRecoveryError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setRecoveryError('No active session — please refresh the page and try again.');
        return;
      }
      const res = await fetch('/.netlify/functions/recover-membership', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (!res.ok) {
        setRecoveryError(json?.error || 'Recovery failed. Please contact support.');
        return;
      }
      // Row created — re-run bootstrap so activeTenantId gets set.
      // Set loading=true first so VesselSettingsStep doesn't mount with null
      // tenant; the tenant loading effect will set it false once data arrives.
      retriedRef.current = false;
      setMembershipRetries(0);
      setLoading(true);
      setLoadError('');
      retryBootstrap?.();
    } catch (err) {
      setRecoveryError(err?.message || 'Unexpected error. Please contact support.');
    } finally {
      setRecovering(false);
    }
  };

  // Inject Cargo animation keyframes once per page load
  useEffect(() => {
    const styleId = 'cargo-onboarding-anim';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes cgFadeSlideUp { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgTickPop { 0% { transform: scale(0); opacity: 0; } 55% { transform: scale(1.35); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes cgStepIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgBreath { 0%,100% { box-shadow: 0 0 0 0 rgba(198,90,26,0.35); } 50% { box-shadow: 0 0 0 10px rgba(198,90,26,0); } }
        .cg-anim-enter { animation: cgFadeSlideUp 520ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-step-enter { animation: cgStepIn 420ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-tick-pop   { animation: cgTickPop 420ms cubic-bezier(.34,1.56,.64,1) both; }
        .cg-breath     { animation: cgBreath 2400ms ease-in-out infinite; }
        .cg-hover-lift { transition: transform 200ms ease, box-shadow 200ms ease; }
        .cg-hover-lift:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(28,27,58,0.12); }
        .cg-stagger > * { animation-delay: calc(var(--i, 0) * 40ms); }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Race-condition fix: if bootstrap completed BEFORE the Stripe webhook
  // finished inserting the tenant_members row, activeTenantId will be
  // null even though the DB now has the membership. Poll tenant_members
  // directly up to 5x (every 1.5s) and re-bootstrap ONCE when we find it.
  // Without the one-shot guard, every bootstrap completion re-runs this
  // effect → polls again → calls retryBootstrap again → AuthContext
  // loading flips back on → ProtectedRoute shows "Loading your vessel
  // access…" forever.
  //
  // Note: we use activeTenantId (not currentTenantId) because bootstrap
  // writes to activeTenantId; currentTenantId is a separate legacy field
  // that is only updated by setCurrentTenant() explicit calls.
  useEffect(() => {
    if (!bootstrapComplete) return;
    if (activeTenantId) return;
    if (!user?.id) return;
    if (retriedRef.current) return;
    if (membershipRetries >= 5) return;

    const t = setTimeout(async () => {
      console.log('[onboarding] tenantId null after bootstrap, polling tenant_members', { attempt: membershipRetries + 1 });
      const { data, error } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1);
      if (!error && data && data.length > 0 && !retriedRef.current) {
        console.log('[onboarding] found membership, retrying bootstrap ONCE', data[0].tenant_id);
        retriedRef.current = true;
        retryBootstrap?.();
      } else {
        setMembershipRetries((n) => n + 1);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [bootstrapComplete, activeTenantId, user?.id, membershipRetries, retryBootstrap]);

  // Load the tenant row for pre-fill
  useEffect(() => {
    if (!bootstrapComplete) return;
    if (!activeTenantId) {
      // Still give the membership-poll effect a chance before surfacing
      // the webhook-failure error.
      if (membershipRetries < 5) return;
      setLoadError(
        'We could not find your vessel membership. This usually means the signup webhook did not complete. ' +
        'Please contact support or try again in a few minutes — your account is safe.'
      );
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', activeTenantId)
        .single();
      if (error) {
        console.error('[onboarding] failed to load tenant', error);
        setLoadError('Could not load your vessel. Please refresh.');
        setLoading(false);
        return;
      }
      if (data?.onboarding_completed_at) {
        // Already done — bounce.
        navigate('/dashboard', { replace: true });
        return;
      }
      setTenant(data);
      setLoading(false);
    })();
  }, [bootstrapComplete, activeTenantId, navigate, membershipRetries]);

  const logoSrc = '/assets/images/cargo_merged_originalmark_syne800_true.png';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAFAF8' }}>
        <div className="text-center">
          <Anchor size={36} color={ACCENT} className="mx-auto mb-3" />
          <p className="text-sm" style={{ color: MUTED_SOFT, fontFamily: BODY_FONT }}>Loading your vessel…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    const isMembershipError = loadError.includes('vessel membership');
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAFAF8' }}>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: '0 24px' }}>
          <p className="text-sm" style={{ color: '#A32D2D', marginBottom: 16, fontFamily: BODY_FONT }}>{loadError}</p>
          {isMembershipError && (
            <>
              <button
                onClick={handleRecovery}
                disabled={recovering}
                style={{
                  padding: '8px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: recovering ? 'not-allowed' : 'pointer',
                  fontFamily: BODY_FONT,
                  background: recovering ? '#AEB4C2' : ACCENT, color: '#fff', border: 'none',
                }}
              >
                {recovering ? 'Fixing your account…' : 'Retry Setup'}
              </button>
              {recoveryError && (
                <p style={{ color: '#A32D2D', fontSize: 13, marginTop: 10, fontFamily: BODY_FONT }}>{recoveryError}</p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const theme = THEMES[screen] || THEMES.welcome;
  const isStepScreen = STEP_KEYS.includes(screen);
  const meta = STEP_META[screen];

  const goBack = () => {
    const i = STEP_KEYS.indexOf(screen);
    if (i > 0) setScreen(STEP_KEYS[i - 1]);
    else if (i === 0) setScreen('welcome');
  };

  const marqueeText = (
    screen === 'welcome' ? 'Welcome aboard'
    : screen === 'done'  ? 'Bon voyage'
    : meta?.label || ''
  ).toUpperCase();

  return (
    <div className="onb-shell" style={{ '--wbg': theme.bg, '--wfg': theme.fg, '--wac': theme.ac }}>
      {screen === 'welcome' && (
        <>
          <span className="onb-blob one" />
          <span className="onb-blob two" />
          <span className="onb-blob three" />
        </>
      )}
      {screen === 'done' && <Confetti />}

      <header className="onb-bar">
        <div className="onb-bar-left">
          {isStepScreen && (
            <button className="onb-back" onClick={goBack} aria-label="Back">
              <ChevronLeft size={18} />
            </button>
          )}
          <img
            className={`onb-logo${DARK_SCREENS.includes(screen) ? ' invert' : ''}`}
            src={logoSrc}
            alt="Cargo"
          />
        </div>
        {isStepScreen && (
          <div className="onb-bar-right">
            <span className="onb-ticks">
              {STEP_KEYS.map((k) => (
                <i
                  key={k}
                  className={
                    SCREEN_ORDER.indexOf(k) < SCREEN_ORDER.indexOf(screen) ? 'on'
                    : k === screen ? 'cur' : ''
                  }
                />
              ))}
            </span>
            <span className="onb-count">{meta.numeral} <em>/ 0{STEP_KEYS.length}</em></span>
          </div>
        )}
      </header>

      {/* No remount key here — remounting on every step change restarted the
          scroll from 0 each time, reading as a stutter/stop at each
          transition. The repeat count is high (not just enough to fill one
          screen) so short words like "CREW" still tile to at least 2x any
          realistic viewport width — anything less leaves a blank gap
          halfway through the loop, which is what a "stop" actually was. */}
      <div className="onb-marquee">
        <span>{(marqueeText + ' · ').repeat(60)}</span>
      </div>

      <main className="onb-main" key={screen}>
        {screen === 'welcome' && (
          <div className="onb-welcome">
            <h1 className="onb-head-serif">WELCOME ABOARD, <em className="onb-bel">{tenant?.name || 'Captain'}</em></h1>
            <p className="onb-sub center">Let&rsquo;s get your vessel ready to sail. Five quick steps to set the course.</p>
            <div className="onb-ctarow center">
              <button className="onb-cta welcome" onClick={() => setScreen('vessel')}>Get started</button>
            </div>
            <span className="onb-foot">Takes about 3 minutes</span>
          </div>
        )}

        {isStepScreen && (
          <div className="onb-split">
            <div className="onb-left">
              <div className="onb-giant">{meta.numeral}</div>
            </div>
            <div className="onb-right">
              <span className="onb-glyph">
                <meta.icon size={36} color="var(--wac)" strokeWidth={1.6} />
              </span>
              <div className={`onb-panel${screen === 'profile' ? ' onb-panel--narrow' : ''}`}>
                {screen === 'vessel' && (
                  <VesselSettingsStep
                    tenant={tenant}
                    onSaved={(updated) => {
                      setTenant((t) => ({ ...t, ...updated }));
                      setScreen('profile');
                    }}
                  />
                )}
                {screen === 'profile' && (
                  <PersonalProfileStep
                    userId={user?.id}
                    onSaved={() => setScreen('departments')}
                  />
                )}
                {screen === 'departments' && (
                  <DepartmentsStep
                    tenant={tenant}
                    userId={user?.id}
                    onBack={goBack}
                    onComplete={(choice) => {
                      setDeptChoice(choice);
                      setScreen('crew');
                    }}
                  />
                )}
                {screen === 'crew' && (
                  <InviteCrewStep
                    tenant={tenant}
                    departments={deptChoice.baseSelected}
                    customDepts={deptChoice.customDepts}
                    deptObjs={deptChoice.departments}
                    onBack={goBack}
                    onFinish={() => setScreen('locations')}
                  />
                )}
                {screen === 'locations' && (
                  <LocationsStep
                    onBack={goBack}
                    onFinish={() => setScreen('done')}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {screen === 'done' && (
          <div className="onb-split">
            <div className="onb-left">
              <div className="onb-giant word">BRAVO</div>
            </div>
            <div className="onb-right">
              <span className="onb-glyph done">
                <Check size={36} color="var(--wfg)" strokeWidth={2.2} />
              </span>
              <h1 className="onb-head">Congrats, you&rsquo;re all set</h1>
              <p className="onb-sub">Your vessel is configured and ready for the crew.</p>
              <div className="onb-chips">
                {DONE_CHIPS.map(({ icon: ChipIcon, title }) => (
                  <span className="onb-chip" key={title}>
                    <ChipIcon size={15} color="var(--wac)" strokeWidth={1.9} /> {title}
                  </span>
                ))}
              </div>
              <div className="onb-ctarow">
                <button className="onb-cta" onClick={() => navigate('/dashboard', { replace: true })}>
                  Enter Cargo
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default OnboardingPage;
