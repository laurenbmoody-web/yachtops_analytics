// Cargo Accounts — what stands between this month and a closed one.
//
// These were two lines of plain text wedged between the statement fields and the
// Close button: shaped like the money rows above them, so they read as figures to
// absorb when they're actually chores to do — and they weren't clickable, so
// there was nothing to do about them from there anyway.
//
// They're counts of work, not money, so they get the panel's serif figure
// treatment and sit in their own space beside the wallet rather than interrupting
// the cash-book. Each one filters the list to exactly the lines it counted — the
// same predicate that produced the number, so the count and the list can't
// disagree.
import React from 'react';
import Icon from '../../../components/AppIcon';
import './close-blockers.css';

export default function CloseBlockers({ blockers = [], activeNeed = '', monthLabel, onPick }) {
  // Only the ones that are someone's job. A difference against the statement is
  // also a blocker, but it's explained where the statement is, not here.
  const work = blockers.filter((b) => b.count > 0);
  if (!work.length) return null;

  return (
    <section className="cb">
      <p className="cb-lab">Before {monthLabel} can close</p>
      <div className="cb-set">
        {work.map((b) => {
          const on = activeNeed === b.key;
          return (
            <button key={b.key} type="button" className={`cb-item${on ? ' on' : ''}`}
              aria-pressed={on} onClick={() => onPick?.(on ? '' : b.key)}>
              <b>{b.count}</b>
              <span>{b.count === 1 ? 'line' : 'lines'} {b.label}</span>
              {/* Always visible, never hover-only: a target you can only find with
                  a cursor is no target on a tablet in a galley. */}
              <em>{on ? 'Showing them' : 'Show them'} <Icon name={on ? 'X' : 'ArrowRight'} size={12} /></em>
            </button>
          );
        })}
      </div>
    </section>
  );
}
