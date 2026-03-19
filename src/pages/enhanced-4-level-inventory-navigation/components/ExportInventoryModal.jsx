import React, { useState, useMemo, useCallback } from 'react';
import Icon from '../../../components/AppIcon';

// ─── Build a nested tree structure from the flat folderTree map ───────────────
function buildNestedTree(folderTree, allItems) {
  // Build item count map: fullPath -> count
  // item.subLocation from DB uses '>' separator; normalise to '›' to match folder tree keys
  const itemCountMap = {};
  (allItems || [])?.forEach(item => {
    const normSub = item?.subLocation
      ? item?.subLocation?.split('>')?.map(s => s?.trim())?.join(' › ')
      : '';
    const parts = [item?.location, normSub]?.filter(Boolean);
    const key = parts?.length > 0 ? parts?.join(' › ') : 'Uncategorised';
    itemCountMap[key] = (itemCountMap?.[key] || 0) + 1;
  });

  // Recursively build node
  const buildNode = (segments) => {
    const key = segments?.join('|||');
    const node = folderTree?.[key];
    const children = node?.subFolders || [];
    const name = segments?.[segments?.length - 1] || '';
    const fullPath = segments?.join(' › ');

    const childNodes = children?.map(childName => buildNode([...segments, childName]));

    // Count items in this folder and all descendants
    const countSelf = itemCountMap?.[fullPath] || 0;
    const countDescendants = childNodes?.reduce((sum, c) => sum + c?.totalCount, 0);

    return {
      key: fullPath || '__root__',
      name,
      fullPath,
      segments,
      selfCount: countSelf,
      totalCount: countSelf + countDescendants,
      children: childNodes,
    };
  };

  const rootKey = '';
  const rootChildren = folderTree?.[rootKey]?.subFolders || [];

  // If folderTree is empty, fall back to building from allItems
  if (rootChildren?.length === 0 && (allItems || [])?.length > 0) {
    const folderMap = {};
    (allItems || [])?.forEach(item => {
      const parts = [item?.location, item?.subLocation]?.filter(Boolean);
      if (parts?.length === 0) return;
      // Build each level
      for (let i = 1; i <= parts?.length; i++) {
        const seg = parts?.slice(0, i);
        const fp = seg?.join(' › ');
        if (!folderMap?.[fp]) {
          folderMap[fp] = { segments: seg, name: seg?.[seg?.length - 1], fullPath: fp, children: [] };
        }
      }
    });
    // Build parent-child relationships
    const roots = [];
    Object.values(folderMap)?.forEach(node => {
      if (node?.segments?.length === 1) {
        roots?.push(node);
      } else {
        const parentPath = node?.segments?.slice(0, -1)?.join(' › ');
        if (folderMap?.[parentPath]) {
          if (!folderMap?.[parentPath]?.children?.find(c => c?.fullPath === node?.fullPath)) {
            folderMap?.[parentPath]?.children?.push(node);
          }
        }
      }
    });
    // Attach counts
    const attachCounts = (node) => {
      node.selfCount = itemCountMap?.[node?.fullPath] || 0;
      node?.children?.forEach(attachCounts);
      node.totalCount = node?.selfCount + node?.children?.reduce((s, c) => s + c?.totalCount, 0);
      node.key = node?.fullPath;
      return node;
    };
    return roots?.map(attachCounts);
  }

  return rootChildren?.map(childName => buildNode([childName]));
}

// ─── Collect all descendant keys (including self) ─────────────────────────────
function collectAllKeys(node) {
  const keys = [node?.key];
  node?.children?.forEach(c => keys?.push(...collectAllKeys(c)));
  return keys;
}

// ─── Collect all leaf items for selected keys ─────────────────────────────────
function collectItemsForKeys(keys, allItems) {
  const keySet = new Set(keys);
  return (allItems || [])?.filter(item => {
    // item.subLocation comes from DB as 'Guest > Alcohol > Wine' (uses '>'),
    // but folder tree keys are built with '›' separator.
    // Normalise subLocation to use '›' so the fingerprint matches.
    const normSub = item?.subLocation
      ? item?.subLocation?.split('>')?.map(s => s?.trim())?.join(' › ')
      : '';
    const parts = [item?.location, normSub]?.filter(Boolean);
    const fp = parts?.length > 0 ? parts?.join(' › ') : 'Uncategorised';
    return keySet?.has(fp);
  });
}

