import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Check, Trash2, Plus, ChevronRight, ChevronLeft, Ship, Users, Building2, Utensils, Briefcase, ClipboardList } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import Image from '../../components/AppImage';
import { useTheme } from '../../contexts/ThemeContext';
import { showToast } from '../../utils/toast';

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

// ── Brand tokens ─────────────────────────────────────────────────
const NAVY      = '#1E3A5F';
const NAVY_DARK = '#141D2E';
const ACCENT    = '#00A8CC';
const CHARCOAL  = '#1A202C';
const CARD      = '#FFFFFF';

const HEADING_FONT = "'Outfit', system-ui, sans-serif";
const BODY_FONT    = "'Plus Jakarta Sans', system-ui, sans-serif";
const PILL_FONT    = "'Archivo', system-ui, sans-serif";

// Legacy card style — used by DepartmentsStep + InviteCrewStep (do not remove)
const CARD_STYLE = {
  backgroundColor: CARD,
  borderTop: `1px solid ${NAVY}`,
  borderLeft: `1px solid ${NAVY}`,
  borderRight: `1px solid ${NAVY}`,
  borderBottom: `3px solid ${NAVY}`,
  borderRadius: 14,
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

// Raised "Cargo border" card (1px navy sides, 3px navy bottom)
const Card = ({ children, className = '' }) => (
  <div
    className={`rounded-2xl p-6 ${className}`}
    style={{
      backgroundColor: CARD,
      borderTop: `1px solid ${NAVY}`,
      borderLeft: `1px solid ${NAVY}`,
      borderRight: `1px solid ${NAVY}`,
      borderBottom: `3px solid ${NAVY}`,
    }}
  >
    {children}
  </div>
);

// Uppercase Archivo section label
const SectionHeading = ({ children }) => (
  <h2
    className="mb-4"
    style={{
      fontFamily: PILL_FONT,
      fontSize: 11,
      fontWeight: 900,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: NAVY,
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

const inputStyle = {
  fontFamily: BODY_FONT,
  color: CHARCOAL,
  backgroundColor: 'white',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '9px 12px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
};

const TextInput = (props) => (
  <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />
);

const SelectInput = ({ options, ...props }) => (
  <select {...props} style={{ ...inputStyle, appearance: 'auto', ...(props.style || {}) }}>
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
      style={{ accentColor: NAVY }}
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
      backgroundColor: NAVY,
      color: 'white',
      borderRadius: 50,
      fontFamily: PILL_FONT,
      fontWeight: 900,
      fontSize: 11,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '12px 26px',
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = NAVY_DARK; }}
    onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = NAVY; }}
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
      backgroundColor: 'transparent',
      color: NAVY,
      border: `2px solid ${NAVY}`,
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
    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.backgroundColor = NAVY; e.currentTarget.style.color = 'white'; } }}
    onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = NAVY; } }}
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
// Raised Cargo border + animated ACCENT tick + EDIT affordance.
const CollapsedSection = ({ title, summary, onEdit }) => (
  <div className="mt-6 cg-anim-enter">
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center justify-between rounded-xl px-5 py-4 text-left cg-hover-lift"
      style={{
        backgroundColor: CARD,
        borderTop: `1px solid ${NAVY}`,
        borderLeft: `1px solid ${NAVY}`,
        borderRight: `1px solid ${NAVY}`,
        borderBottom: `3px solid ${NAVY}`,
        fontFamily: BODY_FONT,
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center cg-tick-pop"
          style={{ backgroundColor: ACCENT }}
        >
          <Check size={15} color="white" strokeWidth={3} />
        </div>
        <div>
          <div style={{ fontFamily: HEADING_FONT, fontWeight: 700, fontSize: 15, color: CHARCOAL }}>{title}</div>
          <div className="text-xs" style={{ color: '#64748B' }}>{summary}</div>
        </div>
      </div>
      <span
        className="text-xs uppercase"
        style={{ fontFamily: PILL_FONT, color: NAVY, letterSpacing: '0.08em', fontWeight: 900 }}
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
  const containerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
        style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ color: value.length ? CHARCOAL : '#94A3B8' }}>
          {value.length ? `${value.length} region${value.length !== 1 ? 's' : ''} selected` : 'Select regions…'}
        </span>
        <ChevronRight size={14} color="#94A3B8" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease', flexShrink: 0 }} />
      </button>

      {open && (
        <div
          className="absolute z-30 w-full mt-1 rounded-xl"
          style={{ backgroundColor: CARD, border: '1px solid #CBD5E1', boxShadow: '0 10px 30px rgba(30,58,95,0.15)', maxHeight: 300, overflowY: 'auto' }}
        >
          <div className="sticky top-0 p-2" style={{ backgroundColor: CARD, borderBottom: '1px solid #E2E8F0' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search regions or countries…"
              autoFocus
              style={{ ...inputStyle, padding: '6px 10px', fontSize: 13 }}
            />
          </div>
          {filteredGroups.length > 0 && (
            <div className="p-2" style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div className="px-2 pb-1 text-[10px] uppercase" style={{ fontFamily: PILL_FONT, fontWeight: 900, letterSpacing: '0.10em', color: '#94A3B8' }}>Regions</div>
              {filteredGroups.map((group) => {
                const allIn = group.codes.every((c) => value.includes(c));
                const someIn = !allIn && group.codes.some((c) => value.includes(c));
                return (
                  <button key={group.id} type="button" onClick={() => toggleGroup(group)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between"
                    style={{ fontFamily: BODY_FONT, backgroundColor: allIn ? '#EFF6FF' : 'transparent', color: CHARCOAL }}
                  >
                    <span>{group.label}</span>
                    {allIn && <Check size={13} color={NAVY} />}
                    {someIn && <span className="text-xs" style={{ color: '#94A3B8' }}>{group.codes.filter((c) => value.includes(c)).length}/{group.codes.length}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <div className="p-2">
            <div className="px-2 pb-1 text-[10px] uppercase" style={{ fontFamily: PILL_FONT, fontWeight: 900, letterSpacing: '0.10em', color: '#94A3B8' }}>Countries</div>
            {filteredCountries.map((country) => (
              <button key={country.code} type="button" onClick={() => toggle(country.code)}
                className="w-full text-left px-2 py-1 rounded-lg text-sm flex items-center justify-between"
                style={{ fontFamily: BODY_FONT, backgroundColor: value.includes(country.code) ? '#EFF6FF' : 'transparent', color: CHARCOAL }}
              >
                <span>{country.name}</span>
                {value.includes(country.code) && <Check size={12} color={NAVY} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedCountries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedCountries.slice(0, 5).map((c) => (
            <span key={c.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{ backgroundColor: '#E0F2FE', color: NAVY, fontFamily: BODY_FONT, fontWeight: 600 }}
            >
              {c.name}
              <button type="button" onClick={() => toggle(c.code)} style={{ color: NAVY, lineHeight: 1, marginLeft: 2 }}>×</button>
            </span>
          ))}
          {selectedCountries.length > 5 && (
            <span className="text-xs" style={{ color: '#64748B', fontFamily: BODY_FONT, alignSelf: 'center' }}>
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
  const [section, setSection] = useState('identity'); // 'identity' | 'specs' | 'profile'
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
    commercial_status:    tenant?.commercial_status    || '',
    certified_commercial: tenant?.certified_commercial ?? false,
    area_of_operation:    tenant?.area_of_operation    || '',
    operating_regions:    Array.isArray(tenant?.operating_regions) ? tenant.operating_regions : [],
    typical_guest_count:  tenant?.typical_guest_count  ?? '',
    typical_crew_count:   tenant?.typical_crew_count   ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set   = (k, v) => setData((prev) => ({ ...prev, [k]: v }));
  const field = (k)    => (e)  => set(k, e.target.value);

  const identityDone = section !== 'identity';
  const specsDone    = section === 'profile';
  const heroTitle    = data.vessel_name ? `Welcome aboard ${data.vessel_name}` : 'Welcome aboard';

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
      <div className="flex items-start gap-4 mb-2">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: NAVY }}
        >
          <Ship size={20} color="white" />
        </div>
        <div>
          <h1 style={{ fontFamily: HEADING_FONT, fontSize: 28, fontWeight: 700, color: CHARCOAL, letterSpacing: '-0.02em' }}>
            {heroTitle}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
            Three quick sections. Everything here is editable later in Vessel Settings.
          </p>
        </div>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Commercial Status + Certified Commercial stacked in one column */}
                <div>
                  <Field label="Commercial Status" tooltip="How the vessel is operated — affects which compliance workflows are active.">
                    <select
                      value={data.commercial_status}
                      onChange={(e) => set('commercial_status', e.target.value)}
                      style={{ ...inputStyle, appearance: 'auto' }}
                    >
                      <option value="">Select…</option>
                      <option value="Private">Private</option>
                      <option value="Charter">Charter</option>
                      <option value="Dual-use">Dual-use</option>
                    </select>
                  </Field>
                  <div className="mt-3">
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

                <Field label="Area of Operation" tooltip="Coastal / Near Coastal / Unlimited — matches what's on your Safe Manning document.">
                  <SelectInput value={data.area_of_operation} onChange={(e) => set('area_of_operation', e.target.value)} options={AREAS_OF_OPERATION} />
                </Field>

                <div className="md:col-span-2">
                  <Field label="Operating Regions" tooltip="Select countries or use regional shortcuts. Stored as ISO-3166-1 alpha-2 codes.">
                    <RegionsCombobox
                      value={data.operating_regions}
                      onChange={(codes) => set('operating_regions', codes)}
                    />
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
              <p className="text-xs mt-4" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
                Compliance fields (ISM, ISPS, MLC) and vessel hero image can be filled in later from Vessel Settings.
              </p>
              {error && (
                <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                  {error}
                </div>
              )}
              <div className="flex items-center justify-between mt-6">
                <LinkButton onClick={() => setSection('specs')}>
                  <ChevronLeft size={14} /> Back
                </LinkButton>
                <PillPrimary onClick={handleSave} disabled={saving || !profileValid}>
                  {saving ? 'Saving…' : 'Continue'}
                </PillPrimary>
              </div>
            </Card>
          </div>
        );
      })()}
    </div>
  );
};

// ─── Step 2: Departments ───────────────────────────────────────────

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
      <div className="flex items-start gap-4 mb-2">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: NAVY }}>
          <Building2 size={20} color="white" />
        </div>
        <div>
          <h1 style={{ fontFamily: HEADING_FONT, fontSize: 28, fontWeight: 700, color: CHARCOAL, letterSpacing: '-0.02em' }}>
            {tenant?.name ? `Which departments run on ${tenant.name}?` : 'Which departments are onboard?'}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
            Pick the ones your vessel runs — Cargo tailors visibility and boards to match.
          </p>
        </div>
      </div>

      <Card className="mt-8">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: NAVY }} />
          </div>
        ) : loadError ? (
          <div className="text-center py-6">
            <p className="text-sm px-3 py-2 rounded mb-4" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
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
                    style={{ '--i': i, backgroundColor: isSelected ? NAVY : 'white', border: `1px solid ${isSelected ? NAVY : '#E2E8F0'}`, color: isSelected ? 'white' : CHARCOAL }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                      style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.12)' : '#F1F5F9', color: isSelected ? 'white' : NAVY }}
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
                    style={{ backgroundColor: isSelected ? NAVY : 'white', border: `1px dashed ${isSelected ? NAVY : '#94A3B8'}`, color: isSelected ? 'white' : CHARCOAL }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                      style={{ backgroundColor: isSelected ? 'rgba(255,255,255,0.12)' : '#F1F5F9', color: isSelected ? 'white' : NAVY }}
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
                  style={{ border: `1px dashed ${ACCENT}`, backgroundColor: '#F0FBFF' }}
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
                      style={{ backgroundColor: NAVY, color: 'white', fontFamily: PILL_FONT, fontWeight: 700 }}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomInput(''); setShowCustomInput(false); }}
                      className="text-xs px-2 py-1 rounded"
                      style={{ backgroundColor: '#E2E8F0', color: CHARCOAL, fontFamily: PILL_FONT, fontWeight: 700 }}
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
                  style={{ border: `1px dashed #CBD5E1`, backgroundColor: 'white', color: '#64748B' }}
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: '#F1F5F9', color: '#94A3B8' }}>
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
              <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
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

// ─── Step 3: Invite crew ───────────────────────────────────────────

const generateToken = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

const InviteCrewStep = ({ tenant, departments, customDepts, deptObjs, onBack, onFinish }) => {
  const { user } = useAuth();

  const allDepts = useMemo(
    () => deptObjs
      ? deptObjs.filter((d) => departments.includes(d.id))
      : [...BASE_DEPARTMENTS.filter((d) => departments.includes(d.id)), ...customDepts],
    [departments, customDepts, deptObjs]
  );

  // Map of deptId → [{id, name, default_permission_tier}] loaded from roles table
  const [deptRoles, setDeptRoles] = useState({});

  useEffect(() => {
    const dbDeptIds = allDepts.map((d) => d.id).filter((id) => !String(id).startsWith('custom-'));
    if (!dbDeptIds.length) return;
    supabase
      .from('roles')
      .select('id, name, department_id, default_permission_tier')
      .in('department_id', dbDeptIds)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        for (const role of data) {
          if (!map[role.department_id]) map[role.department_id] = [];
          map[role.department_id].push(role);
        }
        setDeptRoles(map);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDepts.length]);

  const [rows, setRows] = useState([{ email: '', department_id: '', role: '', roleIsOther: false }]);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateRow = (i, key, val) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const addRow = () =>
    setRows((prev) => [...prev, { email: '', department_id: '', role: '', roleIsOther: false }]);
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
            toInvite.map((r) => {
              const deptLabel = deptLookup[r.department_id] || '';
              return supabase.from('crew_invites').insert({
                email: r.email.toLowerCase().trim(),
                tenant_id: tenant.id,
                department_id: r.department_id,
                role_id: null,
                department_label: deptLabel,
                role_label: r.role,
                permission_tier: 'CREW',
                status: 'PENDING',
                invited_role: r.role,
                token: generateToken(),
                invited_by: user?.id,
                expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
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
            showToast(`${succeeded.length} invite${succeeded.length === 1 ? '' : 's'} sent; ${failed.length} failed — check the console for details.`, 'warning');
          } else {
            // All succeeded.
            showToast(`Invited ${succeeded.length} crew member${succeeded.length === 1 ? '' : 's'}.`, 'success');
          }
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
      {/* Hero tile */}
      <div className="flex items-start gap-5 mb-8">
        <div
          className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: NAVY }}
        >
          <Users size={26} color="white" />
        </div>
        <div>
          <h2
            style={{
              fontFamily: HEADING_FONT,
              fontSize: 24,
              fontWeight: 700,
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
      </div>

      {/* Paste-from-spreadsheet block — above the rows */}
      <div className="mb-5">
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="inline-flex items-center gap-2 text-xs uppercase"
          style={{ color: NAVY, fontFamily: PILL_FONT, fontWeight: 900, letterSpacing: '0.08em' }}
        >
          <ClipboardList size={14} />
          {showPaste ? '− Hide paste from spreadsheet' : '+ Paste from spreadsheet'}
        </button>
        {showPaste && (
          <Card className="mt-3">
            <p className="text-xs mb-2" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
              One row per line — <span style={{ fontFamily: 'monospace' }}>email, department, role</span>
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="janet@vessel.com, Bridge, First Officer"
              rows={4}
              className="w-full px-3 py-2 text-sm outline-none resize-none"
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #CBD5E1',
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
                <span className="text-xs" style={{ color: '#64748B', fontFamily: BODY_FONT }}>{pasteResult}</span>
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
              <div className="col-span-12 md:col-span-5">
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
                  className="w-full px-2 py-2 text-sm outline-none"
                  style={{ backgroundColor: CARD, border: '1px solid #CBD5E1', borderRadius: 6, color: CHARCOAL, fontFamily: BODY_FONT }}
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
                    className="w-full px-2 py-2 text-sm outline-none"
                    style={{ backgroundColor: CARD, border: '1px solid #CBD5E1', borderRadius: 6, color: CHARCOAL, fontFamily: BODY_FONT }}
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
                    <Trash2 size={16} color="#94A3B8" />
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
        <div className="mt-4 text-sm px-3 py-2 rounded" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
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

// ─── Page shell ────────────────────────────────────────────────────

const StepPill = ({ label, index, current, done }) => (
  <div className="flex items-center gap-2">
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs"
      style={{
        backgroundColor: done ? ACCENT : current ? NAVY : '#E2E8F0',
        color: done || current ? 'white' : '#64748B',
        fontFamily: 'Archivo, sans-serif',
        fontWeight: 900,
      }}
    >
      {done ? <Check size={13} strokeWidth={3} /> : index}
    </div>
    <span
      className="uppercase text-xs"
      style={{
        fontFamily: 'Archivo, sans-serif',
        fontWeight: 900,
        letterSpacing: '0.10em',
        color: current ? NAVY : done ? ACCENT : '#94A3B8',
      }}
    >
      {label}
    </span>
  </div>
);

const OnboardingPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user, activeTenantId, bootstrapComplete, retryBootstrap } = useAuth();

  const [tenant, setTenant] = useState(null);
  const [step, setStep] = useState('vessel'); // vessel | departments | crew
  const [deptChoice, setDeptChoice] = useState({ baseSelected: [], customDepts: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [membershipRetries, setMembershipRetries] = useState(0);
  const retriedRef = useRef(false); // guard: only call retryBootstrap once

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
        @keyframes cgBreath { 0%,100% { box-shadow: 0 0 0 0 rgba(0,168,204,0.35); } 50% { box-shadow: 0 0 0 10px rgba(0,168,204,0); } }
        .cg-anim-enter { animation: cgFadeSlideUp 520ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-step-enter { animation: cgStepIn 420ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-tick-pop   { animation: cgTickPop 420ms cubic-bezier(.34,1.56,.64,1) both; }
        .cg-breath     { animation: cgBreath 2400ms ease-in-out infinite; }
        .cg-hover-lift { transition: transform 200ms ease, box-shadow 200ms ease; }
        .cg-hover-lift:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(30,58,95,0.12); }
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

  const logoSrc =
    theme === 'dark'
      ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'
      : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="text-center">
          <Anchor size={36} color={NAVY} className="mx-auto mb-3" />
          <p className="text-sm" style={{ color: '#64748B' }}>Loading your vessel…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <p className="text-sm" style={{ color: '#991B1B' }}>{loadError}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-10 px-4" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-center mb-6">
          <Image src={logoSrc} alt="Cargo" className="h-10" />
        </div>

        <div className="flex items-center justify-center gap-5 mb-8">
          <StepPill label="Vessel" index={1} current={step === 'vessel'} done={step !== 'vessel'} />
          <div className="w-10 h-px" style={{ backgroundColor: '#CBD5E1' }} />
          <StepPill label="Departments" index={2} current={step === 'departments'} done={step === 'crew'} />
          <div className="w-10 h-px" style={{ backgroundColor: '#CBD5E1' }} />
          <StepPill label="Crew" index={3} current={step === 'crew'} done={false} />
        </div>

        {step === 'vessel' && (
          <VesselSettingsStep
            tenant={tenant}
            onSaved={(updated) => {
              setTenant((t) => ({ ...t, ...updated }));
              setStep('departments');
            }}
          />
        )}
        {step === 'departments' && (
          <DepartmentsStep
            tenant={tenant}
            userId={user?.id}
            onBack={() => setStep('vessel')}
            onComplete={(choice) => {
              setDeptChoice(choice);
              setStep('crew');
            }}
          />
        )}
        {step === 'crew' && (
          <InviteCrewStep
            tenant={tenant}
            departments={deptChoice.baseSelected}
            customDepts={deptChoice.customDepts}
            deptObjs={deptChoice.departments}
            onBack={() => setStep('departments')}
            onFinish={() => navigate('/dashboard', { replace: true })}
          />
        )}
      </div>
    </div>
  );
};

export default OnboardingPage;
