import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import SearchableAssigneeDropdown from './SearchableAssigneeDropdown';
import { DEPARTMENTS } from '../../../utils/authStorage';
import { notifyChiefsPendingAcceptance, notifyJobAssigned } from '../utils/notifications';
import { logActivity, JobActions } from '../../../utils/activityStorage';
import { normalizeTier, canAssignTo } from '../utils/tierPermissions';

import ModalShell from '../../../components/ui/ModalShell';
import '../job-modals.css';
import '../../duty-sets-rotation-management/duty-sets.css';
// Helper to normalize department names for comparison
const normalizeDept = (dept) => {
  return dept?.toUpperCase()?.trim() || '';
};

// Helper to trigger dashboard activity refresh
const triggerActivityRefresh = () => {
  window.dispatchEvent(new CustomEvent('activityUpdated'));
};

// Helper to match department option (case-insensitive)
const matchDepartmentOption = (userDept) => {
  if (!userDept) return '';
  const normalize = (str) => (str || '')?.trim()?.toUpperCase();
  const normalizedInput = normalize(userDept);
  const matched = DEPARTMENTS?.find(dept => normalize(dept) === normalizedInput);
  return matched || '';
};

const ComprehensiveJobModal = ({ boards, selectedDate, defaultBoardId, onClose, onSuccess, activeTenantId: activeTenantIdProp, currentUser: currentUserProp }) => {
  const { currentUser: currentUserFromHook, user: authUser, activeTenantId: activeTenantIdFromAuth } = useAuth();
  const { activeTenantId: activeTenantIdFromHook, currentTenantMember } = useTenant();

  // Use prop values as fallback when hook values are not yet available
  const currentUser = currentUserFromHook || currentUserProp;
  // Try all sources: TenantContext hook > prop passed from parent > AuthContext > localStorage direct
  const activeTenantId = activeTenantIdFromHook
    || activeTenantIdProp
    || activeTenantIdFromAuth
    || localStorage.getItem('activeTenantId')
    || localStorage.getItem('cargo_active_tenant_id')
    || null;
  // Supabase auth user id — always available when logged in via Supabase
  const supabaseUserId = authUser?.id || null;

  // ── Derive effective tier from TenantContext (same source as page) ──
  const currentUserTier = normalizeTier(currentTenantMember?.permission_tier) || 'VIEW_ONLY';
  const myTenantMember = currentTenantMember;

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);

  // ── Assignee list from Supabase ──
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [loadingAssignees, setLoadingAssignees] = useState(false);

  // ── Departments from Supabase ──
  const canSelectDept = ['COMMAND', 'CHIEF', 'HOD']?.includes(currentUserTier) ||
    ['command', 'chief', 'hod']?.includes((currentTenantMember?.permission_tier || '')?.toLowerCase());
  const [supabaseDepts, setSupabaseDepts] = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  // Selected department UUID — defaults to user's own department
  const [selectedDeptId, setSelectedDeptId] = useState(null);

  // Is a cross-department send (selected dept differs from own dept)
  const isCrossDeptSelected = canSelectDept && selectedDeptId && selectedDeptId !== myTenantMember?.department_id;

  // Cross-dept popover state
  const [showCrossDeptPopover, setShowCrossDeptPopover] = useState(false);

  // Helper: get department name from UUID
  const getDeptName = (deptId) => {
    if (!deptId) return '';
    const dept = supabaseDepts?.find(d => d?.id === deptId);
    return dept?.name || deptId;
  };

  const [formData, setFormData] = useState({
    title: '',description: '',department: '',
    boardId: defaultBoardId || boards?.[0]?.id || '',
    assignees: [],
    dueDate: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),dueTime: '09:00',priority: 'medium',
    checklists: [],
    recurrence: 'none',
    recurrenceWeekDays: [],
    recurrenceMonthDay: 1,
    dutySetId: '',dutySetName: '',
    attachments: [],
    initialComment: '',
    labels: [],
    internalNotes: '',visibility: 'crew-visible',autoCompleteOnChecklist: false,pendingReasonNotes: ''
  });

  // ── Effective department logic ──
  // COMMAND/CHIEF/HOD: uses selectedDeptId (UUID)
  // Others: locked to myTenantMember.department_id
  const effectiveDepartmentId = useMemo(() => {
    if (canSelectDept) {
      return selectedDeptId || myTenantMember?.department_id || null;
    }
    return myTenantMember?.department_id || null;
  }, [canSelectDept, selectedDeptId, myTenantMember?.department_id]);

  // ── Filter boards to only those belonging to the effective department ──
  const filteredBoards = useMemo(() => {
    if (!effectiveDepartmentId) return boards || [];
    const filtered = (boards || [])?.filter(b => b?.department_id === effectiveDepartmentId);
    return filtered?.length > 0 ? filtered : (boards || []);
  }, [boards, effectiveDepartmentId]);

  // ── Log debug info when modal opens ──
  useEffect(() => {
    console.log('[CREATE JOB MODAL] Opened');
    console.log('[CREATE JOB MODAL] currentTenantId:', activeTenantId);
    console.log('[CREATE JOB MODAL] myTenantMember:', myTenantMember);
    console.log('[CREATE JOB MODAL] currentUserTier:', currentUserTier);
    console.log('[CREATE JOB MODAL] canSelectDept:', canSelectDept);
    console.log('[CREATE JOB MODAL] selectedDeptId (UUID):', selectedDeptId);
    console.log('[CREATE JOB MODAL] myTenantMember.department_id:', myTenantMember?.department_id);
  }, []);

  // ── Fetch departments from Supabase ──
  useEffect(() => {
    if (!activeTenantId) return;
    setLoadingDepts(true);
    const fetchDepts = async () => {
      try {
        // First get department_ids from tenant_members for this tenant
        const { data: memberDepts } = await supabase
          ?.from('tenant_members')
          ?.select('department_id')
          ?.eq('tenant_id', activeTenantId)
          ?.not('department_id', 'is', null);
        const deptIds = [...new Set((memberDepts || [])?.map(m => m?.department_id)?.filter(Boolean))];
        if (deptIds?.length > 0) {
          const { data: deptRows, error: deptError } = await supabase
            ?.from('departments')
            ?.select('id, name')
            ?.in('id', deptIds)
            ?.order('name', { ascending: true });
          if (deptError) {
            console.error('[CREATE JOB MODAL] Error fetching departments:', deptError);
            setSupabaseDepts([]);
          } else {
            setSupabaseDepts(deptRows || []);
            // Set default selected department to user's own department
            if (!selectedDeptId && myTenantMember?.department_id) {
              setSelectedDeptId(myTenantMember?.department_id);
            }
          }
        } else {
          // Fallback: if no members found, just use user's own department
          if (myTenantMember?.department_id) {
            const { data: ownDept } = await supabase
              ?.from('departments')
              ?.select('id, name')
              ?.eq('id', myTenantMember?.department_id)
              ?.single();
            if (ownDept) setSupabaseDepts([ownDept]);
            if (!selectedDeptId) setSelectedDeptId(myTenantMember?.department_id);
          }
        }
      } catch (err) {
        console.warn('[CREATE JOB MODAL] fetchDepts error:', err);
        setSupabaseDepts([]);
      } finally {
        setLoadingDepts(false);
      }
    };
    fetchDepts();
  }, [activeTenantId, myTenantMember?.department_id, selectedDeptId]);

  // ── Set department default on mount ──
  useEffect(() => {
    if (currentUserTier !== 'COMMAND') {
      // Non-COMMAND: lock to their department
      const lockedDept = myTenantMember?.department_id || matchDepartmentOption(currentUser?.department) || '';
      setFormData(prev => ({ ...prev, department: lockedDept }));
    } else {
      // COMMAND: default to empty (they choose)
      const defaultDept = matchDepartmentOption(currentUser?.department);
      if (defaultDept) {
        setFormData(prev => ({ ...prev, department: defaultDept }));
      }
    }
  }, [currentUserTier, myTenantMember?.department_id, currentUser?.department]);

  // ── Fetch assignees from tenant_members + profiles ──
  const fetchAssignees = useCallback(async (deptId) => {
    if (!activeTenantId) return;

    console.log('[CREATE JOB MODAL] fetchAssignees called', { currentTenantId: activeTenantId, myTenantMember, selectedDepartmentId: deptId });
    setLoadingAssignees(true);
    try {
      // UUID validation helper — department_id column expects a UUID
      const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(val);

      // Determine department filter for RPC
      let deptFilter = null;
      if (currentUserTier === 'COMMAND') {
        if (deptId && isValidUUID(deptId)) {
          deptFilter = deptId;
        }
        // else: no dept filter — show all
      } else {
        // Non-COMMAND: always locked to own department
        const ownDept = myTenantMember?.department_id;
        if (ownDept && isValidUUID(ownDept)) {
          deptFilter = ownDept;
        }
      }

      // Use SECURITY DEFINER RPC to bypass tenant_members RLS
      // (RLS only allows SELECT of own row; RPC verifies membership then returns all)
      const { data: tmData, error: tmError } = await supabase?.rpc(
        'get_tenant_members_for_jobs',
        {
          p_tenant_id: activeTenantId,
          p_department_id: deptFilter ?? null
        }
      );

      if (tmError) {
        console.error('[CREATE JOB MODAL] tenant_members RPC error:', tmError);
        setAssigneeOptions([]);
        return;
      }

      if (!tmData || tmData?.length === 0) {
        console.warn('[CREATE JOB MODAL] Assignee list RPC returned 0 rows', {
          tenantId: activeTenantId,
          selectedDepartmentId: deptId,
          currentUserTier
        });
        setAssigneeOptions([]);
        return;
      }

      // Step 2: fetch profiles for these user_ids
      const userIds = tmData?.map(tm => tm?.user_id)?.filter(Boolean);
      const { data: profilesData, error: profilesError } = await supabase
        ?.from('profiles')?.select('id, full_name, first_name, last_name')?.in('id', userIds);

      if (profilesError) {
        console.error('[CREATE JOB MODAL] profiles query error:', profilesError);
      }

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
          department: tm?.department_id
        };
      });

      // Filter by canAssignTo tier rule
      const filtered = members?.filter(m => canAssignTo(m?.permission_tier, currentUserTier));

      console.log('[CREATE JOB MODAL] Assignees loaded:', filtered?.length, { selectedDepartmentId: deptId, currentUserTier });

      if (filtered?.length === 0) {
        console.warn('[CREATE JOB MODAL] 0 assignees after tier filter', {
          tenantId: activeTenantId,
          selectedDepartmentId: deptId,
          currentUserTier,
          rawMembersCount: members?.length
        });
      }

      setAssigneeOptions(filtered);
    } catch (err) {
      console.error('[CREATE JOB MODAL] Unexpected error fetching assignees:', err);
      setAssigneeOptions([]);
    } finally {
      setLoadingAssignees(false);
    }
  }, [activeTenantId, currentUserTier, myTenantMember?.department_id]);

  // ── Fetch assignees when effective department changes ──
  useEffect(() => {
    // Only fetch if user can assign
    if (currentUserTier === 'CREW' || currentUserTier === 'VIEW_ONLY') return;
    fetchAssignees(effectiveDepartmentId);
  }, [effectiveDepartmentId, fetchAssignees, currentUserTier]);

  // ── If CREW or private: force assigned_to = current user ──
  useEffect(() => {
    if (currentUserTier === 'CREW' || isPrivate) {
      const myUserId = currentUser?.id || myTenantMember?.user_id || supabaseUserId;
      if (myUserId) {
        setFormData(prev => ({ ...prev, assignees: [myUserId] }));
      }
    }
  }, [currentUserTier, isPrivate, currentUser?.id, myTenantMember?.user_id, supabaseUserId]);

  // Checklist management
  const [newChecklistName, setNewChecklistName] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [activeChecklistIndex, setActiveChecklistIndex] = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);

  // Department options for dropdown
  const departmentOptions = useMemo(() => {
    const options = DEPARTMENTS?.map(dept => ({
      value: dept,
      label: dept
    }));
    return [{ value: '', label: 'Select department' }, ...options];
  }, []);

  // Add this block - supabaseDeptOptions for department dropdown
  const supabaseDeptOptions = useMemo(() => {
    return [
      { value: '', label: 'Select department' },
      ...supabaseDepts?.map(dept => ({
        value: dept?.id,
        label: dept?.name
      }))
    ];
  }, [supabaseDepts]);

  // Determine button label based on role tier
  const getButtonLabel = () => {
    if (currentUserTier === 'CREW') return 'Submit Self-Reported Job';
    // Only show 'Send for Acceptance' when cross-department is selected
    if (isCrossDeptSelected) return 'Send for Acceptance';
    return 'Create Job';
  };

  const handleAddChecklist = () => {
    if (!newChecklistName?.trim()) return;
    setFormData(prev => ({
      ...prev,
      checklists: [...prev?.checklists, {
        id: crypto.randomUUID(),
        name: newChecklistName?.trim(),
        items: []
      }]
    }));
    setNewChecklistName('');
    setActiveChecklistIndex(formData?.checklists?.length);
  };

  const handleAddChecklistItem = (checklistIndex) => {
    if (!newChecklistItem?.trim()) return;
    setFormData(prev => {
      const updatedChecklists = [...prev?.checklists];
      updatedChecklists?.[checklistIndex]?.items?.push({
        id: crypto.randomUUID(),
        text: newChecklistItem?.trim(),
        completed: false
      });
      return { ...prev, checklists: updatedChecklists };
    });
    setNewChecklistItem('');
  };

  const handleRemoveChecklistItem = (checklistIndex, itemId) => {
    setFormData(prev => {
      const updatedChecklists = [...prev?.checklists];
      updatedChecklists[checklistIndex].items = updatedChecklists?.[checklistIndex]?.items?.filter(item => item?.id !== itemId);
      return { ...prev, checklists: updatedChecklists };
    });
  };

  const handleMoveChecklistItem = (checklistIndex, itemIndex, direction) => {
    setFormData(prev => {
      const updatedChecklists = [...prev?.checklists];
      const items = [...updatedChecklists?.[checklistIndex]?.items];
      const newIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
      if (newIndex < 0 || newIndex >= items?.length) return prev;
      [items[itemIndex], items[newIndex]] = [items?.[newIndex], items?.[itemIndex]];
      updatedChecklists[checklistIndex].items = items;
      return { ...prev, checklists: updatedChecklists };
    });
  };

  const handleRemoveChecklist = (checklistIndex) => {
    setFormData(prev => ({
      ...prev,
      checklists: prev?.checklists?.filter((_, idx) => idx !== checklistIndex)
    }));
    if (activeChecklistIndex === checklistIndex) setActiveChecklistIndex(null);
  };

  const handleAddLabel = () => {
    if (!newLabel?.trim() || formData?.labels?.includes(newLabel?.trim())) return;
    setFormData(prev => ({ ...prev, labels: [...prev?.labels, newLabel?.trim()] }));
    setNewLabel('');
  };

  const handleRemoveLabel = (label) => {
    setFormData(prev => ({ ...prev, labels: prev?.labels?.filter(l => l !== label) }));
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e?.target?.files || []);
    if (files?.length === 0) return;
    setUploadingFile(true);
    files?.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const attachment = {
          id: crypto.randomUUID(),
          name: file?.name,
          url: event?.target?.result,
          type: file?.type,
          size: file?.size
        };
        setFormData(prev => ({ ...prev, attachments: [...prev?.attachments, attachment] }));
        setUploadingFile(false);
      };
      reader?.readAsDataURL(file);
    });
  };

  const handleRemoveAttachment = (attachmentId) => {
    setFormData(prev => ({ ...prev, attachments: prev?.attachments?.filter(a => a?.id !== attachmentId) }));
  };

  const toggleAssignee = (userId) => {
    // CREW and private jobs: locked to self
    if (currentUserTier === 'CREW' || isPrivate) return;
    setFormData(prev => ({
      ...prev,
      assignees: prev?.assignees?.includes(userId)
        ? prev?.assignees?.filter(id => id !== userId)
        : [...prev?.assignees, userId]
    }));
  };

  const toggleWeekDay = (day) => {
    setFormData(prev => ({
      ...prev,
      recurrenceWeekDays: prev?.recurrenceWeekDays?.includes(day)
        ? prev?.recurrenceWeekDays?.filter(d => d !== day)
        : [...prev?.recurrenceWeekDays, day]
    }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setSubmitError(null);

    if (!formData?.title?.trim()) {
      setSubmitError('Job title is required');
      return;
    }

    // ── Early guard: require tenant and user context before proceeding ──
    const earlyUserId = currentUser?.id || currentTenantMember?.user_id || supabaseUserId;
    if (!activeTenantId || !earlyUserId) {
      setSubmitError('Missing tenant or user context. Please refresh and try again.');
      return;
    }

    // Use selectedDeptId (UUID) for COMMAND/CHIEF/HOD, fallback to myTenantMember dept
    const finalDeptId = canSelectDept
      ? (selectedDeptId || myTenantMember?.department_id || null)
      : (myTenantMember?.department_id || null);

    if (!finalDeptId && canSelectDept) {
      setSubmitError('Please select a department');
      return;
    }

    try {
      setIsSubmitting(true);

      const dueDateTime = new Date(formData?.dueDate);
      const [hours, minutes] = formData?.dueTime?.split(':');
      dueDateTime?.setHours(parseInt(hours), parseInt(minutes));

      const flatChecklist = formData?.checklists?.flatMap(cl =>
        cl?.items?.map(item => ({ ...item, checklistName: cl?.name }))
      ) || [];

      // Cross-dept: selected dept differs from own dept (UUID comparison)
      const isCrossDept = isCrossDeptSelected;

      let finalStatus = 'active';
      let finalDepartment = finalDeptId;
      let finalAssignees = formData?.assignees || [];
      let pendingForDepartment = null;
      let pendingReasonNotes = null;

      // ── Determine final assigned_to ──
      const myUserId = currentUser?.id || myTenantMember?.user_id || supabaseUserId;

      if (currentUserTier === 'COMMAND') {
        if (isCrossDept) {
          // COMMAND cross-dept: also send for acceptance (receiving chief decides assignment)
          finalStatus = 'pending_acceptance';
          finalDepartment = finalDeptId;
          finalAssignees = [];
          pendingForDepartment = finalDeptId;
          pendingReasonNotes = formData?.pendingReasonNotes || formData?.initialComment || null;
        } else {
          finalStatus = 'active';
          finalDepartment = finalDeptId;
          finalAssignees = isPrivate ? [myUserId] : (formData?.assignees || []);
        }
      } else if (currentUserTier === 'CHIEF' || currentUserTier === 'HOD') {
        if (isCrossDept) {
          finalStatus = 'pending_acceptance';
          finalDepartment = finalDeptId;
          finalAssignees = [];
          pendingForDepartment = finalDeptId;
          pendingReasonNotes = formData?.pendingReasonNotes || formData?.initialComment || null;
        } else {
          finalStatus = 'active';
          finalDepartment = finalDeptId;
          finalAssignees = isPrivate ? [myUserId] : (formData?.assignees || []);
        }
      } else {
        // CREW / VIEW_ONLY: always self-assigned, pending_acceptance
        finalStatus = 'pending_acceptance';
        finalDepartment = myTenantMember?.department_id || currentUser?.department;
        finalAssignees = [myUserId];
        pendingForDepartment = finalDepartment;
        pendingReasonNotes = formData?.pendingReasonNotes || formData?.initialComment || null;
      }

      const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(val);
      const boardId = formData?.boardId || null;
      const assignedTo = finalAssignees?.[0] || null;

      // ── Add this block: Insert job into Supabase ──
      const { data: insertedJob, error: insertError } = await supabase?.from('team_jobs')?.insert({
          tenant_id: activeTenantId,
          title: formData?.title?.trim(),
          description: formData?.description?.trim() || null,
          department_id: finalDepartment,
          assigned_to: assignedTo,
          created_by: myUserId,
          due_date: dueDateTime?.toISOString()?.split('T')?.[0] || null,
          status: finalStatus,
          is_private: isPrivate,
          visible_to_user_id: isPrivate ? myUserId : null,
          source_department_id: isCrossDept ? (myTenantMember?.department_id || null) : null,
          target_department_id: isCrossDept ? finalDeptId : null,
          cross_dept_status: isCrossDept ? 'PENDING_ACCEPTANCE' : 'NONE',
          metadata: []
        })?.select()?.single();

      if (insertError) {
        throw new Error(insertError?.message || 'Failed to create job');
      }

      if (!insertedJob) {
        throw new Error('Job creation returned no data');
      }
      // ── End of added block ──

      // Build the card object from the Supabase response
      const newCard = {
        ...insertedJob,
        supabase_id: insertedJob?.id,
        board: insertedJob?.board_id || boardId,
        boardId: insertedJob?.board_id || boardId,
        department: insertedJob?.department_id || finalDepartment,
        department_id: insertedJob?.department_id || finalDepartment,
        assigned_to: insertedJob?.assigned_to,
        assignees: finalAssignees,
        type: 'task',
        dueDate: insertedJob?.due_date || formData?.dueDate,
        checklist: flatChecklist,
        notes: formData?.initialComment?.trim() ? [{
          id: crypto.randomUUID(),
          text: formData?.initialComment,
          author: currentUser?.name,
          authorId: myUserId,
          timestamp: new Date()?.toISOString()
        }] : [],
        pendingForDepartment,
        sourceDepartment: myTenantMember?.department_id || null,
        pendingReasonNotes,
        isPrivate,
        private: isPrivate,
        recurrenceConfig: formData?.recurrence !== 'none' ? {
          type: formData?.recurrence,
          weekDays: formData?.recurrenceWeekDays,
          monthDay: formData?.recurrenceMonthDay
        } : null
      };

      // Notifications
      if (currentUserTier === 'COMMAND') {
        if (finalStatus === 'pending_acceptance') {
          notifyChiefsPendingAcceptance(finalDepartment, newCard?.title, newCard?.id, newCard?.dueDate);
        } else if (finalAssignees?.length > 0) {
          notifyJobAssigned(finalAssignees, newCard?.title, newCard?.id, newCard?.dueDate);
        }
      } else if (finalStatus === 'pending_acceptance') {
        notifyChiefsPendingAcceptance(finalDepartment, newCard?.title, newCard?.id, newCard?.dueDate);
      } else {
        if (finalAssignees?.length > 0) notifyJobAssigned(finalAssignees, newCard?.title, newCard?.id, newCard?.dueDate);
      }

      logActivity({
        module: 'jobs',
        action: JobActions?.JOB_CREATED,
        entityType: 'job',
        entityId: newCard?.id,
        actorUserId: myUserId,
        actorName: currentUser?.roleTitle || currentUser?.fullName || currentUser?.name || 'Unknown User',
        actorDepartment: finalDepartment || 'UNKNOWN',
        actorRoleTier: currentUserTier,
        departmentScope: finalDepartment,
        summary: `${currentUser?.roleTitle || currentUser?.fullName || currentUser?.name || 'User'} created job: ${newCard?.title}`
      });

      onSuccess(newCard);

      let successMessage = 'Job created.';
      if (newCard?.status === 'pending_acceptance') {
        const targetDeptName = getDeptName(newCard?.pendingForDepartment) || newCard?.pendingForDepartment || 'Department';
        successMessage = `Sent to ${targetDeptName} Chief for acceptance.`;
      }
      if (window.showToast) window.showToast(successMessage, 'success');
      else alert(successMessage);

      setIsSubmitting(false);
      onClose();
    } catch (error) {
      console.error('[JOB CREATE ERROR]', error);
      const errorMessage = `Could not create job${error?.message ? ': ' + error?.message : ''}`;
      setSubmitError(errorMessage);
      if (window.showToast) window.showToast(errorMessage, 'error');
      else alert(errorMessage);
      setIsSubmitting(false);
    }
  };

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' }
  ];

  // ── Tier-based UI flags ──
  const isCommand = currentUserTier === 'COMMAND';
  const isChiefOrHOD = currentUserTier === 'CHIEF' || currentUserTier === 'HOD';
  const isCrew = currentUserTier === 'CREW';
  const isViewOnly = currentUserTier === 'VIEW_ONLY';
  const canShowAssignee = (isCommand || isChiefOrHOD) && !isCrossDeptSelected;
  const isDeptLocked = !canSelectDept;
  // non-COMMAND cannot change department

  return (
    <ModalShell
      onClose={onClose}
      isBusy={isSubmitting}
      isDirty={!!formData?.title?.trim()}
      panelClassName="jm-panel xl"
    >
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Jobs</p>
          <h2 className="jm-title">Create a job</h2>
          <p className="jm-sub">
            {selectedDate ? format(selectedDate, 'EEEE dd/MM/yyyy') : 'Every field, for a fully specified job.'}
          </p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="jm-body" id="tj-comprehensive-form">
        {submitError && (
          <div className="jm-section">
            <div className="jm-notice danger">
              <Icon name="AlertCircle" size={15} />
              <span><strong>Couldn’t save.</strong> {submitError}</span>
            </div>
          </div>
        )}

        {isViewOnly && (
          <div className="jm-section">
            <div className="jm-notice warn">
              <Icon name="Lock" size={15} />
              <span>You have view-only access and cannot create jobs.</span>
            </div>
          </div>
        )}

        {/* ── Core ── */}
        <p className="jm-secthead">
          <Icon name="FileText" size={14} />
          Core information
        </p>

        <div className="jm-section">
          <label className="jm-label" htmlFor="cjm-title">
            Job title<span className="req">required</span>
          </label>
          <input
            id="cjm-title"
            autoFocus
            type="text"
            className="jm-titlefield"
            placeholder="What needs doing?"
            value={formData?.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
            disabled={isViewOnly}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="cjm-desc">
            Description &amp; notes<span className="opt">optional</span>
          </label>
          <textarea
            id="cjm-desc"
            className="jm-textarea"
            rows={4}
            placeholder="Any detail the crew will need"
            value={formData?.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
            disabled={isViewOnly}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="cjm-dept">
            Department<span className="req">required</span>
          </label>
          {canSelectDept ? (
            loadingDepts ? (
              <div className="jm-readonly muted">Loading departments…</div>
            ) : (
              <select
                id="cjm-dept"
                className="jm-select"
                value={selectedDeptId || ''}
                onChange={(e) => {
                  setSelectedDeptId(e?.target?.value);
                  setFormData(prev => ({ ...prev, assignees: [], boardId: '' }));
                  setShowCrossDeptPopover(false);
                }}
              >
                <option value="">Select department…</option>
                {supabaseDeptOptions?.map(o => (
                  <option key={o?.value} value={o?.value}>{o?.label}</option>
                ))}
              </select>
            )
          ) : (
            <div className="jm-readonly">
              <span>{getDeptName(myTenantMember?.department_id) || 'Your department'}</span>
              <span className="note">locked to your department</span>
            </div>
          )}
        </div>

        {/* Cross-department send */}
        {isCrossDeptSelected && (
          <div className="jm-section">
            <button
              type="button"
              onClick={() => setShowCrossDeptPopover(prev => !prev)}
              className="cjm-crossdept"
            >
              <Icon name="Send" size={16} />
              <span className="main">
                <span className="t">
                  Cross-department job — send to the {getDeptName(selectedDeptId)} chief
                </span>
                <span className="s">Add notes and confirm before sending for acceptance</span>
              </span>
              <Icon name={showCrossDeptPopover ? 'ChevronUp' : 'ChevronDown'} size={16} />
            </button>

            {showCrossDeptPopover && (
              <div className="cjm-crossdept-panel">
                <div className="jm-notice warn">
                  <Icon name="AlertTriangle" size={15} />
                  <span>
                    This job goes to the <strong>{getDeptName(selectedDeptId)}</strong> chief for
                    acceptance. They decide who it is assigned to.
                  </span>
                </div>
                <div style={{ marginTop: 14 }}>
                  <label className="jm-label" htmlFor="cjm-pending-notes">
                    Notes for the receiving chief<span className="opt">optional</span>
                  </label>
                  <textarea
                    id="cjm-pending-notes"
                    className="jm-textarea"
                    rows={3}
                    placeholder={`Context or instructions for the ${getDeptName(selectedDeptId)} chief`}
                    value={formData?.pendingReasonNotes}
                    onChange={(e) => setFormData(prev => ({ ...prev, pendingReasonNotes: e?.target?.value }))}
                  />
                </div>
                <p className="jm-hint">
                  The job is created with status <strong>Pending acceptance</strong>.
                </p>
              </div>
            )}
          </div>
        )}

        {!isCrossDeptSelected && (
          <div className="jm-section">
            <label className="jm-label" htmlFor="cjm-board">
              Board<span className="req">required</span>
            </label>
            <select
              id="cjm-board"
              className="jm-select"
              value={formData?.boardId || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, boardId: e?.target?.value }))}
            >
              <option value="">Select board…</option>
              {filteredBoards?.map(b => {
                const deptId = effectiveDepartmentId;
                const displayName = (deptId && b?.names?.[deptId]) ? b?.names?.[deptId] : (b?.name || 'Board');
                return <option key={b?.id} value={b?.id}>{displayName}</option>;
              })}
            </select>
          </div>
        )}

        {canShowAssignee && (
          <div className="jm-section">
            <label className="jm-label">
              Assign to
              {effectiveDepartmentId && <span className="opt">{getDeptName(effectiveDepartmentId)}</span>}
            </label>
            {isPrivate ? (
              <div className="jm-readonly muted">Private job — assigned to you automatically</div>
            ) : loadingAssignees ? (
              <div className="jm-readonly muted">Loading team members…</div>
            ) : assigneeOptions?.length === 0 ? (
              <div className="jm-readonly muted">
                {effectiveDepartmentId
                  ? 'No eligible crew in this department'
                  : 'Select a department first to load assignees'}
              </div>
            ) : (
              <SearchableAssigneeDropdown
                crewMembers={assigneeOptions}
                selectedAssignees={formData?.assignees}
                onChange={(assignees) => setFormData(prev => ({ ...prev, assignees }))}
                department={effectiveDepartmentId}
              />
            )}
          </div>
        )}

        {isCrew && (
          <div className="jm-section">
            <div className="jm-notice info">
              <Icon name="Info" size={15} />
              <span>Crew can’t assign jobs — create a private job for yourself.</span>
            </div>
          </div>
        )}

        {/* Private toggle */}
        <div className="jm-section">
          <div className="jm-toggle-row">
            <div>
              <p className="jm-toggle-t">Private job</p>
              <p className="jm-toggle-s">
                {isPrivate
                  ? 'Only you will see this job — assigned to you automatically.'
                  : 'Make this job private and self-assigned.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              onClick={() => {
                const next = !isPrivate;
                setIsPrivate(next);
                if (next) {
                  const myUserId = currentUser?.id || myTenantMember?.user_id || supabaseUserId;
                  setFormData(prev => ({ ...prev, assignees: myUserId ? [myUserId] : [] }));
                }
              }}
              className={`jm-switch${isPrivate ? ' on' : ''}`}
            >
              <span className="knob" />
            </button>
          </div>
        </div>

        <div className="jm-section jm-grid">
          <div>
            <label className="jm-label" htmlFor="cjm-due">
              Due date<span className="req">required</span>
            </label>
            <input
              id="cjm-due"
              type="date"
              className="jm-input"
              value={formData?.dueDate}
              onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e?.target?.value }))}
            />
          </div>
          <div>
            <label className="jm-label" htmlFor="cjm-time">
              Time<span className="opt">optional</span>
            </label>
            <input
              id="cjm-time"
              type="time"
              className="jm-input"
              value={formData?.dueTime}
              onChange={(e) => setFormData(prev => ({ ...prev, dueTime: e?.target?.value }))}
            />
          </div>
        </div>

        <div className="jm-section">
          <p className="jm-label">
            Priority<span className="req">required</span>
          </p>
          <div className="jm-pills">
            {priorityOptions?.map(o => (
              <button
                key={o?.value}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, priority: o?.value }))}
                className={`jm-pill${formData?.priority === o?.value ? ' on' : ''}`}
              >
                {o?.label}
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
                setFormData(prev => ({
                  ...prev,
                  checklists: [...prev?.checklists, { id: crypto.randomUUID(), name: name?.trim(), items: [] }],
                }));
                setActiveChecklistIndex(formData?.checklists?.length);
              }
            }}
          >
            <Icon name="Plus" size={14} />
            Add checklist
          </button>
        </div>

        {formData?.checklists?.map((checklist, checklistIndex) => (
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

        {formData?.checklists?.length > 0 && (
          <label className="jm-check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={formData?.autoCompleteOnChecklist}
              onChange={(e) => setFormData(prev => ({ ...prev, autoCompleteOnChecklist: e?.target?.checked }))}
            />
            <span className="box"><Icon name="Check" size={11} /></span>
            Complete the job automatically when every checklist item is done
          </label>
        )}

        <hr className="jm-rule" />

        {/* ── Recurrence ── */}
        <p className="jm-secthead">
          <Icon name="Repeat" size={14} />
          Recurrence
        </p>
        <div className="jm-section">
          <label className="jm-label" htmlFor="cjm-recur">Repeat</label>
          <select
            id="cjm-recur"
            className="jm-select"
            value={formData?.recurrence || 'none'}
            onChange={(e) => setFormData(prev => ({ ...prev, recurrence: e?.target?.value }))}
          >
            <option value="none">None (one-time job)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {formData?.recurrence === 'weekly' && (
          <div className="jm-section">
            <p className="jm-label">Days of the week</p>
            <div className="jm-pills">
              {weekDays?.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWeekDay(day?.toLowerCase())}
                  className={`jm-pill${formData?.recurrenceWeekDays?.includes(day?.toLowerCase()) ? ' on' : ''}`}
                >
                  {day?.substring(0, 3)}
                </button>
              ))}
            </div>
          </div>
        )}
        {formData?.recurrence === 'monthly' && (
          <div className="jm-section">
            <label className="jm-label" htmlFor="cjm-monthday">Day of the month</label>
            <input
              id="cjm-monthday"
              type="number"
              min="1"
              max="31"
              className="jm-input"
              style={{ width: 110 }}
              value={formData?.recurrenceMonthDay}
              onChange={(e) => setFormData(prev => ({ ...prev, recurrenceMonthDay: parseInt(e?.target?.value) || 1 }))}
            />
          </div>
        )}

        {/* ── Duty set ── */}
        {!isCrossDeptSelected && (
          <>
            <hr className="jm-rule" />
            <p className="jm-secthead">
              <Icon name="Briefcase" size={14} />
              Duty set
            </p>
            <div className="jm-section">
              <label className="jm-label" htmlFor="cjm-dutyset">
                Duty set name<span className="opt">optional</span>
              </label>
              <input
                id="cjm-dutyset"
                type="text"
                className="jm-input"
                placeholder="e.g. Morning duties"
                value={formData?.dutySetName}
                onChange={(e) => setFormData(prev => ({ ...prev, dutySetName: e?.target?.value }))}
              />
              <p className="jm-hint">Links this job to a grouped operational duty.</p>
            </div>
          </>
        )}

        <hr className="jm-rule" />

        {/* ── Attachments ── */}
        <p className="jm-secthead">
          <Icon name="Paperclip" size={14} />
          Attachments
        </p>
        <div className="jm-section">
          <input
            type="file"
            id="file-upload"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <label htmlFor="file-upload" className="jm-drop">
            <span className="jm-drop-ico">
              {uploadingFile ? <span className="jm-spin sm" /> : <Icon name="Upload" size={18} />}
            </span>
            <span className="jm-drop-t">{uploadingFile ? 'Uploading…' : 'Click to upload files'}</span>
            <span className="jm-drop-s">Images, PDFs or documents</span>
          </label>
          {formData?.attachments?.length > 0 && (
            <div className="jm-filelist">
              {formData?.attachments?.map(attachment => (
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

        {/* ── Initial comment ── */}
        <p className="jm-secthead">
          <Icon name="MessageSquare" size={14} />
          Initial comment
        </p>
        <div className="jm-section">
          <textarea
            className="jm-textarea"
            rows={3}
            placeholder="Add an opening comment or handover note"
            value={formData?.initialComment}
            onChange={(e) => setFormData(prev => ({ ...prev, initialComment: e?.target?.value }))}
          />
        </div>

        <hr className="jm-rule" />

        {/* ── Advanced ── */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="jm-disclosure"
        >
          <span className="jm-secthead">
            <Icon name="Settings" size={14} />
            Advanced options
          </span>
          <Icon name={showAdvanced ? 'ChevronUp' : 'ChevronDown'} size={15} />
        </button>

        {showAdvanced && (
          <div className="jm-disclosure-body">
            <div className="jm-section">
              <label className="jm-label" htmlFor="cjm-label">
                Labels &amp; tags<span className="opt">optional</span>
              </label>
              <div className="dsr-inlineadd" style={{ marginTop: 0 }}>
                <input
                  id="cjm-label"
                  type="text"
                  className="jm-input"
                  placeholder="Add a label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e?.target?.value)}
                  onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddLabel(); } }}
                />
                <button type="button" className="jm-btn accent sm" onClick={handleAddLabel}>Add</button>
              </div>
              {formData?.labels?.length > 0 && (
                <div className="jm-pills" style={{ marginTop: 10 }}>
                  {formData?.labels?.map(label => (
                    <span key={label} className="jm-tag accent">
                      {label}
                      <span
                        role="button"
                        tabIndex={-1}
                        title="Remove label"
                        onClick={() => handleRemoveLabel(label)}
                        style={{ display: 'flex', cursor: 'pointer' }}
                      >
                        <Icon name="X" size={10} />
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="jm-section">
              <label className="jm-label" htmlFor="cjm-internal">
                Internal reference<span className="opt">command &amp; chief only</span>
              </label>
              <textarea
                id="cjm-internal"
                className="jm-textarea"
                rows={2}
                placeholder="Private notes, visible only to Command and Chief"
                value={formData?.internalNotes}
                onChange={(e) => setFormData(prev => ({ ...prev, internalNotes: e?.target?.value }))}
              />
            </div>

            <div className="jm-section">
              <label className="jm-label" htmlFor="cjm-visibility">Visibility</label>
              <select
                id="cjm-visibility"
                className="jm-select"
                value={formData?.visibility || 'crew-visible'}
                onChange={(e) => setFormData(prev => ({ ...prev, visibility: e?.target?.value }))}
              >
                <option value="crew-visible">Crew visible</option>
                <option value="internal">Internal only (Command &amp; Chief)</option>
              </select>
            </div>
          </div>
        )}
      </form>

      <div className="jm-foot">
        <button type="button" className="jm-btn ghost" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </button>
        <div className="spacer" />
        <button
          type="submit"
          form="tj-comprehensive-form"
          className="jm-btn primary"
          onClick={handleSubmit}
          disabled={!formData?.title?.trim() || isSubmitting || isViewOnly}
        >
          {isSubmitting ? <span className="jm-spin sm" /> : <Icon name="Plus" size={15} />}
          {isSubmitting ? 'Saving…' : getButtonLabel()}
        </button>
      </div>
    </ModalShell>
  );
};


export default ComprehensiveJobModal;