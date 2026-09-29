import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { showToast } from '../../../utils/toast';
import './set-location.css';

// Drill-down picker over the vessel_locations tree to set the physical storage
// location (box) of the selected items — with the ability to create a new box
// under the current level on the fly.

const NEXT_LEVEL = { deck: 'zone', zone: 'space', space: 'container', container: 'container' };

export default function SetLocationModal({ tenantId, count, vesselLocations = [], onReloadLocations, onAssign, onClose }) {
  const [browse, setBrowse] = useState([]); // node ids from root
  const [selected, setSelected] = useState(null); // chosen node {id, name}
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => Object.fromEntries(vesselLocations.map((l) => [l.id, l])), [vesselLocations]);
  const childrenOf = (pid) => vesselLocations
    .filter((l) => (l.parent_id || null) === (pid || null))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));
  const parentId = browse.length ? browse[browse.length - 1] : null;
  const rows = childrenOf(parentId);
  const parentLevel = parentId ? byId[parentId]?.level : null;

  const createBox = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const level = NEXT_LEVEL[parentLevel] || 'container';
      const { data, error } = await supabase.from('vessel_locations').insert({
        tenant_id: tenantId, level, name, parent_id: parentId, sort_order: rows.length, is_archived: false,
      }).select('id, name, parent_id, level, sort_order').single();
      if (error) throw error;
      setNewName('');
      await onReloadLocations?.();
      setSelected({ id: data.id, name: data.name });
      showToast(`Created ${name}`, 'success');
    } catch (e) { showToast(e.message || 'Could not create', 'error'); }
    finally { setCreating(false); }
  };

  const assign = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try { await onAssign(selected); } finally { setSaving(false); }
  };

  return createPortal(
    <div className="slm-scrim" onClick={onClose}>
      <div className="slm" onClick={(e) => e.stopPropagation()}>
        <div className="slm-head">
          <div>
            <p className="slm-eyebrow">● Set storage location</p>
            <h3 className="slm-title">{count} item{count === 1 ? '' : 's'}</h3>
          </div>
          <button className="slm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
        </div>

        <div className="slm-crumbs">
          <button className="slm-crumb" onClick={() => setBrowse([])}>All</button>
          {browse.map((id, i) => (
            <React.Fragment key={id}>
              <span>›</span>
              <button className={`slm-crumb${i === browse.length - 1 ? ' muted' : ''}`}
                onClick={() => setBrowse(browse.slice(0, i + 1))}>{byId[id]?.name || '…'}</button>
            </React.Fragment>
          ))}
        </div>

        <div className="slm-list">
          {rows.length === 0 && <p className="slm-empty">No locations here yet — create one below.</p>}
          {rows.map((n) => {
            const kids = childrenOf(n.id).length;
            const on = selected?.id === n.id;
            return (
              <div key={n.id} className={`slm-row${on ? ' on' : ''}`} role="button" tabIndex={0}
                onClick={() => setSelected({ id: n.id, name: n.name })}>
                <span className="slm-radio">{on && <Icon name="Check" size={11} />}</span>
                <span className="slm-name">{n.name}</span>
                {kids > 0 && (
                  <button className="slm-into" onClick={(e) => { e.stopPropagation(); setBrowse([...browse, n.id]); setSelected(null); }} title="Open">
                    <span>{kids}</span><Icon name="ChevronRight" size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="slm-create">
          <Icon name="Plus" size={14} />
          <input
            className="slm-input"
            placeholder={parentId ? `New box in ${byId[parentId]?.name}…` : 'New location…'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createBox(); }}
          />
          <button className="slm-add" onClick={createBox} disabled={!newName.trim() || creating}>{creating ? '…' : 'Add'}</button>
        </div>

        <div className="slm-foot">
          <button className="slm-btn ghost" onClick={onClose}>Cancel</button>
          <button className="slm-btn prim" onClick={assign} disabled={!selected || saving}>
            {saving ? 'Setting…' : selected ? `Store in ${selected.name}` : 'Pick a location'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
