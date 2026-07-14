import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { createFolder, getFolderTree } from '../utils/inventoryStorage';

// The inventory folder tree is keyed by joined path segments. Top-level folders
// ARE the departments (Galley, Interior, …); items live in a sub-folder under a
// department, never in the department folder itself.
const pathKey = (segments) => segments?.join('|||');
const getSubFoldersFromTree = (tree, segments) => tree?.[pathKey(segments)]?.subFolders || [];
const buildFolderPath = (segments) => segments?.join(' > ');

// Editorial palette (Cargo design system).
const INK = '#1C1B3A';
const TERRA = '#C65A1A';
const MUTED = '#6B7280';
const FAINT = '#AEB4C2';
const HAIR = '#F0F1F5';
const FIELD = '#FAFAF8';

// Drill-down picker over the inventory folder tree. onSelect receives
// { path: string[], displayPath: 'Dept > Sub' }. Shared by the inventory add/edit
// modal and the vessel-map "add item" flow so both file items the same way.
const InventoryFolderPicker = ({ tree, onSelect, onClose, onFolderCreated }) => {
  const [pathSegments, setPathSegments] = useState([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [localTree, setLocalTree] = useState(tree);
  const inputRef = useRef(null);

  useEffect(() => { setLocalTree(tree); }, [tree]);

  const currentFolders = getSubFoldersFromTree(localTree, pathSegments);
  const currentPath = buildFolderPath(pathSegments);
  const atRoot = pathSegments.length === 0;
  const hasSubFolders = (folderName) => {
    const childKey = pathKey([...pathSegments, folderName]);
    return (localTree?.[childKey]?.subFolders?.length || 0) > 0;
  };

  const handleDrillDown = (folderName) => {
    setPathSegments((prev) => [...prev, folderName]);
    setCreatingFolder(false); setNewFolderName(''); setCreateError('');
  };
  const handleBack = () => {
    setPathSegments((prev) => prev?.slice(0, -1));
    setCreatingFolder(false); setNewFolderName(''); setCreateError('');
  };
  const handleSelectCurrent = () => {
    if (atRoot) return;
    onSelect({ path: pathSegments, displayPath: buildFolderPath(pathSegments) });
  };
  const handleSelectFolder = (folderName) => {
    const fullPath = [...pathSegments, folderName];
    onSelect({ path: fullPath, displayPath: buildFolderPath(fullPath) });
  };
  const handleCreateFolder = async () => {
    const trimmed = newFolderName?.trim();
    if (!trimmed) { setCreateError('Please enter a folder name'); return; }
    setCreating(true); setCreateError('');
    try {
      const ok = await createFolder(pathSegments, trimmed);
      if (!ok) { setCreateError('Failed to create folder. Please try again.'); setCreating(false); return; }
      const newTree = await getFolderTree();
      setLocalTree(newTree || localTree);
      onFolderCreated?.(newTree || localTree);
      const fullPath = [...pathSegments, trimmed];
      onSelect({ path: fullPath, displayPath: buildFolderPath(fullPath) });
    } catch (err) {
      setCreateError(err?.message || 'Failed to create folder.');
      setCreating(false);
    }
  };

  useEffect(() => { if (creatingFolder) setTimeout(() => inputRef?.current?.focus(), 80); }, [creatingFolder]);

  const iconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 999, background: 'none', border: 0, color: MUTED, cursor: 'pointer' };
  const label = { display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#8B8478' };
  const pillGhost = { fontSize: 12, fontWeight: 600, color: TERRA, background: '#FBEFE9', border: 0, borderRadius: 999, padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' };
  const pillPrimary = { fontSize: 12.5, fontWeight: 600, color: '#fff', background: TERRA, border: 0, borderRadius: 10, padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap' };

  return (
    <ModalShell
      onClose={onClose}
      panelClassName="w-full max-w-sm flex flex-col"
      panelStyle={{ maxHeight: '78vh', background: '#fff', borderRadius: 16, border: '1px solid #ECEAE3', boxShadow: '0 24px 60px -16px rgba(28,27,58,0.32)', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '16px 18px', borderBottom: `1px solid #ECEAE3`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!atRoot && (
            <button onClick={handleBack} style={iconBtn} aria-label="Back"><Icon name="ChevronLeft" size={18} /></button>
          )}
          <h3 style={{ fontSize: 16, fontWeight: 600, color: INK, margin: 0 }}>File in a folder</h3>
        </div>
        <button onClick={onClose} style={iconBtn} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      {/* Breadcrumb + "place the item in this folder" */}
      {!atRoot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: FIELD, borderBottom: `1px solid #ECEAE3`, flexShrink: 0 }}>
          <p style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: MUTED, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Icon name="Folder" size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: '-2px', color: FAINT }} />
            {currentPath}
          </p>
          <button onClick={handleSelectCurrent} style={pillPrimary}>Select this folder</button>
        </div>
      )}

      {/* Section label */}
      <div style={{ padding: '12px 18px 4px', flexShrink: 0 }}>
        <span style={label}>{atRoot ? 'Departments' : 'Sub-folders'}</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 10px' }}>
        {currentFolders?.length === 0 && !creatingFolder && (
          <div style={{ padding: '26px 18px', textAlign: 'center' }}>
            <Icon name="FolderOpen" size={30} style={{ margin: '0 auto 8px', color: '#E5E1D8' }} />
            <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>No sub-folders here yet.</p>
            {!atRoot && (
              <button onClick={handleSelectCurrent} style={{ ...pillPrimary, marginTop: 12 }}>
                Place in “{pathSegments?.[pathSegments?.length - 1]}”
              </button>
            )}
            <p style={{ fontSize: 12, color: FAINT, marginTop: 12 }}>Or create a sub-folder below.</p>
          </div>
        )}

        {currentFolders?.map((folder) => (
          <div key={folder} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: `1px solid ${HAIR}` }}>
            <button
              onClick={() => (hasSubFolders(folder) ? handleDrillDown(folder) : handleSelectFolder(folder))}
              style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '13px 2px', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
            >
              <Icon name="Folder" size={17} style={{ color: '#C9A88F', flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder}</span>
              {hasSubFolders(folder) && <Icon name="ChevronRight" size={14} style={{ color: FAINT, marginLeft: 'auto', flexShrink: 0 }} />}
            </button>
            <button onClick={() => handleSelectFolder(folder)} style={pillGhost}>Select</button>
          </div>
        ))}

        {creatingFolder ? (
          <div style={{ margin: '10px 6px 2px', padding: 12, background: FIELD, borderRadius: 12, border: `1px solid #ECEAE3` }}>
            <p style={{ fontSize: 11.5, color: MUTED, margin: '0 0 8px' }}>
              New folder {atRoot ? 'at top level (department)' : `inside “${pathSegments?.[pathSegments?.length - 1]}”`}
            </p>
            <div style={{ display: 'flex', gap: 7 }}>
              <input
                ref={inputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => { setNewFolderName(e?.target?.value); setCreateError(''); }}
                onKeyDown={(e) => { if (e?.key === 'Enter') handleCreateFolder(); if (e?.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); } }}
                placeholder="Folder name…"
                style={{ flex: 1, fontSize: 13, color: INK, background: '#fff', border: '1px solid #E8E6DF', borderRadius: 8, padding: '8px 10px', outline: 'none' }}
              />
              <button onClick={handleCreateFolder} disabled={creating} style={{ ...pillPrimary, borderRadius: 8, opacity: creating ? 0.5 : 1 }}>{creating ? '…' : 'Create'}</button>
              <button onClick={() => { setCreatingFolder(false); setNewFolderName(''); setCreateError(''); }} style={{ fontSize: 12.5, fontWeight: 500, color: MUTED, background: '#F0F1F5', border: 0, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Cancel</button>
            </div>
            {createError && <p style={{ fontSize: 12, color: '#B91C1C', margin: '6px 0 0' }}>{createError}</p>}
          </div>
        ) : (
          <button
            onClick={() => setCreatingFolder(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 6px 0', width: 'calc(100% - 12px)', fontSize: 13.5, fontWeight: 600, color: TERRA, background: 'none', border: `1px dashed ${TERRA}55`, borderRadius: 12, padding: '11px 12px', cursor: 'pointer' }}
          >
            <Icon name="FolderPlus" size={16} /> Create new {atRoot ? 'department' : 'sub-folder'} here
          </button>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 18px', borderTop: `1px solid #ECEAE3`, flexShrink: 0 }}>
        <button onClick={onClose} style={{ width: '100%', fontSize: 13.5, fontWeight: 500, color: MUTED, background: 'none', border: 0, padding: '8px 0', cursor: 'pointer' }}>Cancel</button>
      </div>
    </ModalShell>
  );
};

export default InventoryFolderPicker;
