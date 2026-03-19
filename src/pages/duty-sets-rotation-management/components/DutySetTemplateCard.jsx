import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';


const DutySetTemplateCard = ({ template, onDuplicate, onDelete, onEdit }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const getBoardColor = (boardId) => {
    const colors = {
      interior: '#3B82F6',
      turnaround: '#10B981',
      'guest-prep': '#F59E0B',
      deck: '#06B6D4'
    };
    return colors?.[boardId] || '#64748B';
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-smooth">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: getBoardColor(template?.board) }}
            />
            <h3 className="text-base font-semibold text-foreground">{template?.name}</h3>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 hover:bg-muted rounded transition-smooth"
            >
              <Icon name="MoreVertical" size={16} className="text-muted-foreground" />
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-1 w-40 bg-card border border-border rounded-lg shadow-lg py-1 z-10">
                <button
                  onClick={() => {
                    onEdit?.(template);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-2"
                >
                  <Icon name="Pencil" size={14} />
                  Edit
                </button>
                <button
                  onClick={() => {
                    onDuplicate(template?.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-2"
                >
                  <Icon name="Copy" size={14} />
                  Duplicate
                </button>
                <button
                  onClick={() => {
                    onDelete(template?.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-error hover:bg-muted transition-smooth flex items-center gap-2"
                >
                  <Icon name="Trash2" size={14} />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          <div className="flex items-center gap-1">
            <Icon name="ListChecks" size={14} />
            <span>{template?.taskCount} tasks</span>
          </div>
          <div className="flex items-center gap-1">
            <Icon name="Clock" size={14} />
            <span>{template?.estimatedDuration} min</span>
          </div>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          {expanded ? 'Hide' : 'Show'} tasks
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} />
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            {template?.tasks?.map((task, idx) => (
              <div key={task?.id ?? idx} className="flex items-start gap-2 text-sm">
                <Icon name="Circle" size={12} className="text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-foreground">{task?.text || task?.title || task?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {task?.frequency?.replace('-', ' — ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DutySetTemplateCard;