import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import { useProvisioningApprovals } from './useProvisioningApprovals';

// OrdersReviewPanel — pending provisioning approvals assigned to the
// current user. List strip rendered with the same eyebrow/title/
// subtitle rhythm as the rotas queue. Click a card → navigate to the
// board; the board itself already renders the "Your review" chip + the
// Approve / Request changes buttons (PR3 of the approval-routing
// feature). PR C will introduce a right-pane summary so the approver
// can scan the items without leaving the inbox; for now click-through
// is the simplest correct behaviour.

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const tidyBoardType = (t) => {
  const upper = String(t || '').toUpperCase();
  if (upper === 'GENERAL') return 'BOARD';
  return upper;
};

export default function OrdersReviewPanel() {
  const navigate = useNavigate();
  const { items, loading } = useProvisioningApprovals();

  const count = items.length;
  const subtitle = loading
    ? 'Loading…'
    : `${count} board${count === 1 ? '' : 's'} awaiting your decision`;

  return (
    <section className="rv-liststrip" aria-label="Order approvals">
      <div className="rv-eyebrow">PROVISIONING</div>
      <h1 className="rv-title">
        ORDERS<span className="rv-title-comma">,</span>
        <em className="rv-title-verb"> to approve</em>
        <span className="rv-title-period">.</span>
      </h1>
      <div className="rv-subtitle">{subtitle}</div>

      <div className="rv-cc-list" style={{ marginTop: 18 }}>
        {!loading && items.length === 0 ? (
          <div className="rv-cc-empty" role="status">
            Nothing to review.
          </div>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="rv-cc"
              onClick={() => navigate(`/provisioning/${it.list_id}`)}
              aria-label={`${it.board_title} — submitted by ${it.submitter_name}, ${timeAgo(it.created_at)}`}
            >
              <div className="rv-cc-head">
                <div className="rv-cc-dept">{tidyBoardType(it.board_type)}</div>
                <div className="rv-cc-time">{timeAgo(it.created_at)}</div>
              </div>
              <div className="rv-cc-rota">{it.board_title}</div>
              <div className="rv-cc-strip">
                <Icon name="User" size={12} />
                <span>{it.submitter_name}</span>
                {it.primary_dept && (
                  <>
                    <span aria-hidden="true" style={{ margin: '0 6px' }}>·</span>
                    <span>{it.primary_dept}</span>
                  </>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
