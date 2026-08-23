// Sub-locations manager — nest containers (boxes, shelves, drawers…) to any
// depth under a room, since Location management's main gallery only goes
// Deck › Zone › Room. Opened from a room's ⋯ menu; reads the vessel_locations
// tree directly and writes via createSublocation / updateSpace / archiveSpace
// (all id-based, so they work at any level).
import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { createSublocation, updateSpace, archiveSpace } from '../utils/locationsHierarchyStorage';
import './sublocation-manager.css';

export default function SublocationManager({ rootId, rootName, onClose, onChanged }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState([]);        // node ids drilled into, below the root
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase
      ?.from('vessel_locations')
      ?.select('id,name,parent_id,level,sort_order')
      ?.eq('is_archived', false);
    setNodes(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = (pid) => nodes
    .filter((n) => n.parent_id === pid)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));

  const currentId = path.length ? path[path.length - 1] : rootId;
  const rows = childrenOf(currentId);
  const crumb = [{ id: rootId, name: rootName }, ...path.map((id) => ({ id, name: byId[id]?.name || '…' }))];

  const add = async () => {
    const name = adding.trim();
    if (!name || busy) return;
    setBusy(true);
    try { await createSublocation(currentId, name); setAdding(''); await load(); onChanged?.(); }
    catch (err) { console.error('[subloc] add error:', err); window.showToast?.('Could not add — try again', 'error'); }
    finally { setBusy(false); }
  };
  const rename = async (id, value) => {
    const name = String(value || '').trim();
    if (!name || busy) return;
    setBusy(true);
    try { await updateSpace(id, name); setRenaming(null); await load(); onChanged?.(); }
    catch (err) { console.error('[subloc] rename error:', err); }
    finally { setBusy(false); }
  };
  const archive = async (n) => {
    const kids = childrenOf(n.id).length;
    if (kids > 0) { window.alert(`"${n.name}" still has ${kids} sub-location${kids === 1 ? '' : 's'} inside — empty it first.`); return; }
    if (!window.confirm(`Archive "${n.name}"?`)) return;
    setBusy(true);
    try { await archiveSpace(n.id); await load(); onChanged?.(); }
    catch (err) { console.error('[subloc] archive error:', err); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} panelClassName="slm-panel">
      <div className="slm-head">
        <div>
          <div className="slm-eyebrow">Sub-locations</div>
          <h2 className="slm-title">{rootName}</h2>
        </div>
        <button className="slm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      <div className="slm-crumbs">
        {crumb.map((c, i) => (
          <React.Fragment key={c.id}>
            {i > 0 && <span className="slm-sep">›</span>}
            <button
              className={`slm-crumb${i === crumb.length - 1 ? ' cur' : ''}`}
              onClick={() => setPath(path.slice(0, i))}
            >{c.name}</button>
          </React.Fragment>
        ))}
      </div>

      <div className="slm-list">
        {loading ? (
          <p className="slm-empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="slm-empty">Nothing nested here yet — add a box, shelf or drawer below.</p>
        ) : rows.map((n) => {
          const kids = childrenOf(n.id).length;
          return renaming?.id === n.id ? (
            <div key={n.id} className="slm-row editing">
              <input
                autoFocus className="slm-input"
                value={renaming.value}
                onChange={(e) => setRenaming({ id: n.id, value: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') rename(n.id, renaming.value); if (e.key === 'Escape') setRenaming(null); }}
              />
              <button className="slm-mini accent" disabled={busy} onClick={() => rename(n.id, renaming.value)}>Save</button>
              <button className="slm-mini" onClick={() => setRenaming(null)}>Cancel</button>
            </div>
          ) : (
            <div key={n.id} className="slm-row">
              <button className="slm-name" onClick={() => setPath([...path, n.id])} title="Open">
                <Icon name="Box" size={15} />
                <span>{n.name}</span>
                {kids > 0 && <span className="slm-count">{kids}</span>}
                <Icon name="ChevronRight" size={15} className="slm-chev" />
              </button>
              <button className="slm-icon" title="Rename" onClick={() => setRenaming({ id: n.id, value: n.name })}><Icon name="Pencil" size={14} /></button>
              <button className="slm-icon danger" title="Archive" onClick={() => archive(n)}><Icon name="Trash2" size={14} /></button>
            </div>
          );
        })}
      </div>

      <div className="slm-add">
        <input
          className="slm-input"
          placeholder="Add a sub-location — e.g. Shelf 2, Box 7"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button className="slm-btn accent" disabled={busy || !adding.trim()} onClick={add}>
          <Icon name="Plus" size={14} /> Add
        </button>
      </div>
    </ModalShell>
  );
}
