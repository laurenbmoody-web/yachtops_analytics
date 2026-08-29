import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import Icon from '../../../components/AppIcon';
import DateInput from '../../../components/ui/DateInput';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { TIER_RANK, normalizeTier, canAssignTo } from '../utils/tierPermissions';
import SearchableAssigneeDropdown from './SearchableAssigneeDropdown';
import '../job-modals.css';
import '../../duty-sets-rotation-management/duty-sets.css';

/**
 * Determine if the current user can FULLY edit this job.
 */
const canFullEdit = (currentUserTier, currentUserId, job) => {
  const myTier = normalizeTier(currentUserTier);
  const myRank = TIER_RANK?.[myTier] ?? 1;
  if (job?.created_by === currentUserId || job?.createdBy === currentUserId) return true;
  const creatorTier = normalizeTier(job?.createdByTier || job?.creator_tier);
  const creatorRank = TIER_RANK?.[creatorTier] ?? 1;
  return myRank >= creatorRank;
};

export const canViewMetadata = (tier) => {
  const t = normalizeTier(tier);
  return t === 'COMMAND' || t === 'CHIEF';
};

const buildMetaEntry = (userId, userName, userTier, field, oldValue, newValue) => ({
  timestamp: new Date()?.toISOString(),
  user_id: userId,
  user_name: userName || userId,
  user_tier: normalizeTier(userTier),
  field,
  old_value: oldValue ?? null,
  new_value: newValue ?? null,
});

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];
const STATUS_OPTIONS = ['pending', 'active', 'completed'];

