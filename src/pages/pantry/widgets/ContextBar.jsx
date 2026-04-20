import React from 'react';
import { useWeather } from '../hooks/useWeather';

const LOCATION = 'PALMA DE MALLORCA';
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

export default function ContextBar() {
  const { temp, condition, wind, sunset } = useWeather();

  const now = new Date();
  const dateStr = `${DAY_NAMES[now.getDay()]} · ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`;

  return (
    <div className="p-context-bar">
      <div className="p-cb-seg">
        <LocationPin />
        <span>{LOCATION}</span>
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
