import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../duty-sets.css';
import { groupTemplateTasks } from '../../team-jobs-management/utils/dutyTasks';
import { isoToUK } from '../../../utils/dateFormat';

const DutySetTemplateCard = ({ template, onDuplicate, onDelete, onEdit, lastDoneById = {} }) => {
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
  const grouped = groupTemplateTasks(template?.tasks, lastDoneById);
  const dueCount = grouped?.monthly?.filter(t => t?.due)?.length || 0;

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
        {dueCount > 0 && (
          <span className="dsr-duepill" title="Monthly tasks not done in over three weeks">
            <Icon name="AlertTriangle" size={12} />
            {dueCount} due
          </span>
        )}
      </div>

      {taskCount > 0 && (
        <button onClick={() => setExpanded(!expanded)} className="dsr-card-toggle">
          {expanded ? 'Hide tasks' : 'Show tasks'}
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
      )}

      {expanded && (
        <div className="dsr-tasklist">
          {/* Grouped the same way a job is worked: the daily pile, then each
              weekday's weeklies, then the monthlies with when they were last
              done. A monthly past three weeks is flagged, and stays flagged
              until it gets ticked off again. */}
          {grouped?.daily?.length > 0 && (
            <div className="dsr-taskgroup">
              <p className="dsr-taskgrouphead"><span>Daily</span><span className="n">{grouped?.daily?.length}</span></p>
              {grouped?.daily?.map((task, idx) => (
                <div key={task?.id ?? `d${idx}`} className="dsr-task">
                  <span className="pip" />
                  <div><p className="t">{task?.text || task?.title || task?.name}</p></div>
                </div>
              ))}
            </div>
          )}

          {grouped?.weeklyByDay?.map(bucket => (
            <div key={bucket?.day} className="dsr-taskgroup">
              <p className="dsr-taskgrouphead">
                <span>Weekly — {bucket?.label}</span><span className="n">{bucket?.tasks?.length}</span>
              </p>
              {bucket?.tasks?.map((task, idx) => (
                <div key={task?.id ?? `w${idx}`} className="dsr-task">
                  <span className="pip" />
                  <div><p className="t">{task?.text || task?.title || task?.name}</p></div>
                </div>
              ))}
            </div>
          ))}

          {grouped?.monthly?.length > 0 && (
            <div className="dsr-taskgroup">
              <p className="dsr-taskgrouphead">
                <span>Monthly</span>
                <span className="n">
                  {dueCount > 0 ? `${dueCount} due` : `${grouped?.monthly?.length}`}
                </span>
              </p>
              {grouped?.monthly?.map((task, idx) => (
                <div key={task?.id ?? `m${idx}`} className={`dsr-task${task?.due ? ' due' : ''}`}>
                  <span className="pip" />
                  <div>
                    <p className="t">{task?.text || task?.title || task?.name}</p>
                    <p className="f">
                      {task?.lastDoneAt
                        ? `Last done ${isoToUK(task?.lastDoneAt)}${task?.due ? ` · ${task?.daysSinceDone} days ago` : ''}`
                        : 'Never done'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DutySetTemplateCard;
