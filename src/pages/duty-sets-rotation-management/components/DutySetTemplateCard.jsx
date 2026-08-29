import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../duty-sets.css';

const DutySetTemplateCard = ({ template, onDuplicate, onDelete, onEdit }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const menuRef = useRef(null);

  // Close the row menu on an outside click
  useEffect(() => {
    if (!showMenu) return undefined;
    const onDown = (e) => {
      if (menuRef?.current && !menuRef?.current?.contains(e?.target)) setShowMenu(false);
    };
    document?.addEventListener('mousedown', onDown);
    return () => document?.removeEventListener('mousedown', onDown);
  }, [showMenu]);

  const taskCount = template?.taskCount ?? template?.tasks?.length ?? 0;

  return (
    <div className="dsr-card">
      <div className="dsr-card-head">
        <h3 className="dsr-card-title">{template?.name}</h3>
        <div className="dsr-menuwrap" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="dsr-card-menubtn"
            title="Template options"
          >
            <Icon name="MoreHorizontal" size={16} />
          </button>
          {showMenu && (
            <div className="dsr-menu">
              <button
                onClick={() => { onEdit?.(template); setShowMenu(false); }}
                className="dsr-menuitem"
              >
                <Icon name="Pencil" size={14} />Edit
              </button>
              <button
                onClick={() => { onDuplicate(template?.id); setShowMenu(false); }}
                className="dsr-menuitem"
              >
                <Icon name="Copy" size={14} />Duplicate
              </button>
              <button
                onClick={() => { onDelete(template?.id); setShowMenu(false); }}
                className="dsr-menuitem danger"
              >
                <Icon name="Trash2" size={14} />Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="dsr-card-meta">
        <span>
          <Icon name="ListChecks" size={13} />
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </span>
        <span>
          <Icon name="Clock" size={13} />
          {template?.estimatedDuration} min
        </span>
      </div>

      {taskCount > 0 && (
        <button onClick={() => setExpanded(!expanded)} className="dsr-card-toggle">
          {expanded ? 'Hide tasks' : 'Show tasks'}
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
      )}

      {expanded && (
        <div className="dsr-tasklist">
          {template?.tasks?.map((task, idx) => (
            <div key={task?.id ?? idx} className="dsr-task">
              <span className="pip" />
              <div>
                <p className="t">{task?.text || task?.title || task?.name}</p>
                {task?.frequency && (
                  <p className="f">{String(task?.frequency)?.replace('-', ' — ')}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DutySetTemplateCard;
