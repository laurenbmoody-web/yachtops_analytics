import React, { useState, useEffect } from 'react';
import { useInteriorDuty } from '../hooks/useInteriorDuty';

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function NowAndDutyStack() {
  const { onDuty } = useInteriorDuty();

  return (
    <div className="p-now-stack">
      {/* Now card */}
      <div className="p-card" style={{ padding: '14px 18px' }}>
        <div className="p-caps" style={{ marginBottom: 2 }}>Now</div>
        <div className="p-now-time"><LiveClock /></div>
      </div>

      {/* On duty card */}
      <div className="p-card" style={{ padding: '14px 18px' }}>
        <div className="p-caps" style={{ marginBottom: 4 }}>On duty</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: '#1C1B3A', color: '#F5F1EA',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
            flexShrink: 0,
          }}>
            {onDuty?.name?.slice(0, 2).toUpperCase() ?? '??'}
          </div>
          <div>
            <div className="p-duty-name">{onDuty?.name ?? '—'}</div>
            {onDuty?.until && (
              <div className="p-duty-until">until {onDuty.until}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
