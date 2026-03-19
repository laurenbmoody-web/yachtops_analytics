/**
 * HierarchyReviewStep.jsx
 *
 * Step 3.5 (inserted between PerTableReviewStep and BulkPreviewStep):
 * Shows detected hierarchy nodes and lets the user:
 *  - Confirm which labels become folders
 *  - Set the hierarchy level (L1 / L2 / L3)
 *  - Remove false positives
 *  - Add manual folder labels
 *
 * Props:
 *   nodes          HierarchyNode[]   — detected nodes from hierarchyDetector
 *   onChange       (nodes) => void   — called when user edits the list
 *   onNext         () => void
 *   onBack         () => void
 *   tables         table[]           — for context display
 */

import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { getSourceLabel } from '../utils/hierarchyDetector';

// ---------------------------------------------------------------------------
// Level badge colours
// ---------------------------------------------------------------------------
const LEVEL_COLORS = {
  1: 'bg-primary/10 text-primary border-primary/20',
  2: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  3: 'bg-green-500/10 text-green-700 border-green-500/20',
};

const LEVEL_LABELS = {
  1: 'L1 — Top folder',
  2: 'L2 — Sub-folder',
  3: 'L3 — Sub-sub-folder',
};

// ---------------------------------------------------------------------------
// Confidence dot
// ---------------------------------------------------------------------------
function ConfidenceDot({ confidence }) {
  const pct = Math.round((confidence || 0) * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-muted-foreground';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {pct}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tree preview (right panel)
// ---------------------------------------------------------------------------
function TreePreview({ nodes }) {
  // Build a simple nested display from confirmed folder nodes
  const folders = nodes?.filter((n) => n?.isFolder !== false);

  if (folders?.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Icon name="FolderOpen" size={28} className="opacity-30" />
        <p className="text-xs">No folders confirmed yet</p>
      </div>
    );
  }

  // Group by level for tree rendering
  const byLevel = {};
  folders?.forEach((n) => {
    const l = n?.level || 1;
    if (!byLevel?.[l]) byLevel[l] = [];
    byLevel?.[l]?.push(n);
  });

  // Render a simple indented tree
  const renderNodes = (level, parentLabel = null) => {
    const levelNodes = (byLevel?.[level] || [])?.filter((n) =>
      level === 1 ? true : n?.parentLabel === parentLabel
    );
    if (levelNodes?.length === 0) return null;
    return levelNodes?.map((n) => (
      <div key={n?.id} style={{ paddingLeft: `${(level - 1) * 16}px` }} className="py-0.5">
        <div className="flex items-center gap-1.5">
          <Icon name="Folder" size={12} className="text-primary flex-shrink-0" />
          <span className="text-xs text-foreground font-medium truncate">{n?.label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full border ${LEVEL_COLORS?.[level] || LEVEL_COLORS?.[1]}`}>
            L{level}
          </span>
        </div>
        {renderNodes(level + 1, n?.label)}
      </div>
    ));
  };

  return (
    <div className="space-y-0.5 overflow-y-auto max-h-full">
      {renderNodes(1)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function HierarchyReviewStep({ nodes, onChange, onNext, onBack, tables }) {
  const [newLabel, setNewLabel] = useState('');
  const [newLevel, setNewLevel] = useState(1);

  const folderCount = useMemo(() => nodes?.filter((n) => n?.isFolder !== false)?.length, [nodes]);

  const handleToggleFolder = (id) => {
    onChange(nodes?.map((n) => n?.id === id ? { ...n, isFolder: n?.isFolder === false ? true : false } : n));
  };

  const handleLevelChange = (id, level) => {
    onChange(nodes?.map((n) => n?.id === id ? { ...n, level: parseInt(level) } : n));
  };

  const handleRemove = (id) => {
    onChange(nodes?.filter((n) => n?.id !== id));
  };

  const handleAddManual = () => {
    const label = newLabel?.trim();
    if (!label) return;
    const newNode = {
      id: `h-manual-${Date.now()}`,
      label,
      level: newLevel,
      source: 'manual',
      confidence: 1.0,
      isFolder: true,
    };
    onChange([...nodes, newNode]);
    setNewLabel('');
  };

  const hasNodes = nodes?.length > 0;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-xl">
        <Icon name="GitBranch" size={18} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Hierarchy detected from document</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cargo found {nodes?.length} potential folder label{nodes?.length !== 1 ? 's' : ''} in this document.
            Confirm which should become folders and set their level before importing.
          </p>
        </div>
      </div>
      <div className="flex gap-4 min-h-0">
        {/* Left: node list */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Detected Labels</p>
            <span className="text-xs text-muted-foreground">{folderCount} folder{folderCount !== 1 ? 's' : ''} confirmed</span>
          </div>

          {!hasNodes && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground border border-dashed border-border rounded-xl">
              <Icon name="SearchX" size={24} className="opacity-40" />
              <p className="text-xs">No hierarchy detected in this document.</p>
              <p className="text-xs">Add folder labels manually below.</p>
            </div>
          )}

          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {nodes?.map((node) => {
              const isFolder = node?.isFolder !== false;
              const levelColor = LEVEL_COLORS?.[node?.level] || LEVEL_COLORS?.[1];
              return (
                <div
                  key={node?.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                    isFolder
                      ? 'border-border bg-card' :'border-border/40 bg-muted/20 opacity-60'
                  }`}
                >
                  {/* Folder toggle */}
                  <button
                    onClick={() => handleToggleFolder(node?.id)}
                    className={`w-9 h-5 rounded-full flex items-center transition-all flex-shrink-0 ${
                      isFolder ? 'bg-primary justify-end' : 'bg-muted justify-start'
                    }`}
                    title={isFolder ? 'Click to exclude as folder' : 'Click to include as folder'}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-white shadow mx-0.5" />
                  </button>
                  {/* Folder icon */}
                  <Icon
                    name={isFolder ? 'Folder' : 'FileText'}
                    size={14}
                    className={isFolder ? 'text-primary flex-shrink-0' : 'text-muted-foreground flex-shrink-0'}
                  />
                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isFolder ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                      {node?.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {getSourceLabel(node?.source)}
                      {node?.tableId && ` · Table ${(tables || [])?.findIndex((t) => t?.id === node?.tableId) + 1}`}
                      {node?.rowIndex !== undefined && ` · Row ${node?.rowIndex + 1}`}
                    </p>
                  </div>
                  {/* Confidence */}
                  {node?.source !== 'manual' && (
                    <ConfidenceDot confidence={node?.confidence} />
                  )}
                  {/* Level selector */}
                  {isFolder && (
                    <select
                      value={node?.level || 1}
                      onChange={(e) => handleLevelChange(node?.id, e?.target?.value)}
                      className={`text-xs border rounded-lg px-2 py-1 bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 ${levelColor}`}
                    >
                      <option value={1}>L1 — Top folder</option>
                      <option value={2}>L2 — Sub-folder</option>
                      <option value={3}>L3 — Sub-sub-folder</option>
                    </select>
                  )}
                  {/* Remove */}
                  <button
                    onClick={() => handleRemove(node?.id)}
                    className="w-6 h-6 rounded-lg hover:bg-destructive/10 flex items-center justify-center transition-colors flex-shrink-0"
                    title="Remove"
                  >
                    <Icon name="X" size={12} className="text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add manual label */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-medium text-foreground mb-2">Add folder manually</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e?.target?.value)}
                onKeyDown={(e) => e?.key === 'Enter' && handleAddManual()}
                placeholder="e.g. Cat B Standard"
                className="flex-1 text-xs border border-border rounded-lg px-3 py-2 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <select
                value={newLevel}
                onChange={(e) => setNewLevel(parseInt(e?.target?.value))}
                className="text-xs border border-border rounded-lg px-2 py-2 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value={1}>L1</option>
                <option value={2}>L2</option>
                <option value={3}>L3</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddManual}
                disabled={!newLabel?.trim()}
                className="gap-1.5 text-xs"
              >
                <Icon name="Plus" size={12} />
                Add
              </Button>
            </div>
          </div>
        </div>

        {/* Right: tree preview */}
        <div className="w-52 flex-shrink-0 border border-border rounded-xl p-3 bg-muted/20 overflow-hidden">
          <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Icon name="GitBranch" size={12} className="text-primary" />
            Folder Preview
          </p>
          <div className="max-h-[340px] overflow-y-auto">
            <TreePreview nodes={nodes} />
          </div>
        </div>
      </div>
      {/* Bottom nav */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <Icon name="ArrowLeft" size={16} />Back
        </Button>
        <div className="flex items-center gap-3">
          {folderCount === 0 && (
            <span className="text-xs text-muted-foreground">
              No folders confirmed — items will use the base destination folder
            </span>
          )}
          <Button onClick={onNext} className="gap-2">
            Preview Import
            <Icon name="ArrowRight" size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
