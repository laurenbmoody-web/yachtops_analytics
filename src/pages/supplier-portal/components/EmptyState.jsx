import React from 'react';

const EmptyState = ({ icon = '📭', title, body, action }) => (
  <div className="sp-empty">
    <div className="sp-empty-icon">{icon}</div>
    {title && <div className="sp-empty-title">{title}</div>}
    {body  && <div className="sp-empty-body">{body}</div>}
    {action && <div style={{ marginTop: 18 }}>{action}</div>}
  </div>
);

export default EmptyState;
