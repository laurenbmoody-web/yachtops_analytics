import React from 'react';

const COLORS = ['m1', 'm2', 'm3', 'm4', 'm5'];

const initials = (name = '') =>
  name.replace(/^[MS]\/Y\s*/i, '').slice(0, 3).toUpperCase();

const colorFor = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
};

const YachtBadge = ({ name, size = 32, radius = 9, style }) => {
  const cls = colorFor(name);
  const short = initials(name);
  const fontSize = size <= 28 ? 10 : size <= 36 ? 11 : 12;
  return (
    <div
      className={`sp-ym ${cls}`}
      style={{ width: size, height: size, borderRadius: radius, fontSize, flexShrink: 0, ...style }}
    >
      {short}
    </div>
  );
};

export default YachtBadge;
