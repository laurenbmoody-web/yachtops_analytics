import React from 'react';

const KPICard = ({ label, value, sub, accent, icon: Icon }) => (
  <div className="sp-kpi" style={accent ? { '--kpi-accent': accent } : {}}>
    {Icon && <Icon size={15} style={{ color: accent ?? 'var(--muted-s)', marginBottom: 6 }} />}
    <div className="sp-kpi-v">{value ?? '—'}</div>
    <div className="sp-kpi-l">{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--muted-s)', marginTop: 3 }}>{sub}</div>}
  </div>
);

export default KPICard;
