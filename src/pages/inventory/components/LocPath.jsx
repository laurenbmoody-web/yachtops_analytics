import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { spaceSegments } from '../utils/vesselPath';
import './locPath.css';

// Shows a vessel-location path as just the end location (the space/room pin's
// leaf), with any intermediate segments collapsed behind a ‹›› toggle. E.g.
// "Main Salon › Port Side Couch › Container 1" shows "Container 1"; tapping the
// chevron reveals "Main Salon › Port Side Couch › Container 1".
const LocPath = ({ label, fallback = '' }) => {
  const [open, setOpen] = useState(false);
  const segs = spaceSegments(label);
  if (!segs.length) return fallback ? <span className="locpath-leaf">{fallback}</span> : null;
  const leaf = segs[segs.length - 1];
  const prefix = segs.slice(0, -1);
  return (
    <span className="locpath">
      {prefix.length > 0 && (
        <button
          type="button"
          className={`locpath-toggle${open ? ' open' : ''}`}
          title={segs.join(' › ')}
          aria-label={open ? 'Hide full path' : 'Show full path'}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          {open ? <span className="locpath-prefix">{prefix.join(' › ')} ›</span> : <Icon name="ChevronRight" size={12} />}
        </button>
      )}
      <span className="locpath-leaf">{leaf}</span>
    </span>
  );
};

export default LocPath;
