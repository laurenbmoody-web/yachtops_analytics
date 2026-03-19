import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import SearchableAssigneeDropdown from './SearchableAssigneeDropdown';
import { DEPARTMENTS } from '../../../utils/authStorage';
import { notifyChiefsPendingAcceptance, notifyJobAssigned } from '../utils/notifications';
import { logActivity, JobActions } from '../../../utils/activityStorage';
import { normalizeTier, canAssignTo } from '../utils/tierPermissions';

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
        ?.from('profiles')?.select('id, full_name, first_name, last_name, email')?.in('id', userIds);

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
          p?.email ||
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e?.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border bg-card sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Create New Job</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {selectedDate ? format(selectedDate, 'EEEE, MMMM d, yyyy') : 'Full feature job creation'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Form - Scrollable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error Display */}
          {submitError && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
                <Icon name="AlertCircle" size={16} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Error</p>
                  <p className="text-xs mt-1">{submitError}</p>
                </div>
              </div>
            </div>
          )}

          {/* VIEW_ONLY notice */}
          {isViewOnly && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                <Icon name="Lock" size={16} className="flex-shrink-0 mt-0.5" />
                <p className="text-sm">You have view-only access and cannot create jobs.</p>
              </div>
            </div>
          )}

          {/* ========== CORE FIELDS ========== */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="FileText" size={16} />
              Core Information
            </h3>

            {/* Title */}
            <Input
              label="Job Title"
              required
              value={formData?.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
              placeholder="Enter job title"
              disabled={isViewOnly}
            />

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Description / Notes</label>
              <textarea
                value={formData?.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
                placeholder="Add detailed description or notes"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-smooth"
                rows={4}
                disabled={isViewOnly}
              />
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Department *
              </label>
              {canSelectDept ? (
                loadingDepts ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">
                    Loading departments...
                  </div>
                ) : (
                  <Select
                    value={selectedDeptId || ''}
                    onChange={(value) => {
                      setSelectedDeptId(value);
                      setFormData(prev => ({ ...prev, assignees: [], boardId: '' }));
                      setShowCrossDeptPopover(false);
                    }}
                    options={supabaseDeptOptions}
                    placeholder="Select department"
                  />
                )
              ) : (
                <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-foreground">
                  {getDeptName(myTenantMember?.department_id) || 'Your Department'}
                  <span className="text-xs text-muted-foreground ml-2">(locked to your department)</span>
                </div>
              )}
            </div>

            {/* Cross-department popover trigger + popover */}
            {isCrossDeptSelected && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCrossDeptPopover(prev => !prev)}
                  className="w-full flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/15 transition-colors text-left"
                >
                  <Icon name="Send" size={16} className="text-amber-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      Cross-Department Job — Send to <strong>{getDeptName(selectedDeptId)}</strong> Chief
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                      Click to add notes and confirm sending for acceptance
                    </p>
                  </div>
                  <Icon name={showCrossDeptPopover ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-amber-500 shrink-0" />
                </button>

                {showCrossDeptPopover && (
                  <div className="mt-2 p-4 bg-card border border-amber-500/40 rounded-lg shadow-lg space-y-3">
                    <div className="flex items-start gap-2">
                      <Icon name="AlertTriangle" size={16} className="text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        This job will be sent to the <strong>{getDeptName(selectedDeptId)}</strong> Chief for acceptance. The receiving Chief will decide who it is assigned to.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">
                        Notes for Receiving Chief <span className="text-xs text-muted-foreground">(Optional)</span>
                      </label>
                      <textarea
                        value={formData?.pendingReasonNotes}
                        onChange={(e) => setFormData(prev => ({ ...prev, pendingReasonNotes: e?.target?.value }))}
                        placeholder={`Add context or instructions for the ${getDeptName(selectedDeptId)} Chief`}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-smooth"
                        rows={3}
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-muted-foreground">
                        Job will be created with status: <span className="font-medium text-amber-600">Pending Acceptance</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowCrossDeptPopover(false)}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                      >
                        Collapse
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Board Selection */}
{!isCrossDeptSelected && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Board *</label>
              <Select
                value={formData?.boardId}
                onChange={(value) => setFormData(prev => ({ ...prev, boardId: value }))}
                options={filteredBoards?.map(b => {
                  // Use department-scoped board name if available
                  const deptId = effectiveDepartmentId;
                  const displayName = (deptId && b?.names?.[deptId]) ? b?.names?.[deptId] : (b?.name || 'Board');
                  return { value: b?.id, label: displayName };
                })}
              />
            </div>
)}

            {/* Assign To — COMMAND and CHIEF/HOD only, hidden for cross-dept */}
            {canShowAssignee && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Assign To {effectiveDepartmentId && `(${getDeptName(effectiveDepartmentId)})`}
                </label>
                {isPrivate ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">
                    Private job — assigned to you automatically
                  </div>
                ) : loadingAssignees ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">
                    Loading team members...
                  </div>
                ) : assigneeOptions?.length === 0 ? (
                  <div className="px-3 py-2 bg-muted rounded-lg border border-border text-sm text-muted-foreground">
                    {effectiveDepartmentId
                      ? 'No eligible crew in this department' : 'Select a department first to load assignees'}
                  </div>
                ) : (
                  <SearchableAssigneeDropdown
                    crewMembers={assigneeOptions}
                    selectedAssignees={formData?.assignees}
                    onChange={(assignees) => {
                      setFormData(prev => ({ ...prev, assignees }));
                    }}
                    department={effectiveDepartmentId}
                  />
                )}
              </div>
            )}

            {/* CREW: cannot assign, show helper text */}
            {isCrew && (
              <div className="px-3 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <Icon name="Info" size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Crew can't assign jobs — create a private job for yourself.
                  </p>
                </div>
              </div>
            )}

            {/* Private Toggle — available to all tiers (in core section for visibility) */}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border">
              <div>
                <label className="text-sm font-medium text-foreground">Private Job</label>
                <p className="text-xs text-muted-foreground mt-1">
                  {isPrivate
                    ? 'Only you will see this job — assigned to you automatically' :'Toggle to make this job private and self-assigned'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !isPrivate;
                  setIsPrivate(next);
                  if (next) {
                    const myUserId = currentUser?.id || myTenantMember?.user_id || supabaseUserId;
                    setFormData(prev => ({ ...prev, assignees: myUserId ? [myUserId] : [] }));
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  isPrivate ? 'bg-primary' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isPrivate ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Due Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Due Date"
                type="date"
                required
                value={formData?.dueDate}
                onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e?.target?.value }))}
              />
              <Input
                label="Time (Optional)"
                type="time"
                value={formData?.dueTime}
                onChange={(e) => setFormData(prev => ({ ...prev, dueTime: e?.target?.value }))}
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Priority / Importance *</label>
              <Select
                value={formData?.priority}
                onChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}
                options={priorityOptions}
              />
            </div>
          </div>

          {/* ========== CHECKLISTS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="CheckSquare" size={16} />
                Checklists
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                iconName="Plus"
                onClick={() => {
                  const name = prompt('Checklist name:');
                  if (name?.trim()) {
                    setFormData(prev => ({
                      ...prev,
                      checklists: [...prev?.checklists, {
                        id: crypto.randomUUID(),
                        name: name?.trim(),
                        items: []
                      }]
                    }));
                    setActiveChecklistIndex(formData?.checklists?.length);
                  }
                }}
              >
                Add Checklist
              </Button>
            </div>

            {formData?.checklists?.map((checklist, checklistIndex) => (
              <div key={checklist?.id} className="bg-background rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-foreground">{checklist?.name}</h4>
                  <button
                    type="button"
                    onClick={() => handleRemoveChecklist(checklistIndex)}
                    className="p-1 hover:bg-red-500/10 rounded transition-smooth"
                  >
                    <Icon name="Trash2" size={14} className="text-red-500" />
                  </button>
                </div>
                <div className="space-y-2">
                  {checklist?.items?.map((item, itemIndex) => (
                    <div key={item?.id} className="flex items-center gap-2 bg-card p-2 rounded-lg">
                      <Checkbox checked={item?.completed} disabled />
                      <span className="flex-1 text-sm text-foreground">{item?.text}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'up')} disabled={itemIndex === 0} className="p-1 hover:bg-muted rounded disabled:opacity-30">
                          <Icon name="ChevronUp" size={14} />
                        </button>
                        <button type="button" onClick={() => handleMoveChecklistItem(checklistIndex, itemIndex, 'down')} disabled={itemIndex === checklist?.items?.length - 1} className="p-1 hover:bg-muted rounded disabled:opacity-30">
                          <Icon name="ChevronDown" size={14} />
                        </button>
                        <button type="button" onClick={() => handleRemoveChecklistItem(checklistIndex, item?.id)} className="p-1 hover:bg-red-500/10 rounded">
                          <Icon name="X" size={14} className="text-red-500" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Add checklist item"
                    value={activeChecklistIndex === checklistIndex ? newChecklistItem : ''}
                    onChange={(e) => { setNewChecklistItem(e?.target?.value); setActiveChecklistIndex(checklistIndex); }}
                    onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddChecklistItem(checklistIndex); } }}
                  />
                  <Button type="button" size="sm" onClick={() => handleAddChecklistItem(checklistIndex)} disabled={!newChecklistItem?.trim() || activeChecklistIndex !== checklistIndex}>
                    Add
                  </Button>
                </div>
              </div>
            ))}

            {formData?.checklists?.length > 0 && (
              <Checkbox
                label="Auto-complete card when all checklist items are complete"
                checked={formData?.autoCompleteOnChecklist}
                onChange={(e) => setFormData(prev => ({ ...prev, autoCompleteOnChecklist: e?.target?.checked }))}
              />
            )}
          </div>

          {/* ========== RECURRENCE ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="Repeat" size={16} />
              Recurrence
            </h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Repeat</label>
              <Select
                value={formData?.recurrence}
                onChange={(value) => setFormData(prev => ({ ...prev, recurrence: value }))}
                options={[
                  { value: 'none', label: 'None (One-time job)' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' }
                ]}
              />
            </div>
            {formData?.recurrence === 'weekly' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Select Day(s) of Week</label>
                <div className="grid grid-cols-4 gap-2">
                  {weekDays?.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekDay(day?.toLowerCase())}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium transition-smooth ${
                        formData?.recurrenceWeekDays?.includes(day?.toLowerCase())
                          ? 'border-primary bg-primary/10 text-primary' :'border-border text-foreground hover:border-primary/50'
                      }`}
                    >
                      {day?.substring(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {formData?.recurrence === 'monthly' && (
              <Input
                label="Day of Month"
                type="number"
                min="1"
                max="31"
                value={formData?.recurrenceMonthDay}
                onChange={(e) => setFormData(prev => ({ ...prev, recurrenceMonthDay: parseInt(e?.target?.value) || 1 }))}
              />
            )}
          </div>

          {/* ========== DUTY SET ========== */}
          {!isCrossDeptSelected && (
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="Briefcase" size={16} />
              Duty Set (Optional)
            </h3>
            <Input
              label="Duty Set Name"
              placeholder="e.g., Morning Duties"
              value={formData?.dutySetName}
              onChange={(e) => setFormData(prev => ({ ...prev, dutySetName: e?.target?.value }))}
              description="Link this job to a grouped operational duty"
            />
          </div>
          )}

          {/* ========== ATTACHMENTS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="Paperclip" size={16} />
              Attachments
            </h3>
            <div>
              <input type="file" id="file-upload" multiple accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileUpload} className="hidden" />
              <label htmlFor="file-upload">
                <Button type="button" variant="outline" iconName="Upload" onClick={() => document.getElementById('file-upload')?.click()} loading={uploadingFile}>
                  Upload Files
                </Button>
              </label>
            </div>
            {formData?.attachments?.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {formData?.attachments?.map(attachment => (
                  <div key={attachment?.id} className="relative bg-background rounded-lg border border-border p-3 flex items-center gap-3">
                    {attachment?.type?.startsWith('image/') ? (
                      <img src={attachment?.url} alt={attachment?.name} className="w-12 h-12 rounded object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                        <Icon name="File" size={20} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{attachment?.name}</p>
                      <p className="text-xs text-muted-foreground">{(attachment?.size / 1024)?.toFixed(1)} KB</p>
                    </div>
                    <button type="button" onClick={() => handleRemoveAttachment(attachment?.id)} className="p-1 hover:bg-red-500/10 rounded transition-smooth">
                      <Icon name="X" size={14} className="text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ========== COMMENTS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
              <Icon name="MessageSquare" size={16} />
              Initial Comment (Optional)
            </h3>
            <textarea
              value={formData?.initialComment}
              onChange={(e) => setFormData(prev => ({ ...prev, initialComment: e?.target?.value }))}
              placeholder="Add an initial comment or handover note"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-smooth"
              rows={3}
            />
          </div>

          {/* ========== ADVANCED OPTIONS ========== */}
          <div className="space-y-4 border-t border-border pt-6">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-left"
            >
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
                <Icon name="Settings" size={16} />
                Advanced Options
              </h3>
              <Icon name={showAdvanced ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-muted-foreground" />
            </button>

            {showAdvanced && (
              <div className="space-y-4 pl-6">
                {/* Labels */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Labels / Tags</label>
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      placeholder="Add label"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e?.target?.value)}
                      onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleAddLabel(); } }}
                    />
                    <Button type="button" size="sm" onClick={handleAddLabel}>Add</Button>
                  </div>
                  {formData?.labels?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData?.labels?.map(label => (
                        <span key={label} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium">
                          {label}
                          <button type="button" onClick={() => handleRemoveLabel(label)} className="hover:bg-primary/20 rounded-full p-0.5">
                            <Icon name="X" size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Internal Notes */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Internal Reference / Notes
                    <span className="text-xs text-muted-foreground ml-2">(Command/Chief only)</span>
                  </label>
                  <textarea
                    value={formData?.internalNotes}
                    onChange={(e) => setFormData(prev => ({ ...prev, internalNotes: e?.target?.value }))}
                    placeholder="Private notes visible only to Command/Chief"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-smooth"
                    rows={2}
                  />
                </div>

                {/* Visibility Toggle */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Visibility</label>
                  <Select
                    value={formData?.visibility}
                    onChange={(value) => setFormData(prev => ({ ...prev, visibility: value }))}
                    options={[
                      { value: 'crew-visible', label: 'Crew Visible' },
                      { value: 'internal', label: 'Internal Only (Command/Chief)' }
                    ]}
                  />
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-card sticky bottom-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={!formData?.title?.trim() || isSubmitting || isViewOnly}
            loading={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : getButtonLabel()}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ComprehensiveJobModal;