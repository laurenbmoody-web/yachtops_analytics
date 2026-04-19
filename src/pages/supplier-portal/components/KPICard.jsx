import React from 'react';

const KPICard = ({ label, value, sub, icon: Icon, color = '' }) => (
  <div className={`sp-kpi${color ? ` ${color}` : ''}`}>
    <div className="sp-kpi-head">
      <div className="sp-kpi-l">{label}</div>
      {Icon && (
        <div className="sp-kpi-icon">
          <Icon />
        </div>
      )}
    </div>
    <div className="sp-kpi-v">{value ?? '—'}</div>
    {sub && <div className="sp-kpi-sub">{sub}</div>}
  </div>
);

export default KPICard;
