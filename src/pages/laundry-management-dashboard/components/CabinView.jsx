import React, { useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { LaundryStatus, LaundryPriority, formatLaundryTag } from '../utils/laundryStorage';

const STAT = {
  [LaundryStatus?.IN_PROGRESS]: { cls: 'prog', label: 'In prog' },
  [LaundryStatus?.READY_TO_DELIVER]: { cls: 'ready', label: 'Ready' },
  [LaundryStatus?.DELIVERED]: { cls: 'deliv', label: 'Delivered' },
};
const statusRank = (s) => (s === LaundryStatus?.IN_PROGRESS ? 0 : s === LaundryStatus?.READY_TO_DELIVER ? 1 : 2);
const ownerKind = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown'; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

// Group the day's items by cabin (a guest/crew berth) with a "Found & unclaimed"
// bucket for unknown owners. Each group becomes a card.
function buildGroups(items) {
  const map = new Map();
  for (const it of items || []) {
    const kind = ownerKind(it?.ownerType);
    const key = kind === 'unknown'
      ? 'Found & unclaimed'
      : (it?.area?.trim() || it?.ownerName?.trim() || 'Unassigned');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  const groups = [];
  for (const [key, list] of map) {
    const found = list.every((i) => ownerKind(i?.ownerType) === 'unknown');
    const owners = [...new Set(list.map((i) => i?.ownerName).filter((n) => n && n !== 'Unknown'))];
    const total = list.length;
    const delivered = list.filter((i) => i?.status === LaundryStatus?.DELIVERED).length;
    const ready = list.filter((i) => i?.status === LaundryStatus?.READY_TO_DELIVER).length;
    const urgent = list.filter((i) => i?.priority === LaundryPriority?.URGENT && i?.status !== LaundryStatus?.DELIVERED).length;
    const kind = ownerKind(list[0]?.ownerType);
    list.sort((a, b) => statusRank(a?.status) - statusRank(b?.status));
    groups.push({ key, found, owners, kind, list, total, delivered, ready, urgent });
  }
  // Attention first (urgent, then still-open), fully-returned cabins last, found bucket last of all.
  groups.sort((a, b) => {
    if (a.found !== b.found) return a.found ? 1 : -1;
    if (!!b.urgent !== !!a.urgent) return b.urgent - a.urgent;
    const aOpen = a.total - a.delivered; const bOpen = b.total - b.delivered;
    if ((bOpen > 0) !== (aOpen > 0)) return (bOpen > 0) - (aOpen > 0);
    return a.key.localeCompare(b.key);
  });
  return groups;
}

const CabinCard = ({ g, onBulkDeliver, onOpen }) => {
  const pct = g.total ? Math.round((g.delivered / g.total) * 100) : 0;
  const allDone = g.delivered === g.total;
  return (
    <div className={`lc-card${g.urgent ? ' urg' : ''}`}>
      <div className="lc-head">
        <div className="lc-ring" style={{ '--p': pct, '--rc': allDone ? '#2F7D5A' : '#2F6E8F' }}>
          <span>{g.delivered}/{g.total}</span>
        </div>
        <div className="lc-id">
          <div className="lc-name">{g.key}</div>
          <div className="lc-occ">
            <span className={`lr-av ${g.kind}`}>{g.found ? '?' : initials(g.owners[0] || '')}</span>
            {g.found ? 'No owner assigned' : (g.owners.join(', ') || '—')}
          </div>
        </div>
        {g.urgent > 0
          ? <span className="lc-badge urg">{g.urgent} urgent</span>
          : <span className="lc-badge">{g.total} item{g.total === 1 ? '' : 's'}</span>}
      </div>

      <div className="lc-items">
        {g.list.map((it) => {
          const st = STAT[it?.status] || STAT[LaundryStatus?.READY_TO_DELIVER];
          const photos = Array.isArray(it?.photos) && it.photos.length ? it.photos : (it?.photo ? [it.photo] : []);
          const urgent = it?.priority === LaundryPriority?.URGENT && it?.status !== LaundryStatus?.DELIVERED;
          const bits = [];
          if (urgent) bits.push(<span key="u" className="u">Urgent</span>);
          (it?.tags || []).slice(0, 2).forEach((t, i) => bits.push(<span key={`t${i}`}>{formatLaundryTag(t)}</span>));
          if (it?.laundryNumber) bits.push(<span key="n">No. {it.laundryNumber}</span>);
          return (
            <div className="lc-ci" key={it?.id} role="button" tabIndex={0} style={{ cursor: onOpen ? 'pointer' : undefined }}
              onClick={() => onOpen?.(it)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(it); } }}>
              <span className="lc-ph">
                {photos[0] ? <img src={photos[0]} alt="" /> : <Icon name="Shirt" size={17} className="lr-ph-ic" />}
              </span>
              <div className="lc-ci-main">
                <div className="lc-ci-desc">{it?.description || 'No description'}</div>
                <div className="lc-ci-meta">{bits.reduce((acc, el, i) => (i ? [...acc, <span key={`s${i}`} style={{ color: '#AEB4C2' }}>·</span>, el] : [el]), [])}</div>
              </div>
              <span className={`lc-stat ${st.cls}`}>{st.label}</span>
            </div>
          );
        })}
      </div>

      <div className="lc-foot">
        <span className="lc-sum">
          {allDone
            ? <>All returned <b>✓</b></>
            : <><b>{g.total}</b> item{g.total === 1 ? '' : 's'}{g.ready > 0 && <> · <b>{g.ready}</b> ready</>}</>}
        </span>
        {g.ready > 0 && (
          <button type="button" className="lc-act" onClick={(e) => { e.stopPropagation(); onBulkDeliver(g.list.filter((i) => i?.status === LaundryStatus?.READY_TO_DELIVER)); }}>
            Deliver ready <Icon name="ArrowRight" size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

const CabinView = ({ items, onBulkDeliver, onOpen }) => {
  const groups = useMemo(() => buildGroups(items), [items]);
  return (
    <div className="lc-cards">
      {groups.map((g) => <CabinCard key={g.key} g={g} onBulkDeliver={onBulkDeliver} onOpen={onOpen} />)}
    </div>
  );
};

export default CabinView;
