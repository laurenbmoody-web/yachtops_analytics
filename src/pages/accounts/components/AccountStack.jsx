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
import { formatMoney } from '../../../services/financeCalc';
import { monthEndStage } from '../../../services/monthEnd';
import './account-stack.css';

// Front card, then two peeking behind it. Beyond three the fan stops moving —
// depth past that reads as clutter, and the rail underneath does the choosing.
const STACK = [
  { x: 0, y: 0, s: 1, o: 1, z: 30 },
  { x: 18, y: 16, s: 0.955, o: 0.9, z: 20 },
  { x: 36, y: 32, s: 0.912, o: 0.78, z: 10 },
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
  accounts = [], activeId = '', monthLabel, monthKey, statsFor, reconFor,
  unassigned = 0, onSelect, today, month, figures,
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
      cursor: pos === 0 ? 'default' : 'pointer',
    };
  };

  const stage = monthEndStage(monthKey, today || new Date());
  const front = accounts.find((a) => a.id === order[0]) || accounts[0];
  // When the page is filtered to this card, the figures column beside us IS this
  // card's month — so restating its count and total here is the same number twice.
  // On "All" it isn't: the column is the whole vessel, and the card's own share is
  // the one thing you can't read anywhere else.
  const scoped = activeId === front.id;
  const frontStat = statsFor?.(front.id) || { count: 0, out: 0 };
  const frontState = stateFor(reconFor?.(front.id), stage);
  const balanced = accounts.filter((a) => (reconFor?.(a.id)?.status || 'open') !== 'open').length;

  return (
    <section className="as">
      <div className="as-stage">
        {accounts.map((a) => (
          <div key={a.id} className="as-slot" style={slot(a.id)}
            onClick={() => a.id !== order[0] && onSelect?.(a.id)}>
            {/* No balance override — the card's back says "balance on card", which
                is the account's balance, not this month's spend. */}
            <CardVisual account={a} size="md"
              flip={a.id === order[0] ? 'hover' : 'none'}
              status={a.id === order[0] ? frontState : undefined} />
          </div>
        ))}
      </div>

      <div className="as-side">
        {/* The month scopes the card, so it steps from here — one line above the
            card's name, not a second big serif heading competing with it. */}
        <div className="as-eyebrow">
          {month || <span>{monthLabel}</span>}
          {/* No card count — the rail below is the cards, and counting what's
              already on screen isn't information. How many are BALANCED isn't
              visible anywhere else, so that earns its place once it's due. */}
          {stage === 'due' && <span className="as-n">{balanced} of {accounts.length} balanced</span>}
        </div>
        <p className="as-name">{front.name}{front.card_last4 && front.card_last4 !== '0000' ? ` ••${front.card_last4}` : ''}</p>
        {!scoped && (
          <p className="as-sub">
            {frontStat.count} {frontStat.count === 1 ? 'line' : 'lines'} · {formatMoney(frontStat.out, front.currency, { signed: true })}
          </p>
        )}
        {/* "Still running" is the default state of the month you're in, and the
            month-end bar below already says it in a sentence. Only a state you'd
            act on is worth a line here. */}
        {stage !== 'running' && <p className={`as-state is-${frontState.tone}`}>{frontState.text}</p>}

        {/* One rail for every card, because past the third the fan stops moving. */}
        <div className="as-rail">
          {accounts.map((a) => (
            <button key={a.id} type="button" className={`as-tab${a.id === activeId ? ' on' : ''}`}
              onClick={() => onSelect?.(a.id)} title={a.name}>
              {a.card_last4 && a.card_last4 !== '0000' ? `••${a.card_last4}` : a.name}
            </button>
          ))}
          <button type="button" className={`as-tab is-all${!activeId ? ' on' : ''}`}
            onClick={() => onSelect?.('')} title="Every account — no close, there's no single statement">
            All
          </button>
        </div>

        {/* Spend belonging to no account can't be balanced against any statement,
            so it would sit outside every close unremarked. */}
        {unassigned > 0 && (
          <p className="as-orphan">
            <Icon name="AlertCircle" size={13} />
            {unassigned} {unassigned === 1 ? 'line has' : 'lines have'} no account yet
          </p>
        )}
      </div>

      {/* The month's money, beside the card it belongs to rather than stranded on
          its own row. A ledger that ladders to Net, not four flat tiles — same
          shape as the month-end arithmetic, so the two read as one method. */}
      {figures && <div className="as-figures">{figures}</div>}
    </section>
  );
}
