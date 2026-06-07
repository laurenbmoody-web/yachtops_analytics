import React from 'react';
import './bulk-action-bar.css';

/**
 * Floating bottom action bar for the items list selection model.
 *
 * Renders nothing when nothing is selected AND no action is in flight.
 * Mounting is parent-controlled — `selectedCount === 0 && !busy` returns
 * null so the bar disappears cleanly between selections.
 *
 * Verb visibility is opt-in: each action button renders only if the
 * corresponding handler prop is provided. Commit 1 ships with Mark
 * received + Clear; subsequent commits enable Edit / Change dept /
 * Delete by passing those handlers from the parent.
 *
 * The `busy` flag swaps the action row for a progress indicator (spinner
 * + busyText). Clear stays available so the user can bail mid-action if
 * the parent's handler supports cancellation — current commit 1
 * implementation doesn't, but the bar makes no assumption either way.
 */
const BulkActionBar = ({
  selectedCount,
  busy = false,
  busyText = '',
  onMarkReceived,
  onEdit,
  onChangeDept,
  onDelete,
  onClear,
}) => {
  // Parent unmount is the simplest path — we don't try to animate-out
  // on the way down because React unmounts the node before the
  // transition can run. .is-visible is the animate-in class flipped
  // on the first render after mount.
  if (selectedCount === 0 && !busy) return null;

  return (
    <div className="pv-bulk-bar pv-dashboard is-visible" role="region" aria-label="Bulk actions for selected items">
      <span className="pv-bulk-bar-count">
        <strong>{selectedCount}</strong> item{selectedCount === 1 ? '' : 's'} selected
      </span>

      {busy ? (
        <div className="pv-bulk-bar-busy" aria-live="polite">
          <span className="pv-bulk-bar-spinner" aria-hidden="true" />
          <span>{busyText}</span>
        </div>
      ) : (
        <div className="pv-bulk-bar-actions">
          {onMarkReceived && (
            <button
              type="button"
              onClick={onMarkReceived}
              className="pv-bulk-bar-btn pv-bulk-bar-btn-primary"
            >
              Mark received
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="pv-bulk-bar-btn pv-bulk-bar-btn-ghost"
            >
              Edit
            </button>
          )}
          {onChangeDept && (
            <button
              type="button"
              onClick={onChangeDept}
              className="pv-bulk-bar-btn pv-bulk-bar-btn-ghost"
            >
              Change dept
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="pv-bulk-bar-btn pv-bulk-bar-btn-danger"
            >
              Delete
            </button>
          )}
        </div>
      )}

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="pv-bulk-bar-btn-quiet"
        >
          Clear
        </button>
      )}
    </div>
  );
};

export default BulkActionBar;
