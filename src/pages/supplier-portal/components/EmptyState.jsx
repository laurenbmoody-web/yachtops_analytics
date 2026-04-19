import React from 'react';

const EmptyState = ({ icon = '📭', title, body, action }) => (
  <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--muted)' }}>
    <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
    {title && <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--fg)', marginBottom: 6 }}>{title}</div>}
    {body  && <div style={{ fontSize: 13, maxWidth: 320, margin: '0 auto' }}>{body}</div>}
    {action && <div style={{ marginTop: 18 }}>{action}</div>}
  </div>
);

export default EmptyState;
