import React from 'react';
import Icon from '../../components/AppIcon';

// OrdersReviewPanel — placeholder panel for the provisioning approval
// inbox. PR B will replace this with a real list strip + right pane
// driven by provisioning_approval_requests where approver_id = me.
//
// For PR A this exists so the sidebar's new "Order approvals" item is
// reachable — clicking it lands here instead of crashing or 404-ing.

export default function OrdersReviewPanel() {
  return (
    <section className="rv-liststrip" aria-label="Order approvals">
      <div className="rv-eyebrow">PROVISIONING</div>
      <h1 className="rv-title">
        ORDERS<span className="rv-title-comma">,</span>
        <em className="rv-title-verb"> to approve</em>
        <span className="rv-title-period">.</span>
      </h1>
      <div className="rv-subtitle">Provisioning boards submitted for your approval.</div>

      <div className="rv-cc-empty" role="status" style={{ marginTop: 24 }}>
        <Icon name="ShoppingCart" size={32} color="#8B8478" />
        <div style={{ marginTop: 12, fontWeight: 600 }}>Queue coming next</div>
        <div style={{ marginTop: 6, fontSize: 13, color: '#8B8478', maxWidth: 320 }}>
          PR B wires this surface to <code>provisioning_approval_requests</code>.
          For now use the bell notification or the board's "Your review" chip
          to open a pending board directly.
        </div>
      </div>
    </section>
  );
}
