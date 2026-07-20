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
          {p.count != null && (
            <span className="pt-count">{p.count}<small>{p.countLabel || 'items'}</small></span>
          )}
          <span className="pt-go" aria-hidden="true"><Icon name="ArrowRight" size={15} /></span>
        </button>
      ))}
    </div>
  );
};

export default PersonTiles;
