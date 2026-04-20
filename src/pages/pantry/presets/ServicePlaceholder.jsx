import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../pantry.css';

export default function ServicePlaceholder() {
  const { type } = useParams();
  const navigate = useNavigate();
  const name = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Service';

  return (
    <div id="pantry-root" className="pantry-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="p-caps" style={{ marginBottom: 12 }}>Service preset</div>
        <h1 className="p-greeting" style={{ fontSize: 44 }}>
          {name.toUpperCase()}<span className="p-greeting-punctuation">.</span>
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--ink-muted)', marginTop: 8, marginBottom: 24 }}>
          This preset is coming in a future sprint.
        </p>
        <button className="p-btn outline" onClick={() => navigate('/pantry/standby')}>
          ← Back to Standby
        </button>
      </div>
    </div>
  );
}
