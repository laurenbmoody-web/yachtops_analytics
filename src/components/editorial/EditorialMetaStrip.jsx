import React from 'react';
import { useWeather } from '../../pages/pantry/hooks/useWeather';

/**
 * EditorialMetaStrip — tracked uppercase environmental/context meta row.
 *
 * Two modes:
 *
 *  1. "Default Pantry mode" — pass no `meta` prop. Renders the original
 *     four segments: location · day-date · weather · wind+sunset. Pulls
 *     weather from useWeather() hook. This preserves byte-identical
 *     output for the original Pantry consumers.
 *
 *  2. "Custom meta mode" — pass `meta` as an array of segment objects:
 *
 *       meta={[
 *         { icon: 'MapPin', label: 'Antibes' },
 *         { label: 'Wednesday · 29 April' },
 *         { label: 'Sent 25 Apr', muted: true },
 *         { label: '1 of 25 received', muted: true },
 *       ]}
 *
 *     `muted: true` styles the segment in `var(--ink-muted)` instead of
 *     `var(--ink)`. Falsy entries are filtered out, so callers can pass
 *     conditional segments inline (e.g. `port && { label: port }`).
 *
 * `location` overrides the default 'PALMA DE MALLORCA' label only when
 * `meta` is undefined. With a custom `meta`, location is whatever the
 * caller puts in the array.
 */

const DAY_NAMES   = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
const MONTH_NAMES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

const LocationPin = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const SunIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

// Tiny icon-by-name lookup so callers can pass `icon: 'MapPin'` without
// importing a component themselves. Add new ones lazily as consumers need
// them — no need to pre-stuff a registry.
const ICON_MAP = {
  MapPin: LocationPin,
  Sun: SunIcon,
};

function DefaultPantryMeta({ location }) {
  const { temp, condition, wind, sunset } = useWeather();
  const now = new Date();
  const dateStr = `${DAY_NAMES[now.getDay()]} · ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;

  return (
    <div className="p-context-bar">
      <div className="p-cb-seg">
        <LocationPin />
        <span>{location}</span>
      </div>
      <div className="p-cb-div" />
      <div className="p-cb-seg">
        <span>{dateStr}</span>
      </div>
      <div className="p-cb-div" />
      <div className="p-cb-seg">
        <SunIcon />
        <span>{temp} · {condition}</span>
      </div>
      <div className="p-cb-div" />
      <div className="p-cb-seg muted">
        <span>{wind} · Sunset {sunset}</span>
      </div>
    </div>
  );
}

function CustomMeta({ meta }) {
  const segments = (meta || []).filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <div className="p-context-bar">
      {segments.map((seg, i) => {
        const IconCmp = seg.icon ? ICON_MAP[seg.icon] : null;
        const segClass = `p-cb-seg${seg.muted ? ' muted' : ''}`;
        return (
          <React.Fragment key={i}>
            {i > 0 && <div className="p-cb-div" />}
            <div className={segClass}>
              {IconCmp && <IconCmp />}
              <span>{seg.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function EditorialMetaStrip({ meta, location = 'PALMA DE MALLORCA' }) {
  if (meta === null) return null;
  if (meta === undefined) return <DefaultPantryMeta location={location} />;
  return <CustomMeta meta={meta} />;
}
