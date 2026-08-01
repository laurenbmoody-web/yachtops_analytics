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

// A coverflow: the card you're on sits in the middle of the stage with its
// neighbours falling away either side, still heavily overlapped like a wallet
// rather than laid out as a row. Fanning in one direction only meant the stack
// hugged the left of the stage, so the arrows could never be evenly spaced
// around it — one sat against a card and the other against empty canvas.
const SIDE = 2;    // how many peek out each side
const STEP = 46;   // reveal per card — deep overlap, a wallet not a shelf
const slotAt = (k) => {           // k = signed distance from the centred card
  const d = Math.abs(k);
  return { x: k * STEP, s: 1 - d * 0.06, o: d === 0 ? 1 : 0.92 - d * 0.2, z: 50 - d * 10 };
};

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
  unassigned = 0, onSelect, today, figures, unassignedOn = false, onShowUnassigned,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  if (!accounts.length) return null;

  // Cards keep their natural order and the window slides over them — that's what
  // makes stepping read as travel along a stack rather than the pile reshuffling
  // itself every time you press an arrow.
  const idx = accounts.findIndex((a) => a.id === activeId);
  const centre = idx < 0 ? 0 : idx;   // "All" centres the first card without selecting it

  const slot = (i) => {
    const k = i - centre;
    const s = slotAt(k);
    const shown = Math.abs(k) <= SIDE;
    return {
      transform: `translate(calc(-50% + ${s.x}px), -50%) scale(${s.s})`,
      opacity: shown ? s.o : 0,
      zIndex: s.z,
      pointerEvents: shown ? 'auto' : 'none',
    };
  };

  // The arrows reach every card, so a list in text is only worth having when
  // stepping one at a time would be a chore. Then it's a jump-to, not an
  // overflow — it names every card, and it stays one button either way.
  const longWallet = accounts.length > 6;

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

        {/* Keyed off whether a card is actually chosen, not off activeId being
            set: the unassigned-lines scope is also "no card", and it should read
            that way rather than leaving a card looking picked. */}
        <div className={`as-stage${idx >= 0 ? '' : ' is-all'}`}>
          {accounts.map((a, i) => {
            // Inert only where the flip takes over — i.e. the card you're on.
            // Keyed off the flip, not off carousel position: on "All" nothing
            // flips, so the centred card stays clickable rather than going dead.
            const isFront = a.id === activeId;
            return (
              <div key={a.id} className={`as-slot${isFront ? ' is-front' : ''}`} style={slot(i)}
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
        {longWallet && (
          <div className="as-more">
            <button type="button" className="as-morebtn" aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}>
              Jump to<Icon name={moreOpen ? 'ChevronUp' : 'ChevronDown'} size={13} />
            </button>
            {moreOpen && (
              <div className="as-morepop">
                {accounts.map((a) => (
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

      {/* "4 lines have no account yet" said what was true without saying what it
          meant or what to do. These are lines imported or typed without a card:
          no card means no statement, and no statement means no close will ever
          cover them — so they'd sit outside every month-end unnoticed. Now it
          says that, and it shows them. */}
      {unassigned > 0 && (
        <button type="button" className={`as-orphan${unassignedOn ? ' on' : ''}`}
          onClick={() => onShowUnassigned?.()}>
          <Icon name="AlertCircle" size={13} />
          {unassignedOn ? (
            <span>Showing the {unassigned} {unassigned === 1 ? 'line' : 'lines'} with no card — <em>back to all</em></span>
          ) : (
            <span>
              {unassigned} {unassigned === 1 ? 'line isn’t' : 'lines aren’t'} on a card, so no
              month-end covers {unassigned === 1 ? 'it' : 'them'} — <em>show {unassigned === 1 ? 'it' : 'them'}</em>
            </span>
          )}
        </button>
      )}

      {/* The month's money, beside the card it belongs to rather than stranded on
          its own row. A ledger that ladders to Net, not four flat tiles — same
          shape as the month-end arithmetic, so the two read as one method. */}
      {figures && <div className="as-figures">{figures}</div>}
    </section>
  );
}
