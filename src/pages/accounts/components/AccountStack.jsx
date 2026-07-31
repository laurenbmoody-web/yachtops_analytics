// Cargo Accounts — the vessel's cards as a wallet stack, and the thing that
// scopes the Spending page.
//
// Balancing is per account against that account's own statement, so a page
// showing every account at once can't be balanced at all. Choosing a card here
// scopes the month, the figures and the close to that card — the same wallet
// stack the crew already use on their own reconcile page (pages/accounts/my),
// lifted out so both read the same.
//
// "All accounts" stays available for eyeballing the whole month; it simply has no
// close, because there is no single statement to close it against.
import React from 'react';
import Icon from '../../../components/AppIcon';
import CardVisual from './CardVisual';
import { monthEndStage } from '../../../services/monthEnd';
import './account-stack.css';

// The fan IS the account picker now, so the cards behind peek far enough to be
// aimed at and clicked rather than hinted at. Beyond three it stops moving —
// depth past that reads as clutter, and the overflow rail does the choosing.
const STACK = [
  { x: 0, y: 0, s: 1, o: 1, z: 30 },
  { x: 92, y: 15, s: 0.955, o: 0.92, z: 20 },
  { x: 184, y: 30, s: 0.912, o: 0.82, z: 10 },
];

// "Not balanced" on a month that hasn't ended yet is a telling-off for being on
// time, so a running month says what it is instead.
const stateFor = (recon, stage) => {
  const status = recon?.status || 'open';
  if (status === 'approved') return { text: 'Signed off', tone: 'ok' };
  if (status === 'submitted') return { text: 'Awaiting sign-off', tone: 'sub' };
  if (stage === 'running') return { text: 'Still running', tone: 'sub' };
  if (stage === 'ahead') return { text: 'Not started', tone: 'sub' };
  return { text: 'To balance', tone: 'due' };
};

export default function AccountStack({
  accounts = [], activeId = '', monthKey, reconFor,
  unassigned = 0, onSelect, today, figures,
}) {
  if (!accounts.length) return null;

  // The chosen card leads; the rest keep their order behind it.
  const order = activeId && accounts.some((a) => a.id === activeId)
    ? [activeId, ...accounts.filter((a) => a.id !== activeId).map((a) => a.id)]
    : accounts.map((a) => a.id);

  const slot = (id) => {
    const pos = order.indexOf(id);
    const s = STACK[Math.min(pos, STACK.length - 1)];
    return {
      transform: `translate(${s.x}px,${s.y}px) scale(${s.s})`,
      opacity: pos > 2 ? 0 : s.o,
      zIndex: s.z - Math.max(0, pos - 2),
      pointerEvents: pos > 2 ? 'none' : 'auto',
      cursor: 'pointer',
    };
  };

  const stage = monthEndStage(monthKey, today || new Date());
  // Only a card you've actually chosen has a state worth badging — on "All" there
  // is no one card, and badging whichever happens to be at the front of the fan is
  // how the old text column ended up announcing an account nobody had selected.
  const picked = accounts.find((a) => a.id === activeId);
  const pickedState = picked ? stateFor(reconFor?.(picked.id), stage) : null;
  const balanced = accounts.filter((a) => (reconFor?.(a.id)?.status || 'open') !== 'open').length;

  return (
    <section className="as">
      <div className={`as-stage${activeId ? '' : ' is-all'}`}>
        {accounts.map((a) => (
          <div key={a.id} className="as-slot" style={slot(a.id)}
            onClick={() => onSelect?.(a.id)}>
            {/* No balance override — the card's back says "balance on card", which
                is the account's balance, not this month's spend. */}
            <CardVisual account={a} size="md"
              flip={a.id === activeId ? 'hover' : 'none'}
              status={a.id === activeId ? pickedState : undefined} />
          </div>
        ))}
      </div>

      {/* Everything that was written out here — the account's name, its totals,
          a rail repeating the cards — was the cards' own job done again in text.
          What's left is the one control the fan can't be: "every card at once",
          which is a scope no single card represents. */}
      <div className="as-pick">
        <button type="button" className={`as-all${!activeId ? ' on' : ''}`}
          onClick={() => onSelect?.('')}
          title="Every account together — no close, because there's no single statement to close against">
          All {accounts.length} cards
        </button>
        {/* Past the third card the fan stops moving, so those accounts would have
            no way to be reached at all. The rail appears only for them. */}
        {accounts.length > 3 && accounts.map((a) => (
          <button key={a.id} type="button" className={`as-tab${a.id === activeId ? ' on' : ''}`}
            onClick={() => onSelect?.(a.id)} title={a.name}>
            {a.card_last4 && a.card_last4 !== '0000' ? `••${a.card_last4}` : a.name}
          </button>
        ))}
        {stage === 'due' && <span className="as-n">{balanced} of {accounts.length} balanced</span>}
      </div>

      {/* Spend belonging to no account can't be balanced against any statement,
          so it would sit outside every close unremarked. */}
      {unassigned > 0 && (
        <p className="as-orphan">
          <Icon name="AlertCircle" size={13} />
          {unassigned} {unassigned === 1 ? 'line has' : 'lines have'} no account yet
        </p>
      )}

      {/* The month's money, beside the card it belongs to rather than stranded on
          its own row. A ledger that ladders to Net, not four flat tiles — same
          shape as the month-end arithmetic, so the two read as one method. */}
      {figures && <div className="as-figures">{figures}</div>}
    </section>
  );
}
