import React from 'react';
import { Plus, RotateCcw, Check } from 'lucide-react';

/**
 * Fixed bottom bar shown during dashboard edit mode.
 * Displays hidden-but-accessible widgets so users can add them back,
 * plus Reset and Done controls.
 */
const DashboardEditBar = ({ hiddenWidgets, onAdd, onReset, onDone }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-2xl">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
          Add widgets
        </span>

        <div className="flex items-center gap-2 flex-1 overflow-x-auto pb-0.5">
          {hiddenWidgets.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              All available widgets are visible
            </span>
          ) : (
            hiddenWidgets.map((widget) => (
              <button
                key={widget.id}
                onClick={() => onAdd(widget.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-primary hover:text-primary-foreground rounded-lg text-sm font-medium transition-colors shrink-0 border border-border"
              >
                <Plus className="w-3.5 h-3.5" />
                {widget.title}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            title="Reset to default layout"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={onDone}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardEditBar;
