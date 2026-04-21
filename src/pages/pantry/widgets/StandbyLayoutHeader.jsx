import React from 'react';
import { useNavigate } from 'react-router-dom';
import ContextBar from './ContextBar';
import PageGreeting from './PageGreeting';
import NowAndDutyStack from './NowAndDutyStack';

export default function StandbyLayoutHeader({
  title = null,
  subtitle = null,
  backTo = null,
  backLabel = 'Back to Standby',
  showDuty = true,
}) {
  const navigate = useNavigate();

  return (
    <div className="p-header-row">
      <div style={{ flex: 1 }}>
        {backTo && (
          <button
            className="p-back-link"
            onClick={() => navigate(backTo)}
            aria-label={backLabel}
          >
            {backLabel}
          </button>
        )}
        <ContextBar />
        <PageGreeting activeService={title} subtitle={subtitle} />
      </div>
      {showDuty && <NowAndDutyStack />}
    </div>
  );
}
