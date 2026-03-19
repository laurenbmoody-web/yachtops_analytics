import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { supabase } from '../../../lib/supabaseClient';
import { TIER_RANK, normalizeTier, canAssignTo } from '../utils/tierPermissions';
import SearchableAssigneeDropdown from './SearchableAssigneeDropdown';

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
        ?.from('profiles')?.select('id, full_name, first_name, last_name, email')?.in('id', userIds);

      const profilesMap = {};
      (profilesData || [])?.forEach(p => { profilesMap[p.id] = p; });

      const members = tmData?.map(tm => {
        const p = profilesMap?.[tm?.user_id];
        const displayName =
          p?.full_name ||
          [p?.first_name, p?.last_name]?.filter(Boolean)?.join(' ') ||
          p?.email ||
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4" onClick={onClose}>
        <div
          className="bg-card rounded-xl border border-border shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border bg-card sticky top-0 z-10">
            <div>
              <div className="flex items-center gap-2">
                <Icon name="CheckCircle" size={20} className="text-green-500" />
                <h2 className="text-xl font-semibold text-foreground">Accept Job</h2>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Review and configure this job before accepting it into your department
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg transition-colors">
              <Icon name="X" size={20} className="text-muted-foreground" />
            </button>
          </div>

          {/* Scrollable form body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <Icon name="AlertCircle" size={14} className="text-red-500" />
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="FileText" size={16} />
                Core Information
              </h3>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Job Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e?.target?.value)} placeholder="Enter job title"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Description / Notes</label>
                <textarea value={description} onChange={(e) => setDescription(e?.target?.value)} placeholder="Add detailed description or notes"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" rows={4} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Board *</label>
                <select value={selectedBoardId} onChange={(e) => setSelectedBoardId(e?.target?.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">— No Board —</option>
                  {filteredBoards?.map(b => {
                    const displayName = (userDeptId && b?.names?.[userDeptId]) ? b?.names?.[userDeptId] : (b?.name || 'Board');
                    return <option key={b?.id} value={b?.id}>{displayName}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Assign To {userDeptName ? `(${userDeptName})` : ''}</label>
                {loadingAssignees ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">Loading team members...</div>
                ) : assigneeOptions?.length === 0 ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">No eligible crew in this department</div>
                ) : (
                  <SearchableAssigneeDropdown crewMembers={assigneeOptions} selectedAssignees={assignees} onChange={(newAssignees) => setAssignees(newAssignees)} department={userDeptId} />
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Due Date *</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e?.target?.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Time (Optional)</label>
                  <input type="time" value={dueTime} onChange={(e) => setDueTime(e?.target?.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Priority / Importance *</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e?.target?.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {PRIORITY_OPTIONS?.map(p => (
                    <option key={p} value={p}>{p?.charAt(0)?.toUpperCase() + p?.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Checklists */}
            <div className="space-y-4 border-t border-border pt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                  <Icon name="CheckSquare" size={16} />Checklists
                </h3>
                <Button type="button" variant="outline" size="sm" iconName="Plus" onClick={() => {
                  const name = prompt('Checklist name:');
                  if (name?.trim()) { setChecklists(prev => [...prev, { id: crypto.randomUUID(), name: name?.trim(), items: [] }]); setActiveChecklistIndex(checklists?.length); }
                }}>Add Checklist</Button>
              </div>
              {checklists?.map((checklist, checklistIndex) => (
                <div key={checklist?.id} className="bg-background rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-foreground">{checklist?.name}</h4>
                    <button type="button" onClick={() => handleRemoveChecklist(checklistIndex)} className="p-1 hover:bg-red-500/10 rounded transition-smooth">
                      <Icon name="Trash2" size={14} className="text-red-500" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {checklist?.items?.map((item, itemIndex) => (
                      <div key={item?.id} className="flex items-center gap-2 bg-card p-2 rounded-lg">
                        <Checkbox checked={item?.completed} disabled />
                        <span className="flex-1 text-sm text-foreground">{item?.text}</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'up')} disabled={itemIndex === 0} className="p-1 hover:bg-muted rounded disabled:opacity-30"><Icon name="ChevronUp" size={14} /></button>
                          <button type="button" onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'down')} disabled={itemIndex === checklist?.items?.length - 1} className="p-1 hover:bg-muted rounded disabled:opacity-30"><Icon name="ChevronDown" size={14} /></button>
                          <button type="button" onClick={() => handleRemoveChecklistItem(checklistIndex, item?.id)} className="p-1 hover:bg-red-500/10 rounded"><Icon name="X" size={14} className="text-red-500" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="text" placeholder="Add checklist item"
                      value={activeChecklistIndex === checklistIndex ? newChecklistItem : ''}
                      onChange={(e) => { setNewChecklistItem(e?.target?.value); setActiveChecklistIndex(checklistIndex); }}
                      onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddChecklistItem(checklistIndex); } }}
                      className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <Button type="button" size="sm" onClick={() => handleAddChecklistItem(checklistIndex)} disabled={!newChecklistItem?.trim() || activeChecklistIndex !== checklistIndex}>Add</Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Attachments */}
            <div className="space-y-4 border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="Paperclip" size={16} />Attachments
              </h3>
              <div>
                <input type="file" id="accept-file-upload" multiple accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileUpload} className="hidden" />
                <Button type="button" variant="outline" iconName="Upload" onClick={() => document.getElementById('accept-file-upload')?.click()} loading={uploadingFile}>Upload Files</Button>
              </div>
              {attachments?.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {attachments?.map(attachment => (
                    <div key={attachment?.id} className="relative bg-background rounded-lg border border-border p-3 flex items-center gap-3">
                      {attachment?.type?.startsWith('image/') ? (
                        <img src={attachment?.url} alt={attachment?.name} className="w-12 h-12 rounded object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center"><Icon name="File" size={20} className="text-muted-foreground" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{attachment?.name}</p>
                        <p className="text-xs text-muted-foreground">{(attachment?.size / 1024)?.toFixed(1)} KB</p>
                      </div>
                      <button type="button" onClick={() => handleRemoveAttachment(attachment?.id)} className="p-1 hover:bg-red-500/10 rounded transition-smooth"><Icon name="X" size={14} className="text-red-500" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comment */}
            <div className="space-y-4 border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="MessageSquare" size={16} />Initial Comment (Optional)
              </h3>
              <textarea value={newComment} onChange={(e) => setNewComment(e?.target?.value)} placeholder="Add an initial comment or handover note"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" rows={3} />
            </div>

            {/* Change History */}
            {showMeta && existingMeta?.length > 0 && (
              <div className="space-y-2 border-t border-border pt-6">
                <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1.5">
                  <Icon name="History" size={12} />Change History
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">COMMAND / CHIEF</span>
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {[...existingMeta]?.reverse()?.map((entry, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-muted/30 border border-border text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-foreground">{entry?.user_name}</span>
                        <span className="text-muted-foreground">{formatMeta(entry?.timestamp)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">{entry?.user_tier}</span>
                        {entry?.field === 'comment' ? (
                          <span className="text-foreground">commented: <em>{entry?.new_value}</em></span>
                        ) : (
                          <span>changed <strong className="text-foreground">{entry?.field}</strong>
                            {entry?.old_value != null && <> from <span className="line-through">{String(entry?.old_value)}</span></>}
                            {entry?.new_value != null && <> to <strong className="text-foreground">{String(entry?.new_value)}</strong></>}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-card sticky bottom-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <button onClick={handleAcceptJob} disabled={saving || !title?.trim()}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? (<><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Accepting...</>) : (<><Icon name="CheckCircle" size={16} />Accept Job</>)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FULL EDIT MODE — ComprehensiveJobModal-style layout
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300] p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e?.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border bg-card sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="Pencil" size={20} className="text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Edit Job</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Update job details and save changes</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <Icon name="AlertCircle" size={14} className="text-red-500" />
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* ========== CORE FIELDS ========== */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="FileText" size={16} />Core Information
            </h3>

            {/* Title */}
            <Input
              label="Job Title"
              required
              value={title}
              onChange={(e) => setTitle(e?.target?.value)}
              placeholder="Enter job title"
            />

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Description / Notes</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e?.target?.value)}
                placeholder="Add detailed description or notes"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-smooth"
                rows={4}
              />
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Department *</label>
              {canSelectDept ? (
                loadingDepts ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">Loading departments...</div>
                ) : (
                  <Select
                    value={selectedDeptId || ''}
                    onChange={(value) => {
                      setSelectedDeptId(value);
                      setAssignees([]);
                      setSelectedBoardId('');
                    }}
                    options={supabaseDeptOptions}
                    placeholder="Select department"
                  />
                )
              ) : (
                <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-foreground">
                  {getDeptName(selectedDeptId) || 'Your Department'}
                  <span className="text-xs text-muted-foreground ml-2">(locked to your department)</span>
                </div>
              )}
            </div>

            {/* Board */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Board</label>
              <Select
                value={selectedBoardId}
                onChange={(value) => setSelectedBoardId(value)}
                options={[
                  { value: '', label: '— No Board —' },
                  ...filteredBoards?.map(b => {
                    const displayName = (selectedDeptId && b?.names?.[selectedDeptId]) ? b?.names?.[selectedDeptId] : (b?.name || 'Board');
                    return { value: b?.id, label: displayName };
                  })
                ]}
              />
            </div>

            {/* Assign To */}
            {canShowAssignee && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Assign To {selectedDeptId ? `(${getDeptName(selectedDeptId)})` : ''}
                </label>
                {loadingAssignees ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">Loading team members...</div>
                ) : assigneeOptions?.length === 0 ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">No eligible crew in this department</div>
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

            {/* Due Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Due Date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e?.target?.value)}
              />
              <Input
                label="Time (Optional)"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e?.target?.value)}
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Priority / Importance *</label>
              <Select
                value={priority}
                onChange={(value) => setPriority(value)}
                options={PRIORITY_OPTIONS?.map(p => ({ value: p, label: p?.charAt(0)?.toUpperCase() + p?.slice(1) }))}
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Status</label>
              <Select
                value={status}
                onChange={(value) => setStatus(value)}
                options={STATUS_OPTIONS?.map(s => ({ value: s, label: s?.charAt(0)?.toUpperCase() + s?.slice(1) }))}
              />
            </div>
          </div>

          {/* ========== CHECKLISTS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="CheckSquare" size={16} />Checklists
              </h3>
              <Button type="button" variant="outline" size="sm" iconName="Plus" onClick={() => {
                const name = prompt('Checklist name:');
                if (name?.trim()) { setChecklists(prev => [...prev, { id: crypto.randomUUID(), name: name?.trim(), items: [] }]); setActiveChecklistIndex(checklists?.length); }
              }}>Add Checklist</Button>
            </div>
            {checklists?.map((checklist, checklistIndex) => (
              <div key={checklist?.id} className="bg-background rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-foreground">{checklist?.name}</h4>
                  <button type="button" onClick={() => handleRemoveChecklist(checklistIndex)} className="p-1 hover:bg-red-500/10 rounded transition-smooth">
                    <Icon name="Trash2" size={14} className="text-red-500" />
                  </button>
                </div>
                <div className="space-y-2">
                  {checklist?.items?.map((item, itemIndex) => (
                    <div key={item?.id} className="flex items-center gap-2 bg-card p-2 rounded-lg">
                      <Checkbox checked={item?.completed} disabled />
                      <span className="flex-1 text-sm text-foreground">{item?.text}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'up')} disabled={itemIndex === 0} className="p-1 hover:bg-muted rounded disabled:opacity-30"><Icon name="ChevronUp" size={14} /></button>
                        <button type="button" onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'down')} disabled={itemIndex === checklist?.items?.length - 1} className="p-1 hover:bg-muted rounded disabled:opacity-30"><Icon name="ChevronDown" size={14} /></button>
                        <button type="button" onClick={() => handleRemoveChecklistItem(checklistIndex, item?.id)} className="p-1 hover:bg-red-500/10 rounded"><Icon name="X" size={14} className="text-red-500" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Add checklist item"
                    value={activeChecklistIndex === checklistIndex ? newChecklistItem : ''}
                    onChange={(e) => { setNewChecklistItem(e?.target?.value); setActiveChecklistIndex(checklistIndex); }}
                    onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddChecklistItem(checklistIndex); } }}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <Button type="button" size="sm" onClick={() => handleAddChecklistItem(checklistIndex)} disabled={!newChecklistItem?.trim() || activeChecklistIndex !== checklistIndex}>Add</Button>
                </div>
              </div>
            ))}
          </div>

          {/* ========== RECURRENCE ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="Repeat" size={16} />Recurrence
            </h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Repeat</label>
              <Select
                value={recurrence}
                onChange={(value) => setRecurrence(value)}
                options={[
                  { value: 'none', label: 'None (One-time job)' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' }
                ]}
              />
            </div>
            {recurrence === 'weekly' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Select Day(s) of Week</label>
                <div className="grid grid-cols-4 gap-2">
                  {weekDays?.map(day => (
                    <button key={day} type="button" onClick={() => toggleWeekDay(day?.toLowerCase())}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-smooth ${
                        recurrenceWeekDays?.includes(day?.toLowerCase())
                          ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:border-primary/50'
                      }`}>
                      {day?.substring(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {recurrence === 'monthly' && (
              <Input label="Day of Month" type="number" min="1" max="31" value={recurrenceMonthDay}
                onChange={(e) => setRecurrenceMonthDay(parseInt(e?.target?.value) || 1)} />
            )}
          </div>

          {/* ========== DUTY SET ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="Briefcase" size={16} />Duty Set (Optional)
            </h3>
            <Input
              label="Duty Set Name"
              placeholder="e.g., Morning Duties"
              value={dutySetName}
              onChange={(e) => setDutySetName(e?.target?.value)}
              description="Link this job to a grouped operational duty"
            />
          </div>

          {/* ========== ATTACHMENTS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="Paperclip" size={16} />Attachments
            </h3>
            <div>
              <input type="file" id="edit-file-upload" multiple accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileUpload} className="hidden" />
              <Button type="button" variant="outline" iconName="Upload" onClick={() => document.getElementById('edit-file-upload')?.click()} loading={uploadingFile}>Upload Files</Button>
            </div>
            {attachments?.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {attachments?.map(attachment => (
                  <div key={attachment?.id} className="relative bg-background rounded-lg border border-border p-3 flex items-center gap-3">
                    {attachment?.type?.startsWith('image/') ? (
                      <img src={attachment?.url} alt={attachment?.name} className="w-12 h-12 rounded object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center"><Icon name="File" size={20} className="text-muted-foreground" /></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{attachment?.name}</p>
                      <p className="text-xs text-muted-foreground">{(attachment?.size / 1024)?.toFixed(1)} KB</p>
                    </div>
                    <button type="button" onClick={() => handleRemoveAttachment(attachment?.id)} className="p-1 hover:bg-red-500/10 rounded transition-smooth"><Icon name="X" size={14} className="text-red-500" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ========== ADD COMMENT ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="MessageSquare" size={16} />Add Comment (Optional)
            </h3>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e?.target?.value)}
              placeholder="Add a comment or note to this job"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              rows={3}
            />
          </div>

          {/* ========== ADVANCED OPTIONS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-left">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="Settings" size={16} />Advanced Options
              </h3>
              <Icon name={showAdvanced ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-muted-foreground" />
            </button>
            {showAdvanced && (
              <div className="space-y-4 pl-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Status</label>
                  <Select
                    value={status}
                    onChange={(value) => setStatus(value)}
                    options={STATUS_OPTIONS?.map(s => ({ value: s, label: s?.charAt(0)?.toUpperCase() + s?.slice(1) }))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ========== CHANGE HISTORY ========== */}
          {showMeta && existingMeta?.length > 0 && (
            <div className="space-y-2 border-t border-border pt-6">
              <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1.5">
                <Icon name="History" size={12} />Change History
                <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-semibold">COMMAND / CHIEF</span>
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {[...existingMeta]?.reverse()?.map((entry, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-muted/30 border border-border text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-foreground">{entry?.user_name}</span>
                      <span className="text-muted-foreground">{formatMeta(entry?.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">{entry?.user_tier}</span>
                      {entry?.field === 'comment' ? (
                        <span className="text-foreground">commented: <em>{entry?.new_value}</em></span>
                      ) : (
                        <span>changed <strong className="text-foreground">{entry?.field}</strong>
                          {entry?.old_value != null && <> from <span className="line-through">{String(entry?.old_value)}</span></>}
                          {entry?.new_value != null && <> to <strong className="text-foreground">{String(entry?.new_value)}</strong></>}
                          </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-card sticky bottom-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !title?.trim()}
              loading={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobEditModal;
