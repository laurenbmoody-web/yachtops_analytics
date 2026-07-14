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
  const hasSubFolders = (folderName) => {
    const childKey = pathKey([...pathSegments, folderName]);
    return (localTree?.[childKey]?.subFolders?.length || 0) > 0;
  };

  const handleDrillDown = (folderName) => {
    setPathSegments((prev) => [...prev, folderName]);
    setCreatingFolder(false);
    setNewFolderName('');
    setCreateError('');
  };

  const handleBack = () => {
    setPathSegments((prev) => prev?.slice(0, -1));
    setCreatingFolder(false);
    setNewFolderName('');
    setCreateError('');
  };

  const handleSelectCurrent = () => {
    if (pathSegments?.length === 0) return;
    onSelect({ path: pathSegments, displayPath: buildFolderPath(pathSegments) });
  };

  const handleSelectFolder = (folderName) => {
    const fullPath = [...pathSegments, folderName];
    onSelect({ path: fullPath, displayPath: buildFolderPath(fullPath) });
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName?.trim();
    if (!trimmed) { setCreateError('Please enter a folder name'); return; }
    setCreating(true);
    setCreateError('');
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

  useEffect(() => {
    if (creatingFolder) setTimeout(() => inputRef?.current?.focus(), 80);
  }, [creatingFolder]);

  return (
    <ModalShell onClose={onClose} panelClassName="bg-card rounded-2xl shadow-2xl w-full max-w-md flex flex-col" panelStyle={{ maxHeight: '80vh' }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          {pathSegments?.length > 0 && (
            <button onClick={handleBack} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
              <Icon name="ChevronLeft" size={18} />
            </button>
          )}
          <h3 className="text-base font-semibold text-foreground">Select Inventory Folder</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
          <Icon name="X" size={18} />
        </button>
      </div>

      {pathSegments?.length > 0 && (
        <div className="px-5 py-2.5 bg-muted/40 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground font-medium truncate flex-1">
              <span className="text-foreground/60">📁</span>{' '}{currentPath}
            </p>
            <button
              onClick={handleSelectCurrent}
              className="shrink-0 px-3 py-1 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors"
            >
              Select this folder
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {currentFolders?.length === 0 && !creatingFolder && (
          <div className="px-5 py-8 text-center">
            <Icon name="FolderOpen" size={32} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No sub-folders here yet.</p>
            {pathSegments?.length > 0 && (
              <button
                onClick={handleSelectCurrent}
                className="mt-3 px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary rounded-xl hover:bg-primary/90 transition-colors"
              >
                Select "{pathSegments?.[pathSegments?.length - 1]}"
              </button>
            )}
            <p className="text-xs text-muted-foreground mt-3">Or create a sub-folder below.</p>
          </div>
        )}

        {currentFolders?.map((folder) => (
          <div key={folder} className="flex items-center px-3 mx-2 rounded-xl hover:bg-muted/60 transition-colors">
            <button
              onClick={() => handleDrillDown(folder)}
              className="flex-1 flex items-center gap-3 py-3.5 text-left"
            >
              <Icon name="Folder" size={18} className="text-primary/70 shrink-0" />
              <span className="text-sm font-medium text-foreground">{folder}</span>
              {hasSubFolders(folder) && (
                <Icon name="ChevronRight" size={14} className="text-muted-foreground ml-auto shrink-0" />
              )}
            </button>
            <button
              onClick={() => handleSelectFolder(folder)}
              className="ml-2 shrink-0 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
            >
              Select
            </button>
          </div>
        ))}

        {creatingFolder ? (
          <div className="mx-3 mt-2 p-3 bg-muted/40 rounded-xl border border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              New folder {pathSegments?.length > 0 ? `inside "${pathSegments?.[pathSegments?.length - 1]}"` : 'at root'}
            </p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => { setNewFolderName(e?.target?.value); setCreateError(''); }}
                onKeyDown={(e) => { if (e?.key === 'Enter') handleCreateFolder(); if (e?.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); } }}
                placeholder="Folder name..."
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button onClick={handleCreateFolder} disabled={creating} className="px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {creating ? '...' : 'Create'}
              </button>
              <button onClick={() => { setCreatingFolder(false); setNewFolderName(''); setCreateError(''); }} className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted rounded-lg hover:bg-muted/80 transition-colors">
                Cancel
              </button>
            </div>
            {createError && <p className="text-xs text-red-500 mt-1.5">{createError}</p>}
          </div>
        ) : (
          <button
            onClick={() => setCreatingFolder(true)}
            className="flex items-center gap-2 mx-3 mt-2 px-3 py-2.5 w-[calc(100%-1.5rem)] text-sm font-medium text-primary border border-dashed border-primary/40 rounded-xl hover:bg-primary/5 transition-colors"
          >
            <Icon name="FolderPlus" size={16} />
            + Create new folder here
          </button>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border shrink-0">
        <button onClick={onClose} className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </ModalShell>
  );
};

export default InventoryFolderPicker;
