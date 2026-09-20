import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';

/**
 * One collapsed row that opens in place — the To Do move, applied to a form.
 *
 * The edit drawer had seven sections stacked end to end, so finding Recurrence
 * meant scrolling past every checklist item. Collapsed, the whole job fits in
 * one view and each row reads back its own state, so you can see what is set
 * without opening anything.
 *
 * `summary` is what the row says while shut. Make it the value, not a count of
 * fields: "Tomorrow, Interior, high" tells you something; "5 fields" does not.
 */
const DrawerSection = ({
  icon,
  title,
  summary,
  action,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

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
        {/* Section-level actions (Add checklist) stay reachable, but only
            while the section is open — a button for a section you cannot see
            is just noise. */}
        {open && action}
      </div>
      {open && <div className="jm-accbody">{children}</div>}
    </div>
  );
};

export default DrawerSection;