const JobEditModal = ({
  job,
  currentUser,
  currentUserTier,
  activeTenantId,
  onClose,
  onSaved,
  // Acceptance mode props
  acceptanceMode = false,
  boards = [],
  departments = [],
  onAccepted,
}) => {
  const userId = currentUser?.id;
  const userName = currentUser?.name || currentUser?.full_name || currentUser?.email || userId;
  const myTier = normalizeTier(currentUserTier);
  const isFullEdit = acceptanceMode ? true : canFullEdit(myTier, userId, job);

  // ── User's own department id (for filtering boards + assignees) ──
  const userDeptId = currentUser?.department_id || currentUser?.tenantMember?.department_id || null;
  // Look up department name from departments list, fallback to currentUser fields
  const userDeptName = useMemo(() => {
    if (departments?.length > 0 && userDeptId) {
      const found = departments?.find(d => d?.id === userDeptId);
      if (found?.name) return found?.name;
    }
    return currentUser?.departmentName || currentUser?.tenantMember?.department?.name || 'Your Department';
  }, [departments, userDeptId, currentUser]);

  // ── Full edit form state (pre-populated from job) ──
  const [title, setTitle] = useState(job?.title || '');
  const [description, setDescription] = useState(job?.description || '');
  const [priority, setPriority] = useState(job?.priority || 'medium');
  const [status, setStatus] = useState(job?.status || 'pending');
  const [dueDate, setDueDate] = useState(
    job?.due_date
      ? job?.due_date?.split('T')?.[0]
      : job?.dueDate
        ? (typeof job?.dueDate === 'string' ? job?.dueDate?.split('T')?.[0] : format(new Date(job.dueDate), 'yyyy-MM-dd'))
        : format(new Date(), 'yyyy-MM-dd')
  );
  const [dueTime, setDueTime] = useState('09:00');
  const [assignees, setAssignees] = useState(
    Array.isArray(job?.assignees) ? job?.assignees
      : (job?.assigned_to ? [job?.assigned_to] : [])
  );
  const [checklists, setChecklists] = useState(
    Array.isArray(job?.checklists) ? job?.checklists : []
  );
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [activeChecklistIndex, setActiveChecklistIndex] = useState(null);
  const [recurrence, setRecurrence] = useState(job?.recurrenceConfig?.type || 'none');
  const [recurrenceWeekDays, setRecurrenceWeekDays] = useState(job?.recurrenceConfig?.weekDays || []);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState(job?.recurrenceConfig?.monthDay || 1);
  const [dutySetName, setDutySetName] = useState(job?.dutySetName || job?.duty_set_name || '');
  const [attachments, setAttachments] = useState(Array.isArray(job?.attachments) ? job?.attachments : []);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Board selection ──
  const [selectedBoardId, setSelectedBoardId] = useState(
    job?.board_id || job?.board || job?.boardId || ''
  );

  // ── Supabase departments ──
  const [supabaseDepts, setSupabaseDepts] = useState(departments || []);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const canSelectDept = myTier === 'COMMAND' || myTier === 'CHIEF' || myTier === 'HOD';
  // Selected department for this job (defaults to job's current dept)
  const [selectedDeptId, setSelectedDeptId] = useState(
    job?.department_id || job?.department || userDeptId || null
  );

  // ── Assignees from Supabase ──
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [loadingAssignees, setLoadingAssignees] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const existingMeta = Array.isArray(job?.metadata) ? job?.metadata : [];
  const showMeta = canViewMetadata(myTier);

  // ── Filter boards to selected department ──
  const filteredBoards = useMemo(() => {
    if (!selectedDeptId) return boards;
    const filtered = boards?.filter(b => b?.department_id === selectedDeptId);
    return filtered?.length > 0 ? filtered : boards;
  }, [boards, selectedDeptId]);

  // ── Fetch departments if not passed ──
  useEffect(() => {
    if (departments?.length > 0) {
      setSupabaseDepts(departments);
      return;
    }
    if (!activeTenantId || !canSelectDept) return;
    setLoadingDepts(true);
    const fetchDepts = async () => {
      try {
        const { data: memberDepts } = await supabase
          ?.from('tenant_members')
          ?.select('department_id')
          ?.eq('tenant_id', activeTenantId)
          ?.not('department_id', 'is', null);
        const deptIds = [...new Set((memberDepts || [])?.map(m => m?.department_id)?.filter(Boolean))];
        if (deptIds?.length > 0) {
          const { data: deptRows } = await supabase
            ?.from('departments')
            ?.select('id, name')
            ?.in('id', deptIds)
            ?.order('name', { ascending: true });
          setSupabaseDepts(deptRows || []);
        }
      } catch (err) {
        console.warn('[JobEditModal] fetchDepts error:', err);
      } finally {
        setLoadingDepts(false);
      }
    };
    fetchDepts();
  }, [activeTenantId, canSelectDept, departments]);

  // ── Helper: get department name ──
  const getDeptName = (deptId) => {
    if (!deptId) return '';
    const dept = supabaseDepts?.find(d => d?.id === deptId);
    return dept?.name || deptId;
  };

  // ── Fetch assignees ──
  const fetchAssignees = useCallback(async () => {
    if (!activeTenantId) return;
    setLoadingAssignees(true);
    try {
      const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(val);
      let deptFilter = null;
      if (myTier === 'COMMAND') {
        if (selectedDeptId && isValidUUID(selectedDeptId)) deptFilter = selectedDeptId;
      } else {
        const ownDept = userDeptId;
        if (ownDept && isValidUUID(ownDept)) deptFilter = ownDept;
      }

      const { data: tmData, error: tmError } = await supabase?.rpc(
        'get_tenant_members_for_jobs',
        { p_tenant_id: activeTenantId, p_department_id: deptFilter ?? null }
      );

      if (tmError || !tmData?.length) {
        setAssigneeOptions([]);
        return;
      }

      const userIds = tmData?.map(tm => tm?.user_id)?.filter(Boolean);
      const { data: profilesData } = await supabase
        ?.from('profiles')?.select('id, full_name, first_name, last_name')?.in('id', userIds);

      const profilesMap = {};
      (profilesData || [])?.forEach(p => { profilesMap[p.id] = p; });

      const members = tmData?.map(tm => {
        const p = profilesMap?.[tm?.user_id];
        const displayName =
          p?.full_name ||
          [p?.first_name, p?.last_name]?.filter(Boolean)?.join(' ') ||
          tm?.user_id;
        return {
          id: tm?.user_id,
          user_id: tm?.user_id,
          department_id: tm?.department_id,
          permission_tier: tm?.permission_tier,
          display_name: displayName,
          name: displayName,
        };
      });

      const filtered = members?.filter(m => canAssignTo(m?.permission_tier, myTier));
      setAssigneeOptions(filtered);
    } catch (err) {
      console.error('[JobEditModal] fetchAssignees error:', err);
      setAssigneeOptions([]);
    } finally {
      setLoadingAssignees(false);
    }
  }, [activeTenantId, userDeptId, myTier, selectedDeptId]);

  useEffect(() => {
    if (!acceptanceMode) fetchAssignees();
  }, [acceptanceMode, fetchAssignees]);

  // ── Checklist helpers ──
  const handleAddChecklistItem = (checklistIndex) => {
    if (!newChecklistItem?.trim()) return;
    setChecklists(prev => {
      const updated = [...prev];
      updated?.[checklistIndex]?.items?.push({
        id: crypto.randomUUID(),
        text: newChecklistItem?.trim(),
        completed: false,
      });
      return updated;
    });
    setNewChecklistItem('');
  };

  const handleRemoveChecklistItem = (checklistIndex, itemId) => {
    setChecklists(prev => {
      const updated = [...prev];
      updated[checklistIndex].items = updated?.[checklistIndex]?.items?.filter(i => i?.id !== itemId);
      return updated;
    });
  };

  const handleMoveChecklistItem = (checklistIndex, itemIndex, direction) => {
    setChecklists(prev => {
      const updated = [...prev];
      const items = [...updated?.[checklistIndex]?.items];
      const newIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
      if (newIndex < 0 || newIndex >= items?.length) return prev;
      [items[itemIndex], items[newIndex]] = [items?.[newIndex], items?.[itemIndex]];
      updated[checklistIndex].items = items;
      return updated;
    });
  };

  const handleRemoveChecklist = (checklistIndex) => {
    setChecklists(prev => prev?.filter((_, idx) => idx !== checklistIndex));
    if (activeChecklistIndex === checklistIndex) setActiveChecklistIndex(null);
  };

  const toggleWeekDay = (day) => {
    setRecurrenceWeekDays(prev =>
      prev?.includes(day) ? prev?.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e?.target?.files || []);
    if (!files?.length) return;
    setUploadingFile(true);
    files?.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          name: file?.name,
          url: event?.target?.result,
          type: file?.type,
          size: file?.size,
        }]);
        setUploadingFile(false);
      };
      reader?.readAsDataURL(file);
    });
  };

  const handleRemoveAttachment = (id) => {
    setAttachments(prev => prev?.filter(a => a?.id !== id));
  };

  const formatMeta = (ts) => {
    try { return format(new Date(ts), 'MMM dd, yyyy HH:mm'); } catch { return ts; }
  };

  // ── Save full edit ──
  const handleSave = async () => {
    if (!title?.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const metaEntries = [];
      const fields = [
        { key: 'title', oldVal: job?.title, newVal: title },
        { key: 'description', oldVal: job?.description, newVal: description },
        { key: 'priority', oldVal: job?.priority, newVal: priority },
        { key: 'status', oldVal: job?.status, newVal: status },
        { key: 'due_date', oldVal: job?.due_date || job?.dueDate, newVal: dueDate },
        { key: 'assigned_to', oldVal: job?.assigned_to, newVal: assignees?.[0] || null },
        { key: 'department_id', oldVal: job?.department_id || job?.department, newVal: selectedDeptId },
      ];
      fields?.forEach(({ key, oldVal, newVal }) => {
        if ((oldVal ?? '') !== (newVal ?? '')) {
          metaEntries?.push(buildMetaEntry(userId, userName, myTier, key, oldVal, newVal));
        }
      });
      const updatedMeta = [...existingMeta, ...metaEntries];

      const flatChecklist = checklists?.flatMap(cl =>
        cl?.items?.map(item => ({ ...item, checklistName: cl?.name }))
      ) || [];

      const supabaseId = job?.supabase_id || (job?.id?.includes('-') && !job?.id?.startsWith('card-') ? job?.id : null);

      if (supabaseId && activeTenantId) {
        const { error: updateError } = await supabase?.from('team_jobs')?.update({
          title: title?.trim(),
          description: description?.trim() || null,
          priority,
          status,
          due_date: dueDate || null,
          assigned_to: assignees?.[0] || null,
          department_id: selectedDeptId || null,
          board_id: selectedBoardId || null,
          checklist: flatChecklist,
          duty_set_name: dutySetName || null,
          recurrence_config: recurrence !== 'none' ? {
            type: recurrence,
            week_days: recurrenceWeekDays,
            month_day: recurrenceMonthDay,
          } : null,
          attachments: attachments,
          metadata: updatedMeta,
          updated_at: new Date()?.toISOString(),
        })?.eq('id', supabaseId)?.eq('tenant_id', activeTenantId);
        if (updateError) throw new Error(updateError.message);
      }

      // Add comment if provided
      if (newComment?.trim() && supabaseId && activeTenantId) {
        await supabase?.from('job_notes')?.insert({
          tenant_id: activeTenantId,
          job_id: supabaseId,
          note: newComment?.trim(),
          created_by: userId,
        });
      }

      onSaved({
        ...job,
        title,
        description,
        priority,
        status,
        due_date: dueDate,
        dueDate,
        assigned_to: assignees?.[0] || null,
        assignees,
        department_id: selectedDeptId,
        department: selectedDeptId,
        board: selectedBoardId || job?.board,
        boardId: selectedBoardId || job?.boardId,
        board_id: selectedBoardId || job?.board_id,
        checklist: flatChecklist,
        checklists,
        dutySetName,
        duty_set_name: dutySetName,
        recurrenceConfig: recurrence !== 'none' ? { type: recurrence, weekDays: recurrenceWeekDays, monthDay: recurrenceMonthDay } : null,
        attachments,
        metadata: updatedMeta,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // ── Add Comment ──
  const handleAddComment = async () => {
    if (!newComment?.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const commentEntry = buildMetaEntry(userId, userName, myTier, 'comment', null, newComment?.trim());
      const updatedMeta = [...existingMeta, commentEntry];
      const supabaseId = job?.supabase_id || (job?.id?.includes('-') && !job?.id?.startsWith('card-') ? job?.id : null);
      if (supabaseId && activeTenantId) {
        await supabase?.from('job_notes')?.insert({
          tenant_id: activeTenantId,
          job_id: supabaseId,
          note: newComment?.trim(),
          created_by: userId,
        });
        await supabase?.from('team_jobs')?.update({ metadata: updatedMeta, updated_at: new Date()?.toISOString() })?.eq('id', supabaseId)?.eq('tenant_id', activeTenantId);
      }
      onSaved({ ...job, metadata: updatedMeta });
      setNewComment('');
    } catch (err) {
      setError(err?.message || 'Failed to add comment');
    } finally {
      setSaving(false);
    }
  };

  // ── Accept Job (acceptance mode) ──
  const handleAcceptJob = async () => {
    setSaving(true);
    setError(null);
    try {
      const metaEntry = buildMetaEntry(userId, userName, myTier, 'status', job?.status, 'active');
      const acceptEntry = buildMetaEntry(userId, userName, myTier, 'accepted_by', null, userName);
      const updatedMeta = [...existingMeta, metaEntry, acceptEntry];

      const supabaseId = job?.supabase_id || (job?.id?.includes('-') && !job?.id?.startsWith('card-') ? job?.id : null);

      const flatChecklist = checklists?.flatMap(cl =>
        cl?.items?.map(item => ({ ...item, checklistName: cl?.name }))
      ) || [];

      const updatePayload = {
        status: 'active',
        board_id: selectedBoardId || null,
        due_date: dueDate || null,
        title,
        description,
        priority,
        assigned_to: assignees?.[0] || null,
        assignees: assignees,
        checklist: flatChecklist,
        duty_set_name: dutySetName || null,
        recurrence_config: recurrence !== 'none' ? {
          type: recurrence,
          week_days: recurrenceWeekDays,
          month_day: recurrenceMonthDay,
        } : null,
        attachments: attachments,
        metadata: updatedMeta,
        updated_at: new Date()?.toISOString(),
        pending_for_department: null,
      };

      if (supabaseId && activeTenantId) {
        const { error: updateError } = await supabase?.from('team_jobs')?.update(updatePayload)?.eq('id', supabaseId)?.eq('tenant_id', activeTenantId);
        if (updateError) throw new Error(updateError.message);
      }

      if (newComment?.trim() && supabaseId && activeTenantId) {
        await supabase?.from('job_notes')?.insert({
          tenant_id: activeTenantId,
          job_id: supabaseId,
          note: newComment?.trim(),
          created_by: userId,
        });
      }

      const acceptedJob = {
        ...job,
        title, description, priority,
        status: 'active',
        board: selectedBoardId || job?.board,
        boardId: selectedBoardId || job?.boardId,
        dueDate,
        assignees,
        assigned_to: assignees?.[0] || null,
        checklist: flatChecklist,
        checklists,
        dutySetName,
        recurrenceConfig: recurrence !== 'none' ? { type: recurrence, weekDays: recurrenceWeekDays, monthDay: recurrenceMonthDay } : null,
        attachments,
        pendingForDepartment: null,
        metadata: updatedMeta,
      };

      if (onAccepted) {
        onAccepted(acceptedJob);
      } else if (onSaved) {
        onSaved(acceptedJob);
      }
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to accept job');
    } finally {
      setSaving(false);
    }
  };

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // ── Department options ──
  const supabaseDeptOptions = useMemo(() => [
    { value: '', label: 'Select department' },
    ...supabaseDepts?.map(d => ({ value: d?.id, label: d?.name }))
  ], [supabaseDepts]);

  // ── Assignee show logic ──
  const canShowAssignee = myTier === 'COMMAND' || myTier === 'CHIEF' || myTier === 'HOD';

  // ─────────────────────────────────────────────────────────────────────────
  // ACCEPTANCE MODE — full ComprehensiveJobModal-style layout
  // ─────────────────────────────────────────────────────────────────────────
  if (acceptanceMode) {
    return (
      <ModalShell onClose={onClose} isBusy={saving} panelClassName="jm-panel xl">
        <div className="jm-head">
          <div>
            <p className="jm-eyebrow">Jobs</p>
            <h2 className="jm-title">Accept job</h2>
            <p className="jm-sub">Review and configure this job before it lands in your department.</p>
          </div>
          <button onClick={onClose} className="jm-x" title="Close">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="jm-body">
          {error && (
            <div className="jm-section">
              <div className="jm-notice danger">
                <Icon name="AlertCircle" size={15} />
                <span>{error}</span>
              </div>
            </div>
          )}

          <p className="jm-secthead">
            <Icon name="FileText" size={14} />
            Core information
          </p>

          <div className="jm-section">
            <label className="jm-label" htmlFor="jam-title">
              Job title<span className="req">required</span>
            </label>
            <input
              id="jam-title"
              autoFocus
              type="text"
              className="jm-titlefield"
              placeholder="What needs doing?"
              value={title}
              onChange={(e) => setTitle(e?.target?.value)}
            />
          </div>

          <div className="jm-section">
            <label className="jm-label" htmlFor="jam-desc">
              Description &amp; notes<span className="opt">optional</span>
            </label>
            <textarea
              id="jam-desc"
              className="jm-textarea"
              rows={4}
              placeholder="Any detail the crew will need"
              value={description}
              onChange={(e) => setDescription(e?.target?.value)}
            />
          </div>

          <div className="jm-section">
            <label className="jm-label" htmlFor="jam-board">
              Board<span className="req">required</span>
            </label>
            <select
              id="jam-board"
              className="jm-select"
              value={selectedBoardId || ''}
              onChange={(e) => setSelectedBoardId(e?.target?.value)}
            >
              <option value="">— No board —</option>
              {filteredBoards?.map(b => {
                const displayName = (userDeptId && b?.names?.[userDeptId]) ? b?.names?.[userDeptId] : (b?.name || 'Board');
                return <option key={b?.id} value={b?.id}>{displayName}</option>;
              })}
            </select>
          </div>

          <div className="jm-section">
            <label className="jm-label">
              Assign to
              {userDeptName && <span className="opt">{userDeptName}</span>}
            </label>
            {loadingAssignees ? (
              <div className="jm-readonly muted">Loading team members…</div>
            ) : assigneeOptions?.length === 0 ? (
              <div className="jm-readonly muted">No eligible crew in this department</div>
            ) : (
              <SearchableAssigneeDropdown
                crewMembers={assigneeOptions}
                selectedAssignees={assignees}
                onChange={(newAssignees) => setAssignees(newAssignees)}
                department={userDeptId}
              />
            )}
          </div>

          <div className="jm-section jm-grid">
            <div>
              <label className="jm-label" htmlFor="jam-due">
                Due date<span className="req">required</span>
              </label>
              <DateInput id="jam-due" value={dueDate} onChange={(e) => setDueDate(e?.target?.value)} className="jm-input" />
            </div>
            <div>
              <label className="jm-label" htmlFor="jam-time">
                Time<span className="opt">optional</span>
              </label>
              <input
                id="jam-time"
                type="time"
                className="jm-input"
                value={dueTime}
                onChange={(e) => setDueTime(e?.target?.value)}
              />
            </div>
          </div>

          <div className="jm-section">
            <p className="jm-label">
              Priority<span className="req">required</span>
            </p>
            <div className="jm-pills">
              {PRIORITY_OPTIONS?.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`jm-pill${priority === p ? ' on' : ''}`}
                >
                  {p?.charAt(0)?.toUpperCase() + p?.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <hr className="jm-rule" />

          {/* Checklists */}
          <div className="jm-secthead-row">
            <p className="jm-secthead">
              <Icon name="CheckSquare" size={14} />
              Checklists
            </p>
            <button
              type="button"
              className="jm-btn ghost sm"
              onClick={() => {
                const name = prompt('Checklist name:');
                if (name?.trim()) {
                  setChecklists(prev => [...prev, { id: crypto.randomUUID(), name: name?.trim(), items: [] }]);
                  setActiveChecklistIndex(checklists?.length);
                }
              }}
            >
              <Icon name="Plus" size={14} />
              Add checklist
            </button>
          </div>

          {checklists?.map((checklist, checklistIndex) => (
            <div key={checklist?.id} className="jm-subcard">
              <div className="jm-subcard-head">
                <h4>{checklist?.name}</h4>
                <button
                  type="button"
                  onClick={() => handleRemoveChecklist(checklistIndex)}
                  className="jm-file-x"
                  title="Remove checklist"
                >
                  <Icon name="Trash2" size={14} />
                </button>
              </div>
              {checklist?.items?.length > 0 && (
                <div className="jm-checkitems">
                  {checklist?.items?.map((item, itemIndex) => (
                    <div key={item?.id} className="jm-checkitem">
                      <span className="box" />
                      <span className="t">{item?.text}</span>
                      <button
                        type="button"
                        onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'up')}
                        disabled={itemIndex === 0}
                        title="Move up"
                      >
                        <Icon name="ChevronUp" size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'down')}
                        disabled={itemIndex === checklist?.items?.length - 1}
                        title="Move down"
                      >
                        <Icon name="ChevronDown" size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveChecklistItem(checklistIndex, item?.id)}
                        className="danger"
                        title="Remove item"
                      >
                        <Icon name="X" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="dsr-inlineadd">
                <input
                  type="text"
                  className="jm-input"
                  placeholder="Add checklist item"
                  value={activeChecklistIndex === checklistIndex ? newChecklistItem : ''}
                  onChange={(e) => { setNewChecklistItem(e?.target?.value); setActiveChecklistIndex(checklistIndex); }}
                  onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddChecklistItem(checklistIndex); } }}
                />
                <button
                  type="button"
                  className="jm-btn accent sm"
                  onClick={() => handleAddChecklistItem(checklistIndex)}
                  disabled={!newChecklistItem?.trim() || activeChecklistIndex !== checklistIndex}
                >
                  Add
                </button>
              </div>
            </div>
          ))}

          <hr className="jm-rule" />

          {/* Attachments */}
          <p className="jm-secthead">
            <Icon name="Paperclip" size={14} />
            Attachments
          </p>
          <div className="jm-section">
            <input
              type="file"
              id="accept-file-upload"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <label htmlFor="accept-file-upload" className="jm-drop">
              <span className="jm-drop-ico">
                {uploadingFile ? <span className="jm-spin sm" /> : <Icon name="Upload" size={18} />}
              </span>
              <span className="jm-drop-t">{uploadingFile ? 'Uploading…' : 'Click to upload files'}</span>
              <span className="jm-drop-s">Images, PDFs or documents</span>
            </label>
            {attachments?.length > 0 && (
              <div className="jm-filelist">
                {attachments?.map(attachment => (
                  <div key={attachment?.id} className="jm-file">
                    {attachment?.type?.startsWith('image/') ? (
                      <img src={attachment?.url} alt={attachment?.name} className="jm-file-thumb" />
                    ) : (
                      <Icon name="File" size={14} />
                    )}
                    <span className="name">{attachment?.name}</span>
                    <span className="size">{(attachment?.size / 1024)?.toFixed(1)} KB</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(attachment?.id)}
                      className="jm-file-x"
                      title="Remove attachment"
                    >
                      <Icon name="X" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="jm-rule" />

          {/* Comment */}
          <p className="jm-secthead">
            <Icon name="MessageSquare" size={14} />
            Initial comment
          </p>
          <div className="jm-section">
            <textarea
              className="jm-textarea"
              rows={3}
              placeholder="Add an opening comment or handover note"
              value={newComment}
              onChange={(e) => setNewComment(e?.target?.value)}
            />
          </div>

          {/* Change history */}
          {showMeta && existingMeta?.length > 0 && (
            <>
              <hr className="jm-rule" />
              <div className="jm-secthead-row">
                <p className="jm-secthead">
                  <Icon name="History" size={14} />
                  Change history
                </p>
                <span className="jm-tag accent">Command &amp; chief</span>
              </div>
              <div className="ar-history" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {[...existingMeta]?.reverse()?.map((entry, idx) => (
                  <div key={idx} className="ar-hist">
                    <div className="ar-hist-top">
                      <span className="who">{entry?.user_name}</span>
                      <span className="when">{formatMeta(entry?.timestamp)}</span>
                    </div>
                    <p className="what">
                      {entry?.field === 'comment' ? (
                        <>commented: <em>{entry?.new_value}</em></>
                      ) : (
                        <>
                          Changed <strong>{entry?.field}</strong>
                          {entry?.old_value != null && <> from “{String(entry?.old_value)}”</>}
                          {entry?.new_value != null && <> to “{String(entry?.new_value)}”</>}
                        </>
                      )}
                    </p>
                    {entry?.user_tier && <span className="tier">{entry?.user_tier}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="jm-foot">
          <button type="button" className="jm-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <div className="spacer" />
          <button className="jm-btn success" onClick={handleAcceptJob} disabled={saving || !title?.trim()}>
            {saving ? <span className="jm-spin sm" /> : <Icon name="Check" size={15} />}
            {saving ? 'Accepting…' : 'Accept job'}
          </button>
        </div>
      </ModalShell>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FULL EDIT MODE — ComprehensiveJobModal-style layout
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ModalShell
      onClose={onClose}
      isBusy={saving}
      panelClassName="jm-panel xl"
    >
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Jobs</p>
          <h2 className="jm-title">Edit job</h2>
          <p className="jm-sub">Update the details and save your changes.</p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <div className="jm-body">
        {error && (
          <div className="jm-section">
            <div className="jm-notice danger">
              <Icon name="AlertCircle" size={15} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* ── Core ── */}
        <p className="jm-secthead">
          <Icon name="FileText" size={14} />
          Core information
        </p>

        <div className="jm-section">
          <label className="jm-label" htmlFor="jem-title">
            Job title<span className="req">required</span>
          </label>
          <input
            id="jem-title"
            autoFocus
            type="text"
            className="jm-titlefield"
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e?.target?.value)}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="jem-desc">
            Description &amp; notes<span className="opt">optional</span>
          </label>
          <textarea
            id="jem-desc"
            className="jm-textarea"
            rows={4}
            placeholder="Any detail the crew will need"
            value={description}
            onChange={(e) => setDescription(e?.target?.value)}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="jem-dept">
            Department<span className="req">required</span>
          </label>
          {canSelectDept ? (
            loadingDepts ? (
              <div className="jm-readonly muted">Loading departments…</div>
            ) : (
              <select
                id="jem-dept"
                className="jm-select"
                value={selectedDeptId || ''}
                onChange={(e) => { setSelectedDeptId(e?.target?.value); setAssignees([]); setSelectedBoardId(''); }}
              >
                <option value="">Select department…</option>
                {supabaseDeptOptions?.map(o => (
                  <option key={o?.value} value={o?.value}>{o?.label}</option>
                ))}
              </select>
            )
          ) : (
            <div className="jm-readonly">
              <span>{getDeptName(selectedDeptId) || 'Your department'}</span>
              <span className="note">locked to your department</span>
            </div>
          )}
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="jem-board">Board</label>
          <select
            id="jem-board"
            className="jm-select"
            value={selectedBoardId || ''}
            onChange={(e) => setSelectedBoardId(e?.target?.value)}
          >
            <option value="">— No board —</option>
            {filteredBoards?.map(b => {
              const displayName = (selectedDeptId && b?.names?.[selectedDeptId])
                ? b?.names?.[selectedDeptId]
                : (b?.name || 'Board');
              return <option key={b?.id} value={b?.id}>{displayName}</option>;
            })}
          </select>
        </div>

        {canShowAssignee && (
          <div className="jm-section">
            <label className="jm-label">
              Assign to
              {selectedDeptId && <span className="opt">{getDeptName(selectedDeptId)}</span>}
            </label>
            {loadingAssignees ? (
              <div className="jm-readonly muted">Loading team members…</div>
            ) : assigneeOptions?.length === 0 ? (
              <div className="jm-readonly muted">No eligible crew in this department</div>
            ) : (
              <SearchableAssigneeDropdown
                crewMembers={assigneeOptions}
                selectedAssignees={assignees}
                onChange={(newAssignees) => setAssignees(newAssignees)}
                department={selectedDeptId}
              />
            )}
          </div>
        )}

        <div className="jm-section jm-grid">
          <div>
            <label className="jm-label" htmlFor="jem-due">Due date</label>
            <input
              id="jem-due"
              type="date"
              className="jm-input"
              value={dueDate}
              onChange={(e) => setDueDate(e?.target?.value)}
            />
          </div>
          <div>
            <label className="jm-label" htmlFor="jem-time">
              Time<span className="opt">optional</span>
            </label>
            <input
              id="jem-time"
              type="time"
              className="jm-input"
              value={dueTime}
              onChange={(e) => setDueTime(e?.target?.value)}
            />
          </div>
        </div>

        <div className="jm-section">
          <p className="jm-label">
            Priority<span className="req">required</span>
          </p>
          <div className="jm-pills">
            {PRIORITY_OPTIONS?.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`jm-pill${priority === p ? ' on' : ''}`}
              >
                {p?.charAt(0)?.toUpperCase() + p?.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="jm-section">
          <p className="jm-label">Status</p>
          <div className="jm-pills">
            {STATUS_OPTIONS?.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`jm-pill${status === s ? ' on' : ''}`}
              >
                {s?.charAt(0)?.toUpperCase() + s?.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <hr className="jm-rule" />

        {/* ── Checklists ── */}
        <div className="jm-secthead-row">
          <p className="jm-secthead">
            <Icon name="CheckSquare" size={14} />
            Checklists
          </p>
          <button
            type="button"
            className="jm-btn ghost sm"
            onClick={() => {
              const name = prompt('Checklist name:');
              if (name?.trim()) {
                setChecklists(prev => [...prev, { id: crypto.randomUUID(), name: name?.trim(), items: [] }]);
                setActiveChecklistIndex(checklists?.length);
              }
            }}
          >
            <Icon name="Plus" size={14} />
            Add checklist
          </button>
        </div>

        {checklists?.map((checklist, checklistIndex) => (
          <div key={checklist?.id} className="jm-subcard">
            <div className="jm-subcard-head">
              <h4>{checklist?.name}</h4>
              <button
                type="button"
                onClick={() => handleRemoveChecklist(checklistIndex)}
                className="jm-file-x"
                title="Remove checklist"
              >
                <Icon name="Trash2" size={14} />
              </button>
            </div>
            {checklist?.items?.length > 0 && (
              <div className="jm-checkitems">
                {checklist?.items?.map((item, itemIndex) => (
                  <div key={item?.id} className="jm-checkitem">
                    <span className="box" />
                    <span className="t">{item?.text}</span>
                    <button
                      type="button"
                      onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'up')}
                      disabled={itemIndex === 0}
                      title="Move up"
                    >
                      <Icon name="ChevronUp" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'down')}
                      disabled={itemIndex === checklist?.items?.length - 1}
                      title="Move down"
                    >
                      <Icon name="ChevronDown" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveChecklistItem(checklistIndex, item?.id)}
                      className="danger"
                      title="Remove item"
                    >
                      <Icon name="X" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="dsr-inlineadd">
              <input
                type="text"
                className="jm-input"
                placeholder="Add checklist item"
                value={activeChecklistIndex === checklistIndex ? newChecklistItem : ''}
                onChange={(e) => { setNewChecklistItem(e?.target?.value); setActiveChecklistIndex(checklistIndex); }}
                onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddChecklistItem(checklistIndex); } }}
              />
              <button
                type="button"
                className="jm-btn accent sm"
                onClick={() => handleAddChecklistItem(checklistIndex)}
                disabled={!newChecklistItem?.trim() || activeChecklistIndex !== checklistIndex}
              >
                Add
              </button>
            </div>
          </div>
        ))}

        <hr className="jm-rule" />

        {/* ── Recurrence ── */}
        <p className="jm-secthead">
          <Icon name="Repeat" size={14} />
          Recurrence
        </p>
        <div className="jm-section">
          <label className="jm-label" htmlFor="jem-recur">Repeat</label>
          <select
            id="jem-recur"
            className="jm-select"
            value={recurrence || 'none'}
            onChange={(e) => setRecurrence(e?.target?.value)}
          >
            <option value="none">None (one-time job)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {recurrence === 'weekly' && (
          <div className="jm-section">
            <p className="jm-label">Days of the week</p>
            <div className="jm-pills">
              {weekDays?.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWeekDay(day?.toLowerCase())}
                  className={`jm-pill${recurrenceWeekDays?.includes(day?.toLowerCase()) ? ' on' : ''}`}
                >
                  {day?.substring(0, 3)}
                </button>
              ))}
            </div>
          </div>
        )}
        {recurrence === 'monthly' && (
          <div className="jm-section">
            <label className="jm-label" htmlFor="jem-monthday">Day of the month</label>
            <input
              id="jem-monthday"
              type="number"
              min="1"
              max="31"
              className="jm-input"
              style={{ width: 110 }}
              value={recurrenceMonthDay}
              onChange={(e) => setRecurrenceMonthDay(parseInt(e?.target?.value) || 1)}
            />
          </div>
        )}

        <hr className="jm-rule" />

        {/* ── Duty set ── */}
        <p className="jm-secthead">
          <Icon name="Briefcase" size={14} />
          Duty set
        </p>
        <div className="jm-section">
          <label className="jm-label" htmlFor="jem-dutyset">
            Duty set name<span className="opt">optional</span>
          </label>
          <input
            id="jem-dutyset"
            type="text"
            className="jm-input"
            placeholder="e.g. Morning duties"
            value={dutySetName}
            onChange={(e) => setDutySetName(e?.target?.value)}
          />
          <p className="jm-hint">Links this job to a grouped operational duty.</p>
        </div>

        <hr className="jm-rule" />

        {/* ── Attachments ── */}
        <p className="jm-secthead">
          <Icon name="Paperclip" size={14} />
          Attachments
        </p>
        <div className="jm-section">
          <input
            type="file"
            id="edit-file-upload"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <label htmlFor="edit-file-upload" className="jm-drop">
            <span className="jm-drop-ico">
              {uploadingFile ? <span className="jm-spin sm" /> : <Icon name="Upload" size={18} />}
            </span>
            <span className="jm-drop-t">{uploadingFile ? 'Uploading…' : 'Click to upload files'}</span>
            <span className="jm-drop-s">Images, PDFs or documents</span>
          </label>
          {attachments?.length > 0 && (
            <div className="jm-filelist">
              {attachments?.map(attachment => (
                <div key={attachment?.id} className="jm-file">
                  {attachment?.type?.startsWith('image/') ? (
                    <img src={attachment?.url} alt={attachment?.name} className="jm-file-thumb" />
                  ) : (
                    <Icon name="File" size={14} />
                  )}
                  <span className="name">{attachment?.name}</span>
                  <span className="size">{(attachment?.size / 1024)?.toFixed(1)} KB</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(attachment?.id)}
                    className="jm-file-x"
                    title="Remove attachment"
                  >
                    <Icon name="X" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <hr className="jm-rule" />

        {/* ── Comment ── */}
        <p className="jm-secthead">
          <Icon name="MessageSquare" size={14} />
          Add a comment
        </p>
        <div className="jm-section">
          <textarea
            className="jm-textarea"
            rows={3}
            placeholder="Add a comment or note to this job"
            value={newComment}
            onChange={(e) => setNewComment(e?.target?.value)}
          />
        </div>

        {/* ── Change history ── */}
        {showMeta && existingMeta?.length > 0 && (
          <>
            <hr className="jm-rule" />
            <div className="jm-secthead-row">
              <p className="jm-secthead">
                <Icon name="History" size={14} />
                Change history
              </p>
              <span className="jm-tag accent">Command &amp; chief</span>
            </div>
            <div className="ar-history" style={{ maxHeight: 220, overflowY: 'auto' }}>
              {[...existingMeta]?.reverse()?.map((entry, idx) => (
                <div key={idx} className="ar-hist">
                  <div className="ar-hist-top">
                    <span className="who">{entry?.user_name}</span>
                    <span className="when">{formatMeta(entry?.timestamp)}</span>
                  </div>
                  <p className="what">
                    {entry?.field === 'comment' ? (
                      <>commented: <em>{entry?.new_value}</em></>
                    ) : (
                      <>
                        Changed <strong>{entry?.field}</strong>
                        {entry?.old_value != null && <> from “{String(entry?.old_value)}”</>}
                        {entry?.new_value != null && <> to “{String(entry?.new_value)}”</>}
                      </>
                    )}
                  </p>
                  {entry?.user_tier && <span className="tier">{entry?.user_tier}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="jm-foot">
        <button type="button" className="jm-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <div className="spacer" />
        <button className="jm-btn primary" onClick={handleSave} disabled={saving || !title?.trim()}>
          {saving ? <span className="jm-spin sm" /> : <Icon name="Save" size={15} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </ModalShell>
  );
};

export default JobEditModal;