// ─── Determine checkbox state: checked / indeterminate / unchecked ────────────
function getCheckState(node, selectedKeys) {
  const allKeys = collectAllKeys(node);
  const checkedCount = allKeys?.filter(k => selectedKeys?.has(k))?.length;
  if (checkedCount === 0) return 'unchecked';
  if (checkedCount === allKeys?.length) return 'checked';
  return 'indeterminate';
}

// ─── Tree Node Component ──────────────────────────────────────────────────────
const FolderTreeNode = ({ node, selectedKeys, expandedKeys, onToggleSelect, onToggleExpand, depth = 0 }) => {
  const hasChildren = node?.children?.length > 0;
  const isExpanded = expandedKeys?.has(node?.key);
  const checkState = getCheckState(node, selectedKeys);

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer border-b border-border/50 last:border-b-0 ${
          checkState !== 'unchecked' ? 'bg-primary/5' : 'bg-background hover:bg-muted/40'
        }`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        {/* Expand/Collapse arrow */}
        <button
          onClick={(e) => { e?.stopPropagation(); if (hasChildren) onToggleExpand(node?.key); }}
          className={`w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors ${
            hasChildren ? 'text-muted-foreground hover:text-foreground' : 'text-transparent cursor-default'
          }`}
        >
          {hasChildren && (
            <Icon
              name="ChevronRight"
              size={14}
              className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
        </button>

        {/* Checkbox */}
        <button
          onClick={() => onToggleSelect(node)}
          className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            checkState === 'checked' ?'bg-primary border-primary'
              : checkState === 'indeterminate' ?'bg-primary/40 border-primary' :'border-border bg-background hover:border-primary/60'
          }`}
        >
          {checkState === 'checked' && <Icon name="Check" size={9} className="text-primary-foreground" />}
          {checkState === 'indeterminate' && <span className="w-2 h-0.5 bg-primary-foreground rounded-full" />}
        </button>

        {/* Folder icon + name */}
        <button
          onClick={() => onToggleSelect(node)}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          <Icon
            name={hasChildren && isExpanded ? 'FolderOpen' : 'Folder'}
            size={14}
            className={checkState !== 'unchecked' ? 'text-primary' : 'text-muted-foreground'}
          />
          <span className={`text-sm font-medium truncate ${checkState !== 'unchecked' ? 'text-primary' : 'text-foreground'}`}>
            {node?.name}
          </span>
        </button>

        {/* Item count */}
        <span className={`text-xs flex-shrink-0 font-medium ml-1 ${node?.totalCount === 0 ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
          {node?.totalCount}
        </span>
      </div>
      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node?.children?.map(child => (
            <FolderTreeNode
              key={child?.key}
              node={child}
              selectedKeys={selectedKeys}
              expandedKeys={expandedKeys}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Modal ───────────────────────────────────────────────────────────────
const ExportInventoryModal = ({
  onClose,
  onExport,
  selectedCount = 0,
  currentFolderPath = '',
  isRoot = false,
  isExporting = false,
  allItems = [],
  preSelectedItemIds = new Set(),
  folderTree = {},
}) => {
  const [scope, setScope] = useState(
    selectedCount > 0 ? 'selected' : isRoot ? 'entire' : 'folder'
  );
  const [format, setFormat] = useState('pdf');
  const [includeImages, setIncludeImages] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [expandedKeys, setExpandedKeys] = useState(new Set());
  const [folderSearch, setFolderSearch] = useState('');

  // Build nested tree
  const nestedTree = useMemo(() => buildNestedTree(folderTree, allItems), [folderTree, allItems]);

  // Filter tree nodes by search (flat list of matching nodes)
  const filteredTree = useMemo(() => {
    if (!folderSearch?.trim()) return nestedTree;
    const q = folderSearch?.toLowerCase();
    const filterNodes = (nodes) => {
      return nodes?.reduce((acc, node) => {
        const matches = node?.name?.toLowerCase()?.includes(q) || node?.fullPath?.toLowerCase()?.includes(q);
        const filteredChildren = filterNodes(node?.children);
        if (matches || filteredChildren?.length > 0) {
          acc?.push({ ...node, children: filteredChildren });
        }
        return acc;
      }, []);
    };
    return filterNodes(nestedTree);
  }, [nestedTree, folderSearch]);

  // Toggle expand
  const handleToggleExpand = useCallback((key) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next?.has(key)) next?.delete(key);
      else next?.add(key);
      return next;
    });
  }, []);

  // Toggle select — cascade to all descendants
  const handleToggleSelect = useCallback((node) => {
    const allKeys = collectAllKeys(node);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const checkState = getCheckState(node, prev);
      if (checkState === 'checked') {
        // Uncheck all
        allKeys?.forEach(k => next?.delete(k));
      } else {
        // Check all
        allKeys?.forEach(k => next?.add(k));
      }
      return next;
    });
  }, []);

  // Select All / Deselect All
  const allTreeKeys = useMemo(() => {
    const keys = [];
    const collect = (nodes) => nodes?.forEach(n => { keys?.push(n?.key); collect(n?.children); });
    collect(nestedTree);
    return keys;
  }, [nestedTree]);

  const toggleAllFolders = () => {
    if (selectedKeys?.size === allTreeKeys?.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allTreeKeys));
    }
  };

  // Items that will be exported
  const selectedFolderItems = useMemo(() => {
    if (scope !== 'selected') return [];
    if (selectedKeys?.size === 0) {
      return (allItems || [])?.filter(i => preSelectedItemIds?.has(i?.id));
    }
    return collectItemsForKeys([...selectedKeys], allItems);
  }, [scope, selectedKeys, allItems, preSelectedItemIds]);

  const selectedItemCount = scope === 'selected'
    ? (selectedKeys?.size > 0 ? selectedFolderItems?.length : selectedCount)
    : 0;

  const handleExport = () => {
    // Build flat folder meta list for PDF exporter
    const flatFolderMeta = [];
    const flatten = (nodes) => nodes?.forEach(n => {
      flatFolderMeta?.push({ key: n?.key, label: n?.name, fullPath: n?.fullPath, items: collectItemsForKeys([n?.key], allItems) });
      flatten(n?.children);
    });
    flatten(nestedTree);

    const selectedFoldersMeta = scope === 'selected' && selectedKeys?.size > 0
      ? flatFolderMeta?.filter(f => selectedKeys?.has(f?.key))
      : null;

    onExport({
      scope,
      format,
      includeImages,
      selectedFolderItems: scope === 'selected' ? selectedFolderItems : undefined,
      selectedFoldersMeta,
      allFoldersMeta: flatFolderMeta,
    });
  };

  const scopeOptions = [
    {
      value: 'entire',
      label: 'Entire Inventory',
      description: 'All items across all folders you have access to',
      icon: 'Database',
    },
    {
      value: 'folder',
      label: isRoot ? 'Root Level' : 'Current Folder',
      description: isRoot
        ? 'Items visible at the root level'
        : `Items in: ${currentFolderPath || 'current folder'}`,
      icon: 'Folder',
      disabled: false,
    },
    {
      value: 'selected',
      label: 'Selected Items',
      description: 'Choose one or more folders to export',
      icon: 'CheckSquare',
      disabled: false,
    },
  ];

  const formatOptions = [
    {
      value: 'pdf',
      label: 'PDF',
      description: 'Clean, printable — yacht-professional layout',
      icon: 'FileText',
    },
    {
      value: 'xlsx',
      label: 'Spreadsheet (.xlsx)',
      description: 'Compatible with Excel & Apple Numbers',
      icon: 'Table',
    },
  ];

  const totalFolderCount = allTreeKeys?.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="Download" size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Export Inventory</h2>
              <p className="text-xs text-muted-foreground">Choose scope, format and options</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          {/* Scope */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">
              Export Scope
            </p>
            <div className="space-y-2">
              {scopeOptions?.map(opt => (
                <button
                  key={opt?.value}
                  onClick={() => !opt?.disabled && setScope(opt?.value)}
                  disabled={opt?.disabled}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    opt?.disabled
                      ? 'opacity-40 cursor-not-allowed border-border bg-muted/30'
                      : scope === opt?.value
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-background hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    scope === opt?.value && !opt?.disabled ? 'bg-primary/15' : 'bg-muted'
                  }`}>
                    <Icon
                      name={opt?.icon}
                      size={16}
                      className={scope === opt?.value && !opt?.disabled ? 'text-primary' : 'text-muted-foreground'}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${scope === opt?.value && !opt?.disabled ? 'text-primary' : 'text-foreground'}`}>
                      {opt?.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{opt?.description}</p>
                  </div>
                  {scope === opt?.value && !opt?.disabled && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Icon name="Check" size={12} className="text-primary-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Folder tree — shown when scope === 'selected' */}
          {scope === 'selected' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Select Folders
                </p>
                <div className="flex items-center gap-2">
                  {selectedKeys?.size > 0 && (
                    <span className="text-xs text-primary font-medium">
                      {selectedItemCount} item{selectedItemCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  <button
                    onClick={toggleAllFolders}
                    className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                  >
                    {selectedKeys?.size === totalFolderCount && totalFolderCount > 0 ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>

              {/* Search */}
              {totalFolderCount > 6 && (
                <div className="relative mb-2">
                  <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search folders…"
                    value={folderSearch}
                    onChange={e => setFolderSearch(e?.target?.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              )}

              {/* Collapsible folder tree */}
              <div className="border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                {filteredTree?.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {nestedTree?.length === 0
                      ? 'No folders found — inventory may still be loading' :'No folders match your search'}
                  </div>
                ) : (
                  filteredTree?.map(node => (
                    <FolderTreeNode
                      key={node?.key}
                      node={node}
                      selectedKeys={selectedKeys}
                      expandedKeys={expandedKeys}
                      onToggleSelect={handleToggleSelect}
                      onToggleExpand={handleToggleExpand}
                      depth={0}
                    />
                  ))
                )}
              </div>

              {selectedKeys?.size === 0 && selectedCount > 0 && (
                <p className="text-xs text-muted-foreground mt-2 px-1">
                  No folders selected — will export {selectedCount} checkbox-selected item{selectedCount !== 1 ? 's' : ''} instead
                </p>
              )}
              {selectedKeys?.size === 0 && selectedCount === 0 && (
                <p className="text-xs text-amber-600 mt-2 px-1">
                  Select at least one folder to export
                </p>
              )}
            </div>
          )}

          {/* Format */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">
              Export Format
            </p>
            <div className="grid grid-cols-2 gap-2">
              {formatOptions?.map(opt => (
                <button
                  key={opt?.value}
                  onClick={() => setFormat(opt?.value)}
                  className={`flex flex-col items-center gap-2 px-3 py-3.5 rounded-xl border text-center transition-all ${
                    format === opt?.value
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-background hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    format === opt?.value ? 'bg-primary/15' : 'bg-muted'
                  }`}>
                    <Icon
                      name={opt?.icon}
                      size={18}
                      className={format === opt?.value ? 'text-primary' : 'text-muted-foreground'}
                    />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${format === opt?.value ? 'text-primary' : 'text-foreground'}`}>
                      {opt?.label}
                    </p>
                    <p className="text-xs text-muted-foreground leading-tight mt-0.5">{opt?.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Include Images toggle */}
          <div className="flex items-center justify-between px-4 py-3 bg-muted/40 rounded-xl border border-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <Icon name="Image" size={16} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Include Images</p>
                <p className="text-xs text-muted-foreground">
                  {format === 'pdf' ? 'Thumbnails next to items' : 'Image URL column in spreadsheet'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIncludeImages(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                includeImages ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  includeImages ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || (scope === 'selected' && selectedKeys?.size === 0 && selectedCount === 0)}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <Icon name="Loader2" size={15} className="animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Icon name="Download" size={15} />
                Export{scope === 'selected' && selectedItemCount > 0 ? ` (${selectedItemCount})` : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportInventoryModal;
