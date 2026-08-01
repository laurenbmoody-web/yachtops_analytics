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
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import CardVisual from './CardVisual';
import { monthEndStage } from '../../../services/monthEnd';
import { accountLabel } from '../../../services/accountPick';
import './account-stack.css';

// A wallet, so the cards sit over one another — a shallow overlap, not a row of
// cards laid out side by side. A ~30px reveal is still a comfortable click
// target, and stacking tighter is what lets SIX of them fit where three used to,
// which is what retires the rail of name pills underneath: the fan reaches every
// card a vessel normally has, so nothing needs listing in text as well.
const FAN = 6;
const slotAt = (i) => ({
  x: i * 30, y: i * 12, s: 1 - i * 0.03, o: 1 - i * 0.07, z: 60 - i * 10,
});

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
  const [moreOpen, setMoreOpen] = useState(false);
  if (!accounts.length) return null;

  // The chosen card leads; the rest keep their order behind it.
  const order = activeId && accounts.some((a) => a.id === activeId)
    ? [activeId, ...accounts.filter((a) => a.id !== activeId).map((a) => a.id)]
    : accounts.map((a) => a.id);

  const slot = (id) => {
    const pos = order.indexOf(id);
    const s = slotAt(Math.min(pos, FAN - 1));
    const shown = pos < FAN;
    return {
      transform: `translate(${s.x}px,${s.y}px) scale(${s.s})`,
      opacity: shown ? s.o : 0,
      zIndex: s.z - Math.max(0, pos - (FAN - 1)),
      pointerEvents: shown ? 'auto' : 'none',
    };
  };

  // Where the carousel is. -1 on "All", so the first press of Next lands on the
  // first card rather than skipping it.
  const idx = accounts.findIndex((a) => a.id === activeId);

  // Only a vessel with more accounts than the wallet can show needs anything in
  // text, and then only for the ones it can't reach.
  const hidden = order.slice(FAN).map((id) => accounts.find((a) => a.id === id)).filter(Boolean);

  const stage = monthEndStage(monthKey, today || new Date());
  // Only a card you've actually chosen has a state worth badging — on "All" there
  // is no one card, and badging whichever happens to be at the front of the fan is
  // how the old text column ended up announcing an account nobody had selected.
  const picked = accounts.find((a) => a.id === activeId);
  const pickedState = picked ? stateFor(reconFor?.(picked.id), stage) : null;
  const balanced = accounts.filter((a) => (reconFor?.(a.id)?.status || 'open') !== 'open').length;

  return (
    <section className="as">
      {/* Arrows step the wallet; the card at the front is the one you're on.
          The front card used to be a click target AND flip on hover, so the two
          fought each other: you had to hover it to click it, which flipped it
          away from under you. Stepping is a control now, and the flip is left to
          be what it is — a look at the balance on the card. */}
      <div className="as-carousel">
        <button type="button" className="as-arrow" aria-label="Previous card"
          disabled={idx <= 0} onClick={() => onSelect?.(accounts[Math.max(idx - 1, 0)].id)}>
          <Icon name="ChevronLeft" size={19} />
        </button>

        <div className={`as-stage${activeId ? '' : ' is-all'}`}>
          {accounts.map((a) => {
            // Inert only where the flip takes over — i.e. the card you're on.
            // Keyed off the flip, not off fan position: on "All" nothing flips,
            // so the card at the front stays clickable rather than going dead.
            const isFront = a.id === activeId;
            return (
              <div key={a.id} className={`as-slot${isFront ? ' is-front' : ''}`} style={slot(a.id)}
                onClick={isFront ? undefined : () => onSelect?.(a.id)}>
                {/* No balance override — the card's back says "balance on card",
                    which is the account's balance, not this month's spend. */}
                <CardVisual account={a} size="md"
                  flip={a.id === activeId ? 'hover' : 'none'}
                  status={a.id === activeId ? pickedState : undefined} />
              </div>
            );
          })}
        </div>

        <button type="button" className="as-arrow" aria-label="Next card"
          disabled={idx >= accounts.length - 1}
          onClick={() => onSelect?.(accounts[Math.min(idx + 1, accounts.length - 1)].id)}>
          <Icon name="ChevronRight" size={19} />
        </button>
      </div>

      {/* Everything that was written out here — the account's name, its totals,
          a rail repeating the cards — was the cards' own job done again in text.
          What's left is the one control the fan can't be: "every card at once",
          which is a scope no single card represents. */}
      <div className="as-pick">
        <button type="button" className={`as-all${!activeId ? ' on' : ''}`}
          onClick={() => onSelect?.('')}
          title="Every account together — no close, because there's no single statement to close against">
          All {accounts.length} {accounts.length === 1 ? 'card' : 'cards'}
        </button>
        {/* No pill per card. The cards ARE the picker — naming them underneath is
            the wallet's job done twice, which is what the old text column did. */}
        {hidden.length > 0 && (
          <div className="as-more">
            <button type="button" className="as-morebtn" aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}>
              +{hidden.length} more<Icon name={moreOpen ? 'ChevronUp' : 'ChevronDown'} size={13} />
            </button>
            {moreOpen && (
              <div className="as-morepop">
                {hidden.map((a) => (
                  <button key={a.id} type="button" onClick={() => { onSelect?.(a.id); setMoreOpen(false); }}>
                    {accountLabel(a)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
