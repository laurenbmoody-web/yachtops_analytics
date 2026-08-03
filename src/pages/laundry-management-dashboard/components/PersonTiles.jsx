import React from 'react';
import Icon from '../../../components/AppIcon';
import './personTiles.css';

const initials = (name) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Reusable "pick a person" grid — a tile per person (avatar/initials, name,
// subtitle, optional count). Shared by the wardrobe Crew / Owner / Guest worlds
// so all three read the same: folder → person tiles → that person's wardrobe.
const PersonTiles = ({ people = [], emptyLabel = 'No one here yet.', onPick }) => {
  if (!people.length) return <div className="pt-empty">{emptyLabel}</div>;
  return (
    <div className="pt-grid">
      {people.map((p) => (
        <button type="button" key={p.id} className="pt-tile" onClick={() => onPick?.(p.id)}>
          <span className="pt-avatar">{p.photo ? <img src={p.photo} alt="" /> : <span>{initials(p.name)}</span>}</span>
          <span className="pt-name">{p.name}</span>
          {p.subtitle && <span className="pt-sub">{p.subtitle}</span>}
          {p.thumbs && p.thumbs.length > 0 && (
            <span className="pt-thumbs">
              {p.thumbs.slice(0, 5).map((t, i) => (
                <span className="pt-thumb" key={i}>{t ? <img src={t} alt="" loading="lazy" /> : <Icon name="Shirt" size={12} />}</span>
              ))}
            </span>
          )}
          {(p.count != null || p.value || p.away > 0 || p.wash > 0) && (
            <span className="pt-foot">
              {p.count != null && <span className="pt-count">{p.count}<small>{p.countLabel || 'items'}</small></span>}
              {(p.value || p.away > 0 || p.wash > 0) && (
                <span className="pt-foot-r">
                  {p.value && <span className="pt-value">{p.value}</span>}
                  {p.away > 0 && <span className="pt-mv away" title="Away in a case"><Icon name="Package" size={11} />{p.away}</span>}
                  {p.wash > 0 && <span className="pt-mv wash" title="At the laundry"><Icon name="Waves" size={11} />{p.wash}</span>}
                </span>
              )}
            </span>
          )}
          <span className="pt-go" aria-hidden="true"><Icon name="ArrowRight" size={15} /></span>
        </button>
      ))}
    </div>
  );
};

export default PersonTiles;
