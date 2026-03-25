import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';

/**
 * Wraps a dashboard widget to make it draggable and removable in edit mode.
 * In view mode it renders children directly with no overhead.
 */
const SortableWidget = ({ id, isEditing, onRemove, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  if (!isEditing) {
    return <>{children}</>;
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? 'opacity-40 z-50' : ''}`}
    >
      {/* Highlight border in edit mode */}
      <div className="absolute inset-0 rounded-xl border-2 border-primary/25 pointer-events-none z-10" />

      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-20 cursor-grab active:cursor-grabbing p-1.5 bg-card/90 border border-border rounded-lg shadow-sm hover:bg-muted transition-colors"
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Remove button */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRemove(id)}
        className="absolute top-2 right-2 z-20 p-1.5 bg-card/90 border border-border rounded-lg shadow-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors"
        title="Remove widget"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Widget content — non-interactive while editing */}
      <div className="pointer-events-none select-none opacity-70">
        {children}
      </div>
    </div>
  );
};

export default SortableWidget;
