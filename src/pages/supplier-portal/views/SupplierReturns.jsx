import React from 'react';
import EmptyState from '../components/EmptyState';

const SupplierReturns = () => (
  <div className="sp-page">
    <div className="sp-page-head">
      <div>
        <div className="sp-eyebrow">Returns &amp; issues</div>
        <h1 className="sp-page-title">Returns &amp; <em>issues</em></h1>
        <p className="sp-page-sub">Shortages, damages, refused lines. Resolve fast to keep repeat rate up.</p>
      </div>
    </div>
    <EmptyState
      icon="↩️"
      title="No open returns"
      body="Returns and issue reports from your yacht clients will appear here."
    />
  </div>
);

export default SupplierReturns;
