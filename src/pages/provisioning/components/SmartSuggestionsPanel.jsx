import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { SOURCE_META } from '../../../utils/provisioningSuggestions';

const SmartSuggestionsPanel = ({ suggestions, onAdd, onAddAll, loading }) => {
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [expandedSources, setExpandedSources] = useState(new Set(['guest_preference', 'low_stock', 'location_aware']));

  const allItems = Object.values(suggestions || {}).flat();

  const toggle = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSource = (source) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      next.has(source) ? next.delete(source) : next.add(source);
      return next;
    });
  };

  const selectedItems = allItems.filter(i => checkedIds.has(i.id));

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Generating smart suggestions…</span>
      </div>
    );
  }

  if (!allItems.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-center">
        <Icon name="Lightbulb" className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No suggestions found. Add items manually below.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon name="Lightbulb" className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-foreground">Smart Suggestions</h3>
          <span className="text-xs text-muted-foreground">({allItems.length} items)</span>
        </div>
        <div className="flex items-center gap-2">
          {checkedIds.size > 0 && (
            <button
              onClick={() => { onAdd(selectedItems); setCheckedIds(new Set()); }}
              className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              Add selected ({checkedIds.size})
            </button>
          )}
          <button
            onClick={() => { onAddAll(allItems); setCheckedIds(new Set()); }}
            className="px-3 py-1.5 bg-muted text-foreground text-xs font-medium rounded-lg hover:bg-muted/80 border border-border transition-colors"
          >
            Add all
          </button>
        </div>
      </div>

      <div className="divide-y divide-border">
        {Object.entries(suggestions || {}).map(([source, items]) => {
          if (!items?.length) return null;
          const meta = SOURCE_META[source] || { label: source, icon: 'List', color: 'text-muted-foreground' };
          const isExpanded = expandedSources.has(source);

          return (
            <div key={source}>
              <button
                onClick={() => toggleSource(source)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <Icon name={meta.icon} className={`w-4 h-4 ${meta.color}`} />
                  <span className="text-sm font-medium text-foreground">{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                </div>
                <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} className="w-4 h-4 text-muted-foreground" />
              </button>

              {isExpanded && (
                <div className="divide-y divide-border/50">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 px-5 py-3 hover:bg-muted/30 transition-colors ${item.is_allergen_note ? 'bg-red-50/30 dark:bg-red-950/20' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(item.id)}
                        onChange={() => toggle(item.id)}
                        className="mt-0.5 rounded border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${item.is_allergen_note ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                            {item.name}
                          </span>
                          {item.priority === 'high' && (
                            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400 rounded">High priority</span>
                          )}
                          {item.department && (
                            <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded">{item.department}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.reason}</p>
                      </div>
                      {!item.is_allergen_note && (
                        <button
                          onClick={() => { onAdd([item]); }}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SmartSuggestionsPanel;
