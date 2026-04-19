import React from 'react';
import EmptyState from '../components/EmptyState';

const SupplierMessages = () => (
  <div className="sp-page">
    <div className="sp-page-head">
      <div>
        <div className="sp-eyebrow">Inbox</div>
        <h1 className="sp-page-title">Yacht <em>messages</em></h1>
        <p className="sp-page-sub">Direct conversations with your yacht clients, scoped to orders.</p>
      </div>
    </div>
    <EmptyState
      icon="💬"
      title="Messaging coming soon"
      body="Real-time order messaging will launch in the next update. For now, use email to communicate with clients."
    />
  </div>
);

export default SupplierMessages;
