import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';

// ── Color palette for duty templates ──
const TEMPLATE_COLORS = [
  { bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD', label: 'Blue' },
  { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7', label: 'Green' },
  { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D', label: 'Amber' },
  { bg: '#FCE7F3', text: '#9D174D', border: '#F9A8D4', label: 'Pink' },
  { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD', label: 'Purple' },
  { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5', label: 'Red' },
  { bg: '#CCFBF1', text: '#134E4A', border: '#5EEAD4', label: 'Teal' },
  { bg: '#FFEDD5', text: '#9A3412', border: '#FDBA74', label: 'Orange' },
  { bg: '#E0E7FF', text: '#3730A3', border: '#A5B4FC', label: 'Indigo' },
  { bg: '#F0FDF4', text: '#14532D', border: '#86EFAC', label: 'Lime' },
];

// Assign a consistent color to a template based on its id
const getTemplateColor = (templateId, templates) => {
  const idx = templates?.findIndex(t => t?.id === templateId);
  if (idx === -1 || idx === undefined) return TEMPLATE_COLORS?.[0];
  return TEMPLATE_COLORS?.[idx % TEMPLATE_COLORS?.length];
};

// ── Sync a team_job for a rotation assignment ──
// Creates a new job if none exists, updates if one already exists.
// Returns the job id.
const syncJobForAssignment = async ({ assignmentId, linkedJobId, tenantId, departmentId, memberId, dateKey, templateName, createdBy }) => {
  if (!tenantId || !memberId || !dateKey || !templateName) {
    console.error('[RotationCalendar] syncJobForAssignment: missing required fields', { tenantId, memberId, dateKey, templateName, createdBy });
    return null;
  }

  try {
    // Use the SECURITY DEFINER RPC to bypass RLS and ensure created_by is always set
    const { data: jobId, error } = await supabase
      ?.rpc('sync_rotation_job', {
        p_assignment_id: assignmentId || null,
        p_tenant_id: tenantId,
        p_department_id: departmentId || null,
        p_member_id: memberId,
        p_date: dateKey,
        p_title: templateName,
        p_created_by: createdBy,
      });

    if (error) {
      console.error('[RotationCalendar] syncJob RPC error:', error?.message, error);
      return null;
    }

    console.log('[RotationCalendar] syncJob RPC success, job id:', jobId);
    return jobId || null;
  } catch (err) {
    console.error('[RotationCalendar] syncJobForAssignment exception:', err);
    return null;
  }
};

// ── Delete the linked team_job for a rotation assignment ──
const deleteJobForAssignment = async (linkedJobId) => {
  if (!linkedJobId) return;
  try {
    await supabase
      ?.from('team_jobs')
      ?.delete()
      ?.eq('id', linkedJobId)
      ?.eq('source', 'rotation');
  } catch (err) {
    console.warn('[RotationCalendar] deleteJobForAssignment error:', err);
  }
};

const RotationCalendar = ({ templates, departmentId, tenantId, currentUserId }) => {
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [members, setMembers] = useState([]);
  const [includedMemberIds, setIncludedMemberIds] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [assignments, setAssignments] = useState({});
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [assignModal, setAssignModal] = useState(null); // { memberId, date }
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [autoRotating, setAutoRotating] = useState(false);
  const [clearingWeek, setClearingWeek] = useState(false);

  // ── Generate week dates ──
  const getWeekDates = (weekOffset = 0) => {
    const today = new Date();
    const currentDay = today?.getDay();
    const monday = new Date(today);
    monday?.setDate(today?.getDate() - (currentDay === 0 ? 6 : currentDay - 1) + weekOffset * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d?.setDate(monday?.getDate() + i);
      dates?.push(d);
    }
    return dates;
  };

  const weekDates = getWeekDates(selectedWeek);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const formatDateKey = (date) => {
    const y = date?.getFullYear();
    const m = String(date?.getMonth() + 1)?.padStart(2, '0');
    const d = String(date?.getDate())?.padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // ── Fetch department members ──
  const fetchMembers = useCallback(async () => {
    if (!departmentId || !tenantId) return;
    setLoadingMembers(true);
    try {
      const { data: tmData, error: tmError } = await supabase
        ?.from('tenant_members')
        ?.select('id, user_id, department_id')
        ?.eq('tenant_id', tenantId)
        ?.eq('department_id', departmentId)
        ?.eq('active', true);

      if (tmError) throw tmError;

      const userIds = tmData?.map(tm => tm?.user_id)?.filter(Boolean);
      if (!userIds?.length) {
        setMembers([]);
        setIncludedMemberIds([]);
        setLoadingMembers(false);
        return;
      }

      const { data: profilesData } = await supabase
        ?.from('profiles')
        ?.select('id, full_name, first_name, last_name')
        ?.in('id', userIds);

      const memberList = tmData?.map(tm => {
        const profile = profilesData?.find(p => p?.id === tm?.user_id);
        const name = profile?.full_name ||
          [profile?.first_name, profile?.last_name]?.filter(Boolean)?.join(' ') ||
          'Unknown';
        return { id: tm?.id, user_id: tm?.user_id, name };
      })?.filter(m => m?.name !== 'Unknown' || true);

      setMembers(memberList);
      setIncludedMemberIds(memberList?.map(m => m?.id));
    } catch (err) {
      console.warn('[RotationCalendar] fetchMembers error:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [departmentId, tenantId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ── Fetch assignments for visible week ──
  const fetchAssignments = useCallback(async () => {
    if (!departmentId || !tenantId || !weekDates?.length) return;
    const startDate = formatDateKey(weekDates?.[0]);
    const endDate = formatDateKey(weekDates?.[6]);
    try {
      const { data, error } = await supabase
        ?.from('rotation_assignments')
        ?.select('id, member_id, date, duty_set_template_id, department_id, linked_job_id')
        ?.eq('tenant_id', tenantId)
        ?.eq('department_id', departmentId)
        ?.gte('date', startDate)
        ?.lte('date', endDate);

      if (error) throw error;

      const map = {};
      data?.forEach(a => {
        const key = `${a?.member_id}__${a?.date}`;
        map[key] = a;
      });
      setAssignments(map);
    } catch (err) {
      console.warn('[RotationCalendar] fetchAssignments error:', err);
    }
  }, [departmentId, tenantId, selectedWeek]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  // ── Toggle member inclusion ──
  const toggleMember = (memberId) => {
    setIncludedMemberIds(prev =>
      prev?.includes(memberId)
        ? prev?.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const displayedMembers = members?.filter(m => includedMemberIds?.includes(m?.id));

  // ── Handle day cell click ──
  const handleDayClick = (memberId, date) => {
    setAssignModal({ memberId, date });
  };

  // ── Save assignment (manual cell click) ──
  const handleSaveAssignment = async (templateId) => {
    if (!assignModal || !tenantId || !departmentId) return;
    setSavingAssignment(true);
    const dateKey = formatDateKey(assignModal?.date);
    const key = `${assignModal?.memberId}__${dateKey}`;
    // Look up the auth user_id for this member (assignModal.memberId is tenant_members.id)
    const memberRecord = members?.find(m => m?.id === assignModal?.memberId);
    const memberUserId = memberRecord?.user_id || assignModal?.memberId;
    try {
      const existing = assignments?.[key];
      if (existing) {
        if (templateId === null) {
          // ── Remove assignment + linked job ──
          await deleteJobForAssignment(existing?.linked_job_id);
          await supabase?.from('rotation_assignments')?.delete()?.eq('id', existing?.id);
          setAssignments(prev => {
            const next = { ...prev };
            delete next?.[key];
            return next;
          });
        } else {
          // ── Update assignment + sync linked job ──
          const templateName = templates?.find(t => t?.id === templateId)?.name || null;
          const jobId = await syncJobForAssignment({
            assignmentId: existing?.id,
            linkedJobId: existing?.linked_job_id || null,
            tenantId,
            departmentId,
            memberId: memberUserId,
            dateKey,
            templateName,
            createdBy: currentUserId,
          });

          // Update rotation_assignment with new template + linked_job_id
          const updatePayload = { duty_set_template_id: templateId };
          if (jobId && !existing?.linked_job_id) updatePayload.linked_job_id = jobId;

          await supabase
            ?.from('rotation_assignments')
            ?.update(updatePayload)
            ?.eq('id', existing?.id);

          setAssignments(prev => ({
            ...prev,
            [key]: {
              ...existing,
              duty_set_template_id: templateId,
              linked_job_id: jobId || existing?.linked_job_id || null,
            },
          }));
        }
      } else if (templateId !== null) {
        // ── Insert new assignment ──
        const { data: inserted } = await supabase
          ?.from('rotation_assignments')
          ?.insert({
            tenant_id: tenantId,
            department_id: departmentId,
            member_id: assignModal?.memberId,
            date: dateKey,
            duty_set_template_id: templateId,
          })
          ?.select()
          ?.single();

        if (inserted) {
          // ── Create linked job ──
          const templateName = templates?.find(t => t?.id === templateId)?.name || null;
          const jobId = await syncJobForAssignment({
            assignmentId: inserted?.id,
            linkedJobId: null,
            tenantId,
            departmentId,
            memberId: memberUserId,
            dateKey,
            templateName,
            createdBy: currentUserId,
          });

          // Store linked_job_id back on the assignment
          if (jobId) {
            await supabase
              ?.from('rotation_assignments')
              ?.update({ linked_job_id: jobId })
              ?.eq('id', inserted?.id);
          }

          setAssignments(prev => ({
            ...prev,
            [key]: { ...inserted, linked_job_id: jobId || null },
          }));
        }
      }
    } catch (err) {
      console.warn('[RotationCalendar] saveAssignment error:', err);
    } finally {
      setSavingAssignment(false);
      setAssignModal(null);
    }
  };

  const getAssignmentForCell = (memberId, date) => {
    const key = `${memberId}__${formatDateKey(date)}`;
    return assignments?.[key] || null;
  };

  const getTemplateName = (templateId) => {
    return templates?.find(t => t?.id === templateId)?.name || null;
  };

  // ── Auto Rotate ──
  const handleAutoRotate = async () => {
    if (!templates?.length || !displayedMembers?.length || !weekDates?.length) return;
    setAutoRotating(true);
    try {
      // ── Step 0: Re-fetch current week assignments fresh to avoid stale state ──
      const currentStartDate = formatDateKey(weekDates?.[0]);
      const currentEndDate = formatDateKey(weekDates?.[6]);

      const { data: currentWeekData } = await supabase
        ?.from('rotation_assignments')
        ?.select('id, member_id, date, duty_set_template_id, linked_job_id')
        ?.eq('tenant_id', tenantId)
        ?.eq('department_id', departmentId)
        ?.gte('date', currentStartDate)
        ?.lte('date', currentEndDate);

      // Build a fresh map of existing assignments for this week
      const currentAssignmentsMap = {};
      (currentWeekData || [])?.forEach(a => {
        const key = `${a?.member_id}__${a?.date}`;
        currentAssignmentsMap[key] = a;
      });

      // ── Step 1: Fetch previous week's assignments to determine rotation continuity ──
      const prevWeekDates = getWeekDates(selectedWeek - 1);
      const prevStartDate = formatDateKey(prevWeekDates?.[0]);
      const prevEndDate = formatDateKey(prevWeekDates?.[6]);

      const { data: prevWeekData } = await supabase
        ?.from('rotation_assignments')
        ?.select('member_id, date, duty_set_template_id')
        ?.eq('tenant_id', tenantId)
        ?.eq('department_id', departmentId)
        ?.gte('date', prevStartDate)
        ?.lte('date', prevEndDate)
        ?.in('member_id', displayedMembers?.map(m => m?.id));

      // ── Step 2: For each member, determine their starting template index ──
      const memberStartIndex = {};

      displayedMembers?.forEach((member, memberIdx) => {
        const memberPrevAssignments = (prevWeekData || [])
          ?.filter(a => a?.member_id === member?.id)
          ?.sort((a, b) => b?.date?.localeCompare(a?.date));

        if (memberPrevAssignments?.length > 0) {
          const lastAssignment = memberPrevAssignments?.[0];
          const lastTemplateIdx = templates?.findIndex(t => t?.id === lastAssignment?.duty_set_template_id);

          if (lastTemplateIdx !== -1) {
            memberStartIndex[member?.id] = (lastTemplateIdx + 1) % templates?.length;
          } else {
            memberStartIndex[member?.id] = (templates?.length - memberIdx % templates?.length) % templates?.length;
          }
        } else {
          memberStartIndex[member?.id] = (templates?.length - memberIdx % templates?.length) % templates?.length;
        }
      });

      // ── Step 3: Assign templates for the current week (only fill empty cells) ──
      const newAssignments = {};
      const inserts = [];

      displayedMembers?.forEach((member) => {
        const startIdx = memberStartIndex?.[member?.id] ?? 0;

        weekDates?.forEach((date, dayIdx) => {
          const dateKey = formatDateKey(date);
          const cellKey = `${member?.id}__${dateKey}`;

          // Skip if already assigned (respect manual changes)
          if (currentAssignmentsMap?.[cellKey]) return;

          const templateIdx = (startIdx + dayIdx) % templates?.length;
          const template = templates?.[templateIdx];
          if (!template) return;

          inserts?.push({
            tenant_id: tenantId,
            department_id: departmentId,
            member_id: member?.id,
            date: dateKey,
            duty_set_template_id: template?.id,
          });
          newAssignments[cellKey] = {
            tenant_id: tenantId,
            department_id: departmentId,
            member_id: member?.id,
            date: dateKey,
            duty_set_template_id: template?.id,
          };
        });
      });

      if (!inserts?.length) {
        setAssignments(prev => ({ ...prev, ...currentAssignmentsMap }));
        setAutoRotating(false);
        return;
      }

      // Insert all new assignments in one batch
      const { data: inserted, error } = await supabase
        ?.from('rotation_assignments')
        ?.insert(inserts)
        ?.select();

      if (error) throw error;

      // ── Create linked jobs for each newly inserted assignment ──
      const jobLinkUpdates = [];
      for (const row of (inserted || [])) {
        const templateName = templates?.find(t => t?.id === row?.duty_set_template_id)?.name || null;
        if (!templateName) continue;
        // Look up the auth user_id for this member (tenant_members.id → user_id)
        const memberRecord = members?.find(m => m?.id === row?.member_id);
        const memberUserId = memberRecord?.user_id || row?.member_id;
        const jobId = await syncJobForAssignment({
          assignmentId: row?.id,
          linkedJobId: null,
          tenantId,
          departmentId,
          memberId: memberUserId,
          dateKey: row?.date,
          templateName,
          createdBy: currentUserId,
        });
        if (jobId) {
          jobLinkUpdates?.push({ id: row?.id, linked_job_id: jobId });
        }
      }

      // Batch-update rotation_assignments with linked_job_id
      for (const upd of jobLinkUpdates) {
        await supabase
          ?.from('rotation_assignments')
          ?.update({ linked_job_id: upd?.linked_job_id })
          ?.eq('id', upd?.id);
      }

      // Merge inserted rows (with real IDs) into state
      const insertedMap = {};
      inserted?.forEach(row => {
        const key = `${row?.member_id}__${row?.date}`;
        const jobLink = jobLinkUpdates?.find(u => u?.id === row?.id);
        insertedMap[key] = { ...row, linked_job_id: jobLink?.linked_job_id || null };
      });

      setAssignments(prev => ({ ...prev, ...currentAssignmentsMap, ...insertedMap }));
    } catch (err) {
      console.warn('[RotationCalendar] autoRotate error:', err);
    } finally {
      setAutoRotating(false);
    }
  };

  // ── Clear Week ──
  const handleClearWeek = async () => {
    if (!weekDates?.length || !tenantId || !departmentId) return;
    setClearingWeek(true);
    try {
      const startDate = formatDateKey(weekDates?.[0]);
      const endDate = formatDateKey(weekDates?.[6]);

      // Fetch assignments for this week to get linked_job_ids before deleting
      const { data: weekAssignments } = await supabase
        ?.from('rotation_assignments')
        ?.select('id, linked_job_id')
        ?.eq('tenant_id', tenantId)
        ?.eq('department_id', departmentId)
        ?.gte('date', startDate)
        ?.lte('date', endDate);

      // Delete all linked rotation-generated jobs
      const linkedJobIds = (weekAssignments || [])
        ?.map(a => a?.linked_job_id)
        ?.filter(Boolean);

      for (const jobId of linkedJobIds) {
        await deleteJobForAssignment(jobId);
      }

      // Delete all rotation assignments for this week
      const { error } = await supabase
        ?.from('rotation_assignments')
        ?.delete()
        ?.eq('tenant_id', tenantId)
        ?.eq('department_id', departmentId)
        ?.gte('date', startDate)
        ?.lte('date', endDate);

      if (error) throw error;

      // Clear all assignments for this week from local state
      setAssignments(prev => {
        const next = { ...prev };
        weekDates?.forEach(date => {
          const dateKey = formatDateKey(date);
          displayedMembers?.forEach(member => {
            const key = `${member?.id}__${dateKey}`;
            delete next?.[key];
          });
        });
        return next;
      });
    } catch (err) {
      console.warn('[RotationCalendar] clearWeek error:', err);
    } finally {
      setClearingWeek(false);
    }
  };

  return (
    <div>
      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-6">
        <Button
          variant="outline"
          iconName="ChevronLeft"
          onClick={() => setSelectedWeek(prev => prev - 1)}
        >
          Previous Week
        </Button>
        <h3 className="text-lg font-semibold text-foreground">
          {weekDates?.[0]?.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} –{' '}
          {weekDates?.[6]?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearWeek}
            disabled={clearingWeek || autoRotating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:bg-muted transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
            title="Remove all duty assignments for this week"
          >
            {clearingWeek ? (
              <>
                <LogoSpinner size={16} />
                <span>Clearing...</span>
              </>
            ) : (
              <>
                <Icon name="Trash2" size={15} />
                <span>Clear Week</span>
              </>
            )}
          </button>
          <button
            onClick={handleAutoRotate}
            disabled={autoRotating || clearingWeek || !templates?.length || !displayedMembers?.length}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
            title="Auto-fill empty slots for this week with rotated duty assignments"
          >
            {autoRotating ? (
              <>
                <LogoSpinner size={16} />
                <span>Rotating...</span>
              </>
            ) : (
              <>
                <Icon name="RefreshCw" size={15} />
                <span>Auto Rotate</span>
              </>
            )}
          </button>
          <Button
            variant="outline"
            iconName="ChevronRight"
            iconPosition="right"
            onClick={() => setSelectedWeek(prev => prev + 1)}
          >
            Next Week
          </Button>
        </div>
      </div>
      {/* Color Legend */}
      {templates?.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mr-1">Legend:</span>
          {templates?.map((template, idx) => {
            const color = TEMPLATE_COLORS?.[idx % TEMPLATE_COLORS?.length];
            return (
              <span
                key={template?.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
                style={{ backgroundColor: color?.bg, color: color?.text, borderColor: color?.border }}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color?.border }}
                />
                {template?.name}
              </span>
            );
          })}
        </div>
      )}
      {/* Calendar Grid */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
        {/* Header Row */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: '220px repeat(7, 1fr)' }}>
          {/* Left column header with dropdown toggle */}
          <div className="p-4 bg-muted/30 font-semibold text-sm text-foreground flex items-center justify-between border-r border-border relative">
            <span>Team Member</span>
            <button
              onClick={() => setDropdownOpen(prev => !prev)}
              className={`p-1.5 rounded transition-smooth ${
                dropdownOpen ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
              }`}
              title={dropdownOpen ? 'Close member selector' : 'Select members'}
            >
              <Icon name={dropdownOpen ? 'Check' : 'Edit2'} size={14} />
            </button>
            {/* Dropdown */}
            {dropdownOpen && (
              <div
                className="absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-xl shadow-lg"
                onClick={e => e?.stopPropagation()}
              >
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Team Members</span>
                  <button
                    onClick={() => setDropdownOpen(false)}
                    className="p-0.5 hover:bg-muted rounded transition-smooth"
                  >
                    <Icon name="X" size={12} className="text-muted-foreground" />
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {loadingMembers ? (
                    <div className="flex items-center justify-center py-4 gap-2">
                      <LogoSpinner size={16} />
                      <span className="text-xs text-muted-foreground">Loading...</span>
                    </div>
                  ) : members?.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4 px-3">No members found in this department.</p>
                  ) : (
                    members?.map(member => (
                      <label
                        key={member?.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-smooth"
                      >
                        <input
                          type="checkbox"
                          checked={includedMemberIds?.includes(member?.id)}
                          onChange={() => toggleMember(member?.id)}
                          className="w-4 h-4 accent-primary flex-shrink-0 rounded"
                        />
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-semibold text-primary">
                              {member?.name?.split(' ')?.map(n => n?.[0])?.slice(0, 2)?.join('')}
                            </span>
                          </div>
                          <span className="text-sm text-foreground truncate">{member?.name}</span>
                        </div>
                      </label>
                    ))
                  )}
                </div>
                <div className="px-3 py-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {includedMemberIds?.length} of {members?.length} selected
                  </span>
                </div>
              </div>
            )}
          </div>
          {dayNames?.map((day, idx) => (
            <div key={day} className="p-4 bg-muted/30 text-center border-r border-border last:border-r-0">
              <div className="font-semibold text-sm text-foreground">{day}</div>
              <div className="text-xs text-muted-foreground">{weekDates?.[idx]?.getDate()}</div>
            </div>
          ))}
        </div>

        {/* Loading state */}
        {loadingMembers && (
          <div className="p-8 text-center">
            <LogoSpinner size={24} className="mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading members...</p>
          </div>
        )}

        {/* Member rows */}
        {!loadingMembers && displayedMembers?.map(member => (
          <div
            key={member?.id}
            className="grid border-b border-border hover:bg-muted/5 transition-smooth"
            style={{ gridTemplateColumns: '220px repeat(7, 1fr)' }}
          >
            {/* Member name cell */}
            <div className="p-4 flex items-center gap-2 border-r border-border">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-primary">
                  {member?.name?.split(' ')?.map(n => n?.[0])?.slice(0, 2)?.join('')}
                </span>
              </div>
              <span className="text-sm font-medium text-foreground truncate">{member?.name}</span>
            </div>
            {/* Day cells */}
            {weekDates?.map((date, idx) => {
              const assignment = getAssignmentForCell(member?.id, date);
              const templateId = assignment?.duty_set_template_id;
              const templateName = templateId ? getTemplateName(templateId) : null;
              const color = templateId ? getTemplateColor(templateId, templates) : null;
              return (
                <div
                  key={idx}
                  onClick={() => handleDayClick(member?.id, date)}
                  className="border-r border-border last:border-r-0 min-h-[56px] flex items-center justify-center cursor-pointer transition-smooth group relative"
                  style={color ? {
                    backgroundColor: color?.bg,
                    borderLeft: `3px solid ${color?.border}`,
                  } : {}}
                  title={templateName ? `${templateName} — click to change` : `Assign duty to ${member?.name} on ${date?.toLocaleDateString()}`}
                >
                  {templateName && color ? (
                    <div className="w-full h-full flex items-center justify-center px-2 py-1.5">
                      <span
                        className="text-xs font-semibold text-center leading-tight w-full"
                        style={{ color: color?.text }}
                      >
                        {templateName}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-60 transition-smooth">+</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Empty state */}
        {!loadingMembers && displayedMembers?.length === 0 && (
          <div className="p-12 text-center">
            <Icon name="Users" size={40} className="mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm font-medium text-foreground mb-1">No members to display</p>
            <p className="text-xs text-muted-foreground">
              {members?.length === 0
                ? 'No active members found in this department.' : 'Use the edit button above to select members to include.'}
            </p>
          </div>
        )}
      </div>
      {/* Duty Set Assignment Modal */}
      {assignModal && (
        <DutySetAssignModal
          member={members?.find(m => m?.id === assignModal?.memberId)}
          date={assignModal?.date}
          templates={templates}
          currentAssignment={getAssignmentForCell(assignModal?.memberId, assignModal?.date)}
          saving={savingAssignment}
          onClose={() => setAssignModal(null)}
          onSelect={handleSaveAssignment}
        />
      )}
    </div>
  );
};

// ── Duty Set Assignment Modal ──
const DutySetAssignModal = ({ member, date, templates, currentAssignment, saving, onClose, onSelect }) => {
  const dateLabel = date?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl border border-border shadow-lg max-w-md w-full"
        onClick={e => e?.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Assign Duty Set</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {member?.name} · {dateLabel}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded transition-smooth">
            <Icon name="X" size={18} className="text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-80 overflow-y-auto">
          {templates?.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No templates available for this department.</p>
          )}
          {templates?.map((template, idx) => {
            const isSelected = currentAssignment?.duty_set_template_id === template?.id;
            const color = TEMPLATE_COLORS?.[idx % TEMPLATE_COLORS?.length];
            return (
              <button
                key={template?.id}
                onClick={() => onSelect(template?.id)}
                disabled={saving}
                className="w-full text-left px-4 py-3 rounded-lg border-2 transition-smooth"
                style={{
                  backgroundColor: isSelected ? color?.bg : 'transparent',
                  borderColor: isSelected ? color?.border : '#e5e7eb',
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Color swatch */}
                  <span
                    className="w-4 h-4 rounded-full flex-shrink-0 border"
                    style={{ backgroundColor: color?.border, borderColor: color?.border }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: isSelected ? color?.text : undefined }}>
                      {template?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{template?.category} · {template?.taskCount} tasks</p>
                  </div>
                  {isSelected && <Icon name="Check" size={16} style={{ color: color?.text }} className="flex-shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>

        {currentAssignment && (
          <div className="px-5 pb-5">
            <button
              onClick={() => onSelect(null)}
              disabled={saving}
              className="w-full px-4 py-2 rounded-lg border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 transition-smooth"
            >
              Remove Assignment
            </button>
          </div>
        )}

        {saving && (
          <div className="px-5 pb-5 flex items-center justify-center gap-2">
            <LogoSpinner size={16} />
            <span className="text-xs text-muted-foreground">Saving...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default RotationCalendar;