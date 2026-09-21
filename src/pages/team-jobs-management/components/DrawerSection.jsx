import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';

/**
 * One section of a job drawer, in the three shapes the drawers need.
 *
 *   variant="row"      the To Do row: icon, the value where the label would
 *                      be, opening in place. For the handful of things you
 *                      set in passing — due date, assignee, priority.
 *   variant="plain"    a heading with its contents always showing. For the
 *                      rest, which read better as sections than as a stack of
 *                      chevrons; a chevron on a short read-out costs a line
 *                      and saves nothing.
 *   variant="accordion" the collapsed row with its value on the right.
 *
 * `summary` is what the section says about itself while shut. Make it the
 * value, not a count of fields: "Interior · Additional jobs" tells you
 * whether to open it; "2 fields" never does.
 */
const EMPTY = ['none', 'not set', 'nobody', 'no board', 'one-time job', 'not part of one'];

const DrawerSection = ({
  icon,
  title,
  summary,
  action,
  defaultOpen = false,
  variant = 'accordion',
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  if (variant === 'plain') {
    return (
      <div className="jm-plainsec">
        <div className="jm-plainhead">
          <p className="jm-secthead">
            <Icon name={icon} size={14} />
            {title}
          </p>
          {action}
        </div>
        {children}
      </div>
    );
  }

  if (variant === 'row') {
    // A row that is set reads its value back; one that is not reads as the
    // invitation. Same as the detail pane, which is the point.
    const isSet = summary && !EMPTY.includes(String(summary).toLowerCase());
    return (
      <>
        <button
          type="button"
          className={`cd-row${open ? ' open' : ''}${isSet ? ' set' : ''}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="cd-rowico"><Icon name={icon} size={15} /></span>
          <span className="cd-rowlabel">{isSet ? summary : title}</span>
        </button>
        {open && <div className="cd-rowpanel">{children}</div>}
      </>
    );
  }

  return (
    <div className={`jm-acc${open ? ' open' : ''}`}>
      <div className="jm-acchead">
        <button
          type="button"
          className="jm-accbtn"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="jm-accico"><Icon name={icon} size={14} /></span>
          <span className="jm-acctitle">{title}</span>
          {!open && summary && <span className="jm-accsum">{summary}</span>}
          <span className="jm-accchev">
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} />
          </span>
        </button>
        {open && action}
      </div>
      {open && <div className="jm-accbody">{children}</div>}
    </div>
  );
};

export default DrawerSection;
