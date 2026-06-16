import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useCurrentRota } from '../../crew-rota/useCurrentRota';
import { useRotaDepartmentStatus } from '../../crew-rota/useRotaDepartmentStatus';

// Dashboard entry-point for the standalone vessel rota. Links to /crew — the
// trip-independent rota page — never to a trip. Surfaces the standing rota's
// department lifecycle at a glance (published / pending approval / draft) so
// the publish + submit-for-approval state is visible without opening the page.
const RotaWidget = () => {
  const navigate = useNavigate();
  const { rota, loading: rotaLoading } = useCurrentRota();
  const { statusByDept, loading: statusLoading } = useRotaDepartmentStatus(rota?.id);

  const loading = rotaLoading || (rota?.id && statusLoading);

  // Tally department lifecycle states from the status rows that exist. Rows are
  // created lazily on first edit, so an empty map means the rota is untouched.
  let published = 0;
  let pending = 0;
  let draft = 0;
  for (const entry of statusByDept.values()) {
    if (entry.status === 'published') published += 1;
    else if (entry.status === 'pending_approval') pending += 1;
    else draft += 1;
  }
  const total = statusByDept.size;

  const allPublished = total > 0 && pending === 0 && draft === 0;
  const hasActivity = total > 0;

  // Live status subline — orange-italic when something needs attention
  // (pending approvals or drafts), navy otherwise.
  let statusText = 'All published';
  let statusAttention = false;
  if (loading) {
    statusText = 'Loading…';
  } else if (!rota?.id) {
    statusText = 'No rota configured';
  } else if (!hasActivity) {
    statusText = 'Not started yet';
  } else if (pending > 0) {
    statusText = `${pending} pending approval`;
    statusAttention = true;
  } else if (draft > 0) {
    statusText = `${draft} in draft`;
    statusAttention = true;
  }

  const summaryRows = [
    { label: 'Published', count: published, icon: 'Circle' },
    { label: 'Pending approval', count: pending, icon: 'Circle' },
    { label: 'Draft', count: draft, icon: 'Circle' },
  ];

  return (
    <div
      className="ce-card rounded-xl p-5 cursor-pointer"
      onClick={() => navigate('/crew')}
    >
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="ce-title">Rota</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link">Open rota</span>
      </div>
      <div className="flex items-center justify-center py-6 mb-5">
        <div className="relative">
          {loading ? (
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
              <LogoSpinner size={32} />
            </div>
          ) : (
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
              allPublished ? 'ce-bg-success' : hasActivity ? 'ce-bg-warn' : 'bg-muted'
            }`}>
              <Icon
                name={allPublished ? 'CheckCircle' : hasActivity ? 'AlertTriangle' : 'CalendarClock'}
                className={`w-10 h-10 ${
                  allPublished ? 'ce-fg-success' : hasActivity ? 'ce-fg-warn' : 'text-muted-foreground'
                }`}
              />
            </div>
          )}
        </div>
      </div>
      <div className="text-center mb-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !rota?.id ? (
          <>
            <p className="ce-title">No rota yet.</p>
            <p className="ce-status is-attention mt-1">Set up the rota →</p>
          </>
        ) : !hasActivity ? (
          <>
            <p className="ce-title">Not started yet.</p>
            <p className="ce-status is-attention mt-1">Build the rota →</p>
          </>
        ) : (
          <>
            <p className={`text-lg font-semibold ${allPublished ? 'ce-fg-success' : 'ce-fg-warn'}`}>
              {allPublished ? 'All published' : 'Needs attention'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {`${total} department${total !== 1 ? 's' : ''} tracked`}
            </p>
          </>
        )}
      </div>
      <div className="space-y-2">
        {summaryRows.map((row, index) => (
          <div
            key={index}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
          >
            <div className="flex items-center gap-2 ce-ico-muted">
              <Icon name={row.icon} className="w-4 h-4" />
              <span className="text-xs text-foreground">{row.label}</span>
            </div>
            <span className="text-sm font-bold text-foreground">
              {loading ? '—' : row.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RotaWidget;
