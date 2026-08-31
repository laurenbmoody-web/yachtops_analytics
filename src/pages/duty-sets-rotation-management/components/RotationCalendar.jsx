import React, { useState, useEffect, useCallback } from 'react';
import { dateLocale } from '../../../utils/dateFormat';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import ModalShell from '../../../components/ui/ModalShell';
import '../../team-jobs-management/job-modals.css';
import '../duty-sets.css';
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

      // A person can hold more than one duty set on a day — stairs and bridge,
      // say — so each cell keeps a list. The crew decide the pairing on the
      // day; nothing here is tied to a particular weekday.
      const map = {};
      data?.forEach(a => {
        const key = `${a?.member_id}__${a?.date}`;
        (map[key] = map[key] || [])?.push(a);
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

  // ── Toggle one duty set on a cell ──
  // Adding a second does not replace the first: a cell holds as many duty sets
  // as the crew agreed for that day. Passing null clears the cell entirely.
  const handleToggleAssignment = async (templateId) => {
    if (!assignModal || !tenantId || !departmentId) return;
    setSavingAssignment(true);
    const dateKey = formatDateKey(assignModal?.date);
    const key = `${assignModal?.memberId}__${dateKey}`;
    const current = assignments?.[key] || [];
    // assignModal.memberId is tenant_members.id; jobs are keyed by auth user id
    const memberRecord = members?.find(m => m?.id === assignModal?.memberId);
    const memberUserId = memberRecord?.user_id || assignModal?.memberId;

    try {
      if (templateId === null) {
        // Clear the whole cell
        for (const a of current) {
          await deleteJobForAssignment(a?.linked_job_id);
          await supabase?.from('rotation_assignments')?.delete()?.eq('id', a?.id);
        }
        setAssignments(prev => { const next = { ...prev }; delete next?.[key]; return next; });
        setAssignModal(null);
        return;
      }

      const existing = current?.find(a => a?.duty_set_template_id === templateId);

      if (existing) {
        // Already on this cell — take it off
        await deleteJobForAssignment(existing?.linked_job_id);
        await supabase?.from('rotation_assignments')?.delete()?.eq('id', existing?.id);
        setAssignments(prev => ({
          ...prev,
          [key]: (prev?.[key] || [])?.filter(a => a?.id !== existing?.id),
        }));
        return;
      }

      // Add it alongside whatever is already there
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

      if (!inserted) return;

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

      if (jobId) {
        await supabase
          ?.from('rotation_assignments')
          ?.update({ linked_job_id: jobId })
          ?.eq('id', inserted?.id);
      }

      setAssignments(prev => ({
        ...prev,
        [key]: [...(prev?.[key] || []), { ...inserted, linked_job_id: jobId || null }],
      }));
    } catch (err) {
      console.warn('[RotationCalendar] toggleAssignment error:', err);
    } finally {
      setSavingAssignment(false);
    }
  };

  const getAssignmentsForCell = (memberId, date) => {
    const key = `${memberId}__${formatDateKey(date)}`;
    return assignments?.[key] || [];
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
        (currentAssignmentsMap[key] = currentAssignmentsMap[key] || [])?.push(a);
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

          // Skip cells that already hold a duty set (respect manual changes)
          if (currentAssignmentsMap?.[cellKey]?.length) return;

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
          newAssignments[cellKey] = [{
            tenant_id: tenantId,
            department_id: departmentId,
            member_id: member?.id,
            date: dateKey,
            duty_set_template_id: template?.id,
          }];
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
        (insertedMap[key] = insertedMap[key] || [])?.push({
          ...row, linked_job_id: jobLink?.linked_job_id || null,
        });
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
    <div className="rc">
      {/* Week navigation */}
      <div className="rc-weeknav">
        <button className="dsr-btn ghost" onClick={() => setSelectedWeek(prev => prev - 1)}>
          <Icon name="ChevronLeft" size={15} />
          <span className="hidden sm:inline">Previous</span>
        </button>
        <h3 className="rc-weeklabel">
          {weekDates?.[0]?.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric' })} –{' '}
          {weekDates?.[6]?.toLocaleDateString(dateLocale(), { month: 'long', day: 'numeric', year: 'numeric' })}
        </h3>
        <div className="rc-weekactions">
          <button
            onClick={handleClearWeek}
            disabled={clearingWeek || autoRotating}
            className="dsr-btn ghost"
            title="Remove all duty assignments for this week"
          >
            {clearingWeek ? <LogoSpinner size={15} /> : <Icon name="Trash2" size={15} />}
            <span className="hidden sm:inline">{clearingWeek ? 'Clearing…' : 'Clear week'}</span>
          </button>
          <button
            onClick={handleAutoRotate}
            disabled={autoRotating || clearingWeek || !templates?.length || !displayedMembers?.length}
            className="dsr-btn primary"
            title="Auto-fill empty slots for this week with rotated duty assignments"
          >
            {autoRotating ? <LogoSpinner size={15} /> : <Icon name="RefreshCw" size={15} />}
            <span>{autoRotating ? 'Rotating…' : 'Auto rotate'}</span>
          </button>
          <button className="dsr-btn ghost" onClick={() => setSelectedWeek(prev => prev + 1)}>
            <span className="hidden sm:inline">Next</span>
            <Icon name="ChevronRight" size={15} />
          </button>
        </div>
      </div>

      {/* Colour legend */}
      {templates?.length > 0 && (
        <div className="rc-legend">
          <span className="rc-legend-label">Legend</span>
          {templates?.map((template, idx) => {
            const color = TEMPLATE_COLORS?.[idx % TEMPLATE_COLORS?.length];
            return (
              <span
                key={template?.id}
                className="rc-legend-item"
                style={{ backgroundColor: color?.bg, color: color?.text, borderColor: color?.border }}
              >
                <span className="swatch" style={{ backgroundColor: color?.border }} />
                {template?.name}
              </span>
            );
          })}
        </div>
      )}

      {/* Calendar grid */}
      <div className="rc-grid">
        {/* Header row */}
        <div className="rc-row rc-row-head">
          <div className="rc-cell rc-namecell rc-headcell">
            <span className="rc-headlabel">Team member</span>
            <button
              onClick={() => setDropdownOpen(prev => !prev)}
              className={`rc-editbtn${dropdownOpen ? ' on' : ''}`}
              title={dropdownOpen ? 'Close member selector' : 'Select members'}
            >
              <Icon name={dropdownOpen ? 'Check' : 'Users'} size={14} />
            </button>
            {dropdownOpen && (
              <div className="rc-membermenu" onClick={e => e?.stopPropagation()}>
                <div className="rc-membermenu-head">
                  <span>Team members</span>
                  <button onClick={() => setDropdownOpen(false)} title="Close">
                    <Icon name="X" size={13} />
                  </button>
                </div>
                <div className="rc-membermenu-list">
                  {loadingMembers ? (
                    <div className="jm-loading" style={{ padding: '20px 10px' }}>
                      <LogoSpinner size={18} className="mx-auto mb-2" />
                      <p>Loading…</p>
                    </div>
                  ) : members?.length === 0 ? (
                    <p className="rc-membermenu-empty">No members found in this department.</p>
                  ) : (
                    members?.map(member => (
                      <label key={member?.id} className="rc-memberrow">
                        <input
                          type="checkbox"
                          checked={includedMemberIds?.includes(member?.id)}
                          onChange={() => toggleMember(member?.id)}
                        />
                        <span className="box">
                          {includedMemberIds?.includes(member?.id) && <Icon name="Check" size={11} />}
                        </span>
                        <span className="jm-avatar">
                          {member?.name?.split(' ')?.map(n => n?.[0])?.slice(0, 2)?.join('')}
                        </span>
                        <span className="name">{member?.name}</span>
                      </label>
                    ))
                  )}
                </div>
                <div className="rc-membermenu-foot">
                  {includedMemberIds?.length} of {members?.length} selected
                </div>
              </div>
            )}
          </div>
          {dayNames?.map((day, idx) => (
            <div key={day} className="rc-cell rc-headcell rc-daycol">
              <span className="rc-dayname">{day}</span>
              <span className="rc-daynum">{weekDates?.[idx]?.getDate()}</span>
            </div>
          ))}
        </div>

        {/* Loading state */}
        {loadingMembers && (
          <div className="jm-loading">
            <LogoSpinner size={24} className="mx-auto mb-2" />
            <p>Loading members…</p>
          </div>
        )}

        {/* Member rows */}
        {!loadingMembers && displayedMembers?.map(member => (
          <div key={member?.id} className="rc-row">
            <div className="rc-cell rc-namecell">
              <span className="jm-avatar lg">
                {member?.name?.split(' ')?.map(n => n?.[0])?.slice(0, 2)?.join('')}
              </span>
              <span className="rc-membername">{member?.name}</span>
            </div>
            {weekDates?.map((date, idx) => {
              // One cell, every duty set that person holds that day, listed by
              // name. The first one's colour tints the cell; each name carries
              // its own dot so a pairing stays readable.
              const cell = getAssignmentsForCell(member?.id, date);
              const entries = cell?.map(a => ({
                id: a?.id,
                name: getTemplateName(a?.duty_set_template_id),
                color: getTemplateColor(a?.duty_set_template_id, templates),
              }))?.filter(e => e?.name);
              const lead = entries?.[0]?.color;
              return (
                <div
                  key={idx}
                  onClick={() => handleDayClick(member?.id, date)}
                  className="rc-cell rc-daycell"
                  style={lead ? {
                    backgroundColor: lead?.bg,
                    borderLeft: `3px solid ${lead?.border}`,
                  } : undefined}
                  title={entries?.length
                    ? `${entries?.map(e => e?.name)?.join(' + ')} — click to change`
                    : `Assign duty to ${member?.name} on ${date?.toLocaleDateString(dateLocale())}`}
                >
                  {entries?.length > 0 ? (
                    <span className="rc-dutystack">
                      {entries?.map(e => (
                        <span key={e?.id} className="rc-dutyname" style={{ color: e?.color?.text }}>
                          {entries?.length > 1 && (
                            <span className="dot" style={{ background: e?.color?.border }} />
                          )}
                          {e?.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="rc-addhint"><Icon name="Plus" size={13} /></span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Empty state */}
        {!loadingMembers && displayedMembers?.length === 0 && (
          <div className="jm-empty">
            <div className="jm-empty-ico"><Icon name="Users" size={20} /></div>
            <p className="jm-empty-t">No members to display</p>
            <p className="jm-empty-s">
              {members?.length === 0
                ? 'No active members found in this department.'
                : 'Use the members button above to choose who appears here.'}
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
          currentAssignments={getAssignmentsForCell(assignModal?.memberId, assignModal?.date)}
          saving={savingAssignment}
          onClose={() => setAssignModal(null)}
          onToggle={handleToggleAssignment}
        />
      )}
    </div>
  );
};

// ── Duty Set Assignment Modal ──
// ── Duty Set Assignment Modal ──
// Multi-select: a person can hold more than one duty set on a day (stairs and
// bridge, say). Which pairing is up to the crew on the day, so nothing here is
// tied to a weekday — tick as many as apply.
const DutySetAssignModal = ({ member, date, templates, currentAssignments = [], saving, onClose, onToggle }) => {
  const dateLabel = date?.toLocaleDateString(dateLocale(), { weekday: 'long', month: 'long', day: 'numeric' });
  const selectedIds = (currentAssignments || [])?.map(a => a?.duty_set_template_id);
  const selectedNames = templates
    ?.filter(t => selectedIds?.includes(t?.id))
    ?.map(t => t?.name);

  return (
    <ModalShell onClose={onClose} isBusy={saving} panelClassName="jm-panel sm">
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Rotation</p>
          <h3 className="jm-title">Assign duty sets</h3>
          <p className="jm-sub">{member?.name} · {dateLabel}</p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <div className="jm-body">
        {templates?.length === 0 ? (
          <div className="jm-empty">
            <div className="jm-empty-ico"><Icon name="FileText" size={20} /></div>
            <p className="jm-empty-t">No templates yet</p>
            <p className="jm-empty-s">Create a duty set template for this department first.</p>
          </div>
        ) : (
          <>
            <p className="jm-hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Tick every duty set this person is covering. More than one is fine.
            </p>
            <div className="rc-picklist">
              {templates?.map((template, idx) => {
                const isSelected = selectedIds?.includes(template?.id);
                const color = TEMPLATE_COLORS?.[idx % TEMPLATE_COLORS?.length];
                return (
                  <button
                    key={template?.id}
                    onClick={() => onToggle(template?.id)}
                    disabled={saving}
                    className={`rc-pick${isSelected ? ' on' : ''}`}
                    style={isSelected ? { backgroundColor: color?.bg, borderColor: color?.border } : undefined}
                  >
                    <span className={`rc-pickbox${isSelected ? ' on' : ''}`}>
                      {isSelected && <Icon name="Check" size={11} />}
                    </span>
                    <span className="swatch" style={{ backgroundColor: color?.border }} />
                    <span className="main">
                      <span className="t" style={isSelected ? { color: color?.text } : undefined}>
                        {template?.name}
                      </span>
                      <span className="s">
                        {template?.category} · {template?.taskCount ?? template?.tasks?.length ?? 0} tasks
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="jm-foot">
        {saving ? (
          <span className="rc-saving">
            <span className="jm-spin sm" />
            Saving…
          </span>
        ) : (
          <>
            {selectedNames?.length > 0 && (
              <button className="jm-btn danger" onClick={() => onToggle(null)}>
                <Icon name="Trash2" size={15} />
                Clear day
              </button>
            )}
            <div className="spacer" />
            <button className="jm-btn primary" onClick={onClose}>
              {selectedNames?.length > 0 ? `Done · ${selectedNames?.join(' + ')}` : 'Done'}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
};

export default RotationCalendar;
