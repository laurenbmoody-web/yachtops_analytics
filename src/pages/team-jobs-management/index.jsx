import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';

import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';

import { getCurrentUser } from '../../utils/authStorage';

import { loadBoards, saveBoards, loadBoardsFromSupabase, saveBoardToSupabase, deleteBoardFromSupabase, loadBoardOrderFromSupabase, saveBoardOrderToSupabase } from './utils/boardStorage';
import { loadCards, saveCards } from './utils/cardStorage';


import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { supabase } from '../../lib/supabaseClient';
import QuickAddJobInput from './components/QuickAddJobInput';
import JobEditModal from './components/JobEditModal';
import JobArchiveCalendarModal from './components/JobArchiveCalendarModal';
import CardDetailModal from './components/CardDetailModal';

import CreateTaskModal from './components/CreateTaskModal';
import ComprehensiveJobModal from './components/ComprehensiveJobModal';
import SelfReportedJobModal from './components/SelfReportedJobModal';
import ReviewQueuePanel from './components/ReviewQueuePanel';

import { hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import { notifySenderDeclined, notifySenderAccepted } from './utils/notifications';

import { normalizeTier, isCommand, isChief, isHod, isCrew, isViewOnly, isOwnDepartmentView as calcIsOwnDeptView, canEditDepartment, canAddJob, canCompleteJob, canComment, canCreateBoard, canDeleteBoard, canRenameBoard, jobModalMode as calcJobModalMode, isPrivateJobOwner, isPrivateBoardOwner, getUserCapabilities } from './utils/tierPermissions';
import { showToast } from '../../utils/toast';

const notifyJobAssigned = (assigneeIds, jobTitle, jobId, dueDate) => {
  console.log('Job assigned notification:', { assigneeIds, jobTitle, jobId, dueDate });
};

const hasCommandAccessLocal = (user) => hasCommandAccess(user);
const hasChiefAccessLocal = (user) => hasChiefAccess(user);

// Daily refresh: returns today's date string
const getTodayKey = () => new Date()?.toISOString()?.split('T')?.[0];

// Move completed jobs from yesterday into history and remove from cards
const runDailyRefresh = async (cards, activeTenantId, boards) => {
  const todayKey = getTodayKey();
  const lastRefreshKey = `jobs_last_refresh_${activeTenantId}`;
  const lastRefresh = localStorage.getItem(lastRefreshKey);

  if (lastRefresh === todayKey) return cards; // Already refreshed today

  // Find jobs completed before today
  const completedYesterday = cards?.filter(c =>
    c?.status === 'completed' &&
    c?.completedAt &&
    c?.completedAt?.split('T')?.[0] < todayKey
  );

  if (completedYesterday?.length > 0 && activeTenantId) {
    try {
      // Archive each completed job to job_history
      const historyRows = completedYesterday?.map(job => {
        const board = boards?.find(b => b?.id === job?.board);
        return {
          tenant_id: activeTenantId,
          original_job_id: job?.supabase_id || null,
          title: job?.title || job?.name || 'Untitled',
          description: job?.description || null,
          priority: job?.priority || null,
          department: job?.department || job?.assignedDepartment || null,
          board_id: job?.board || null,
          board_name: board?.name || null,
          assigned_to: job?.assigned_to || null,
          created_by: job?.created_by || job?.createdBy || null,
          completed_by: job?.completedBy || null,
          completed_at: job?.completedAt || new Date()?.toISOString(),
          completion_date: job?.completedAt ? job?.completedAt?.split('T')?.[0] : getTodayKey(),
          metadata: job?.metadata || [],
        };
      });

      await supabase?.from('job_history')?.insert(historyRows);
    } catch (err) {
      console.warn('Failed to archive completed jobs:', err);
    }
  }

  // Delete completed jobs from team_jobs in Supabase so they don't re-appear on refresh
  const supabaseIdsToDelete = completedYesterday
    ?.map(j => j?.supabase_id || (j?.id && !j?.id?.startsWith('card-') ? j?.id : null))
    ?.filter(Boolean);
  if (supabaseIdsToDelete?.length > 0 && activeTenantId) {
    try {
      await supabase?.from('team_jobs')
        ?.delete()
        ?.in('id', supabaseIdsToDelete)
        ?.eq('tenant_id', activeTenantId);
    } catch (deleteErr) {
      console.warn('Failed to delete completed jobs from team_jobs:', deleteErr);
    }
  }

  // Remove completed-before-today jobs from cards
  const refreshedCards = cards?.filter(c =>
    !(c?.status === 'completed' && c?.completedAt && c?.completedAt?.split('T')?.[0] < todayKey)
  );

  localStorage.setItem(lastRefreshKey, todayKey);
  return refreshedCards;
};

// ── Board order helpers (per-user, private) ──
const getBoardOrderKey = (userId, deptId) => `jobs_board_order_${userId}_${deptId || 'all'}`;

const loadBoardOrder = (userId, deptId) => {
  if (!userId) return null;
  try {
    const stored = localStorage.getItem(getBoardOrderKey(userId, deptId));
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
};

const saveBoardOrder = (userId, deptId, orderedIds) => {
  if (!userId) return;
  try {
    localStorage.setItem(getBoardOrderKey(userId, deptId), JSON.stringify(orderedIds));
  } catch { /* ignore */ }
};

const applyBoardOrder = (boards, orderedIds) => {
  if (!orderedIds || orderedIds?.length === 0) return boards;
  const orderMap = {};
  orderedIds?.forEach((id, idx) => { orderMap[id] = idx; });
  return [...boards]?.sort((a, b) => {
    const ai = orderMap?.[a?.id] ?? 9999;
    const bi = orderMap?.[b?.id] ?? 9999;
    return ai - bi;
  });
};

const TeamJobsManagement = () => {
  const navigate = useNavigate();
  const { currentUser: authUser, user } = useAuth();
  const { activeTenantId, loadingTenant, currentTenantMember } = useTenant();
  const currentUser = getCurrentUser();

  // ── State declarations ──
  const [boards, setBoards] = useState(() => loadBoards());
  const [cards, setCards] = useState(() => loadCards());
  const [departments, setDepartments] = useState([]);
  const [departmentFilter, setDepartmentFilter] = useState(null);
  const [deptLoading, setDeptLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [supabaseJobs, setSupabaseJobs] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [showCreateCard, setShowCreateCard] = useState(null);
  const [showCreateCardBoardId, setShowCreateCardBoardId] = useState(null);
  const [showBoardMenu, setShowBoardMenu] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showCreateDutySet, setShowCreateDutySet] = useState(false);
  const [showCreateDutySetBoardId, setShowCreateDutySetBoardId] = useState(null);
  const [showReviewQueue, setShowReviewQueue] = useState(false);
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [editingBoardName, setEditingBoardName] = useState('');
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDescription, setNewBoardDescription] = useState('');
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);
  const [completingJobId, setCompletingJobId] = useState(null);
  const [showComprehensiveModal, setShowComprehensiveModal] = useState(false);
  const [comprehensiveModalBoardId, setComprehensiveModalBoardId] = useState(null);
  const [showSelfReportedModal, setShowSelfReportedModal] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [acceptanceJob, setAcceptanceJob] = useState(null);
  // Track which completed job IDs should be hidden (refreshed away or day-rolled)
  const [hiddenCompletedIds, setHiddenCompletedIds] = useState(() => {
    try {
      const stored = localStorage.getItem('jobs_hidden_completed_ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  // Track the date when hidden IDs were last set (to detect day rollover)
  const [lastRefreshDate, setLastRefreshDate] = useState(() => {
    return localStorage.getItem('jobs_last_refresh_date') || null;
  });

  // Use permission_tier DIRECTLY from tenantMember — do NOT default to VIEW_ONLY while loading
  const effectiveTier = loadingTenant
    ? null
    : normalizeTier(currentTenantMember?.permission_tier) || (activeTenantId ? 'VIEW_ONLY' : null);
  const userDepartmentId = currentTenantMember?.department_id || null;
  const tierLoading = loadingTenant || (activeTenantId && effectiveTier === null);
  const currentUserId = authUser?.id || currentUser?.id || null;
  const me = user?.id ?? authUser?.id;

  // Helper: persist hidden completed IDs to localStorage
  const persistHiddenIds = (idSet) => {
    try {
      localStorage.setItem('jobs_hidden_completed_ids', JSON.stringify([...idSet]));
    } catch { /* ignore */ }
  };

  // Day-change detection: when a new day starts, clear hidden IDs and let daily refresh handle archiving
  useEffect(() => {
    const todayKey = getTodayKey();
    if (lastRefreshDate && lastRefreshDate !== todayKey) {
      // New day — clear hidden IDs and let daily refresh handle archiving
      const emptySet = new Set();
      setHiddenCompletedIds(emptySet);
      persistHiddenIds(emptySet);
      setLastRefreshDate(todayKey);
      localStorage.setItem('jobs_last_refresh_date', todayKey);
    }
    // Check every minute for day rollover
    const interval = setInterval(() => {
      const currentDay = getTodayKey();
      setLastRefreshDate(prev => {
        if (prev && prev !== currentDay) {
          const emptySet = new Set();
          setHiddenCompletedIds(emptySet);
          persistHiddenIds(emptySet);
          localStorage.setItem('jobs_last_refresh_date', currentDay);
          return currentDay;
        }
        return prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Add this function
  const handleManualRefresh = async () => {
    if (!activeTenantId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const todayKey = getTodayKey();

      // Use mergedCards so we catch completed jobs from BOTH cards state AND supabaseJobs
      const allMerged = (() => {
        const safeCards = Array.isArray(cards) ? cards : [];
        if (supabaseJobs?.length === 0) return safeCards;
        const supabaseIds = new Set(supabaseJobs?.map(j => j?.supabase_id));
        const localOnly = safeCards?.filter(c => !c?.supabase_id || !supabaseIds?.has(c?.supabase_id));
        return [...supabaseJobs, ...localOnly];
      })();

      const completedJobs = allMerged?.filter(c => c?.status === 'completed' || c?.completed === true);

      // Only hide jobs completed on PREVIOUS days (not today) — today's completed jobs stay visible
      const prevDayCompletedIds = new Set(
        completedJobs
          ?.filter(c => {
            const d = c?.completedAt ? c?.completedAt?.split('T')?.[0] : null;
            return d && d < todayKey;
          })
          ?.flatMap(c => [c?.id, c?.supabase_id].filter(Boolean))
      );

      // Archive ALL completed jobs (today + previous days) to history
      if (completedJobs?.length > 0) {
        try {
          const historyRows = completedJobs?.map(job => {
            const board = boards?.find(b => b?.id === job?.board);
            return {
              tenant_id: activeTenantId,
              original_job_id: job?.supabase_id || null,
              title: job?.title || job?.name || 'Untitled',
              description: job?.description || null,
              priority: job?.priority || null,
              department: job?.department || job?.assignedDepartment || null,
              board_id: job?.board || null,
              board_name: board?.name || null,
              assigned_to: job?.assigned_to || null,
              created_by: job?.created_by || job?.createdBy || null,
              completed_by: job?.completedBy || null,
              completed_at: job?.completedAt || new Date()?.toISOString(),
              completion_date: job?.completedAt ? job?.completedAt?.split('T')?.[0] : todayKey,
              metadata: job?.metadata || [],
            };
          });
          await supabase?.from('job_history')?.insert(historyRows);
        } catch (archiveErr) {
          console.warn('Failed to archive completed jobs to history:', archiveErr);
        }
        // Delete completed jobs from team_jobs in Supabase so they don't re-appear on refresh
        const supabaseIdsToDelete = completedJobs
          ?.map(j => j?.supabase_id || (j?.id && !j?.id?.startsWith('card-') ? j?.id : null))
          ?.filter(Boolean);
        if (supabaseIdsToDelete?.length > 0 && activeTenantId) {
          try {
            await supabase?.from('team_jobs')
              ?.delete()
              ?.in('id', supabaseIdsToDelete)
              ?.eq('tenant_id', activeTenantId);
          } catch (deleteErr) {
            console.warn('Failed to delete completed jobs from team_jobs:', deleteErr);
          }
        }
        // Remove all completed jobs from local cards state
        const refreshedCards = cards?.filter(c => c?.status !== 'completed' && c?.completed !== true);
        setCards(refreshedCards);
        saveCards(refreshedCards);
        // Also clear completed jobs from supabaseJobs immediately so UI updates before re-fetch
        setSupabaseJobs(prev => prev?.filter(j => j?.status !== 'completed'));
        // Reset the daily refresh key so auto-refresh can run again
        localStorage.removeItem(`jobs_last_refresh_${activeTenantId}`);
      }

      // Only hide previous-day completed IDs — today's completed jobs remain visible after re-fetch
      setHiddenCompletedIds(prevDayCompletedIds);
      persistHiddenIds(prevDayCompletedIds);
      setLastRefreshDate(todayKey);
      localStorage.setItem('jobs_last_refresh_date', todayKey);

      // Reload boards from Supabase
      await loadBoardsFromSupabase(activeTenantId, (freshBoards) => {
        const merged = freshBoards?.map(fb => {
          const existing = boards?.find(b => b?.id === fb?.id);
          return existing ? { ...existing, name: fb?.name } : fb;
        });
        setBoards(merged);
        saveBoards(merged);
      });

      // For COMMAND users viewing ALL departments, fetch all dept jobs fresh
      if (isCommand(effectiveTier) && departmentFilter?.id === 'ALL') {
        await fetchJobsFromSupabase({ id: 'ALL', label: 'All' }, true);
      } else {
        // For CHIEF/HOD/CREW: use current departmentFilter, or fall back to own department
        const refreshDept = departmentFilter || (userDepartmentId ? { id: userDepartmentId, label: 'My Department' } : null);
        await fetchJobsFromSupabase(refreshDept, true);
      }
    } catch (err) {
      console.warn('Manual refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // ── Fetch departments from public.departments scoped to current tenant ──
  const fetchDepartments = useCallback(async () => {
    if (!activeTenantId) return;
    setDeptLoading(true);
    try {
      // Use the get_tenant_departments RPC which is SECURITY DEFINER and bypasses RLS
      // Direct queries to tenant_members are restricted by RLS (each user only sees their own row)
      const { data: rpcDepts, error: rpcError } = await supabase
        ?.rpc('get_tenant_departments', { p_tenant_id: activeTenantId });

      if (!rpcError && rpcDepts && rpcDepts?.length > 0) {
        setDepartments(rpcDepts || []);
        setDeptLoading(false);
        return;
      }

      if (rpcError) {
        console.warn('[TeamJobs] get_tenant_departments RPC failed, falling back to direct query:', rpcError);
      }

      // Fallback: collect department IDs from multiple sources
      const { data: memberDepts, error: memberError } = await supabase
        ?.from('tenant_members')
        ?.select('department_id')
        ?.eq('tenant_id', activeTenantId)
        ?.not('department_id', 'is', null);

      if (memberError) {
        console.warn('[TeamJobs] Failed to fetch tenant member departments:', memberError);
      }

      // Also collect department IDs from team_jobs for this tenant
      const { data: jobDepts, error: jobDeptsError } = await supabase
        ?.from('team_jobs')
        ?.select('department_id')
        ?.eq('tenant_id', activeTenantId)
        ?.not('department_id', 'is', null);

      if (jobDeptsError) {
        console.warn('[TeamJobs] Failed to fetch job departments:', jobDeptsError);
      }

      // Also collect department IDs from crew_invites for this tenant
      const { data: inviteDepts, error: inviteDeptsError } = await supabase
        ?.from('crew_invites')
        ?.select('department_id')
        ?.eq('tenant_id', activeTenantId)
        ?.not('department_id', 'is', null);

      if (inviteDeptsError) {
        console.warn('[TeamJobs] Failed to fetch invite departments:', inviteDeptsError);
      }

      // Merge all department IDs from all sources
      const allDeptIds = [
        ...((memberDepts || [])?.map(m => m?.department_id)),
        ...((jobDepts || [])?.map(j => j?.department_id)),
        ...((inviteDepts || [])?.map(i => i?.department_id)),
      ]?.filter(Boolean);

      const deptIds = [...new Set(allDeptIds)];

      if (deptIds?.length === 0) {
        // Last resort: if user has a department_id, fetch just that department directly
        if (userDepartmentId) {
          const { data: ownDeptRow, error: ownDeptError } = await supabase
            ?.from('departments')
            ?.select('id, name')
            ?.eq('id', userDepartmentId)
            ?.single();
          if (!ownDeptError && ownDeptRow) {
            setDepartments([ownDeptRow]);
          } else {
            setDepartments([]);
          }
        } else {
          setDepartments([]);
        }
        setDeptLoading(false);
        return;
      }

      const { data: deptRows, error: deptError } = await supabase
        ?.from('departments')
        ?.select('id, name')
        ?.in('id', deptIds)
        ?.order('name', { ascending: true });

      if (deptError) {
        console.warn('[TeamJobs] Failed to fetch departments:', deptError);
        setDeptLoading(false);
        return;
      }

      setDepartments(deptRows || []);
    } catch (err) {
      console.warn('[TeamJobs] fetchDepartments error:', err);
    } finally {
      setDeptLoading(false);
    }
  }, [activeTenantId, userDepartmentId]);

  // ── Fetch jobs from public.team_jobs filtered by tenant + optional department ──
  const fetchJobsFromSupabase = useCallback(async (selectedDept, skipCompleted = false) => {
    if (!activeTenantId) return;
    setJobsLoading(true);
    try {
      // Fetch OPEN jobs
      let query = supabase
        ?.from('team_jobs')
        ?.select('*')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('status', 'OPEN');

      // Apply department filter if not "All"
      if (selectedDept && selectedDept?.id !== 'ALL') {
        query = query?.eq('department_id', selectedDept?.id);
      }

      const { data: jobRows, error: jobError } = await query?.order('created_at', { ascending: false });

      if (jobError) {
        console.warn('[TeamJobs] Failed to fetch jobs:', jobError);
        setJobsLoading(false);
        return;
      }

      // Also fetch completed-today jobs so they remain visible until next day
      // Skip this when called from handleManualRefresh (completed jobs were just archived/deleted)
      let completedTodayRows = [];
      if (!skipCompleted) {
        const todayStr = (() => {
          const d = new Date();
          return `${d?.getFullYear()}-${String(d?.getMonth() + 1)?.padStart(2, '0')}-${String(d?.getDate())?.padStart(2, '0')}`;
        })();
        let completedTodayQuery = supabase
          ?.from('team_jobs')
          ?.select('*')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('status', 'completed')
          ?.eq('completion_date', todayStr);
        if (selectedDept && selectedDept?.id !== 'ALL') {
          completedTodayQuery = completedTodayQuery?.eq('department_id', selectedDept?.id);
        }
        const { data: ctRows } = await completedTodayQuery;
        completedTodayRows = ctRows || [];
      }

      // Also fetch rotation jobs assigned to the current user that may be in a different dept scope
      const userId = authUser?.id || currentUser?.id;
      let rotationRows = [];
      if (userId) {
        const { data: rotData } = await supabase
          ?.from('team_jobs')
          ?.select('*')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('source', 'rotation')
          ?.eq('assigned_to', userId)
          ?.eq('status', 'OPEN');
        rotationRows = rotData || [];
      }

      // Merge: deduplicate by id
      const allRows = [...(jobRows || []), ...completedTodayRows, ...rotationRows];
      const seenIds = new Set();
      const dedupedRows = allRows?.filter(r => {
        if (seenIds?.has(r?.id)) return false;
        seenIds?.add(r?.id);
        return true;
      });

      console.log('[TeamJobs] fetchJobsFromSupabase: fetched', dedupedRows?.length, 'jobs (dept:', selectedDept?.id, ', rotation assigned to me:', rotationRows?.length, ')');

      // Map Supabase rows to card shape used by the UI
      const mappedJobs = dedupedRows?.map(j => ({
        id: j?.id,
        supabase_id: j?.id,
        type: 'task',
        title: j?.title,
        description: j?.description || '',
        status: j?.status === 'OPEN' ? 'pending' : (j?.status?.toLowerCase() || 'pending'),
        priority: j?.priority || null,
        department: j?.department_id || null,
        department_id: j?.department_id || null,
        board: j?.board_id || null,
        assigned_to: j?.assigned_to || null,
        assignees: j?.assigned_to ? [j?.assigned_to] : [],
        dueDate: j?.due_date || null,
        is_private: j?.is_private || false,
        created_by: j?.created_by || null,
        createdAt: j?.created_at || null,
        completedAt: j?.completed_at || null,
        completedBy: j?.completed_by || null,
        metadata: j?.metadata || [],
        source: j?.source || null,
        rotation_assignment_id: j?.rotation_assignment_id || null,
        notes: [],
        attachments: [],
        activity: [],
        checklist: [],
        archived: false,
      }));

      console.log('[TeamJobs] Rotation jobs in result:', mappedJobs?.filter(j => j?.source === 'rotation')?.map(j => ({ id: j?.id, title: j?.title, assigned_to: j?.assigned_to, dueDate: j?.dueDate, board: j?.board })));

      setSupabaseJobs(mappedJobs);
    } catch (err) {
      console.warn('[TeamJobs] fetchJobsFromSupabase error:', err);
    } finally {
      setJobsLoading(false);
    }
  }, [activeTenantId, authUser, currentUser]);

  // ── Set default department selection once departments + tier are known ──
  useEffect(() => {
    if (!effectiveTier) return;

    if (isCommand(effectiveTier)) {
      setDepartmentFilter({ id: 'ALL', label: 'All' });
    } else {
      // CHIEF, HOD, CREW, VIEW_ONLY: default to own department
      // Set immediately from userDepartmentId without waiting for departments list
      if (userDepartmentId) {
        // Try to find the department name from the loaded list first
        const ownDept = departments?.find(d => d?.id === userDepartmentId);
        if (ownDept) {
          setDepartmentFilter(prev => {
            // Only update if not already set to this department (avoid resetting user selection)
            if (prev?.id === ownDept?.id) return prev;
            return { id: ownDept?.id, label: ownDept?.name };
          });
        } else {
          // Departments not loaded yet or user's dept not in list — set filter using just the ID
          // This ensures _isOwnDeptView = true immediately so CHIEF sees Create Job + boards
          setDepartmentFilter(prev => {
            if (prev?.id === userDepartmentId) return prev;
            return { id: userDepartmentId, label: 'My Department' };
          });
          // Fetch the department name directly to update the label
          if (activeTenantId) {
            supabase
              ?.from('departments')
              ?.select('id, name')
              ?.eq('id', userDepartmentId)
              ?.single()
              ?.then(({ data, error }) => {
                if (!error && data) {
                  setDepartmentFilter(prev => {
                    if (prev?.id === data?.id) return { id: data?.id, label: data?.name };
                    return prev;
                  });
                  // Also add to departments list if not present
                  setDepartments(prev => {
                    if (!prev?.find(d => d?.id === data?.id)) {
                      return [...(prev || []), data];
                    }
                    return prev;
                  });
                }
              });
          }
        }
      } else if (departments?.length > 0) {
        console.warn('[TeamJobs] myTenantMember.department_id is null, falling back to first department');
        setDepartmentFilter(prev => {
          if (prev?.id === departments?.[0]?.id) return prev;
          return { id: departments?.[0]?.id, label: departments?.[0]?.name };
        });
      }
    }
  }, [effectiveTier, departments, userDepartmentId, activeTenantId]);

  // ── Fetch departments on mount / tenant change ──
  useEffect(() => {
    if (activeTenantId && !loadingTenant) {
      fetchDepartments();
    }
  }, [activeTenantId, loadingTenant, fetchDepartments]);

  // ── Fetch jobs whenever departmentFilter or tenant changes ──
  useEffect(() => {
    if (!activeTenantId || loadingTenant) return;
    // For CHIEF/HOD/CREW: if departmentFilter not yet set but userDepartmentId is known,
    // fetch jobs for their department immediately without waiting for filter to be set
    if (departmentFilter !== null) {
      fetchJobsFromSupabase(departmentFilter);
    } else if (userDepartmentId && !isCommand(effectiveTier)) {
      // Filter not set yet but we know the user's department — fetch now
      fetchJobsFromSupabase({ id: userDepartmentId, label: 'My Department' });
    }
  }, [activeTenantId, loadingTenant, departmentFilter, fetchJobsFromSupabase, userDepartmentId, effectiveTier]);

  // ── Load boards from Supabase on mount so all users see the latest names ──
  useEffect(() => {
    if (!activeTenantId || loadingTenant) return;
    loadBoardsFromSupabase(activeTenantId)?.then(supabaseBoards => {
      if (supabaseBoards === null) return; // Supabase unavailable, keep localStorage
      if (supabaseBoards?.length === 0) {
        // No boards in Supabase yet — push localStorage boards up
        const localBoards = loadBoards();
        localBoards?.forEach(board => {
          saveBoardToSupabase(board, activeTenantId, board?.department_id || null, board?.name);
          // Also push per-dept names if any
          if (board?.names) {
            Object.entries(board?.names)?.forEach(([deptId, deptName]) => {
              saveBoardToSupabase(board, activeTenantId, deptId, deptName);
            });
          }
        });
        return;
      }
      // Merge: Supabase is source of truth for names; keep local boards that aren't in Supabase yet
      const supabaseIds = new Set(supabaseBoards?.map(b => b?.id));
      const localBoards = loadBoards();
      const localOnly = localBoards?.filter(b => !supabaseIds?.has(b?.id));
      const merged = [...supabaseBoards, ...localOnly];
      setBoards(merged);
      saveBoards(merged);
    });
  }, [activeTenantId, loadingTenant]);

  // ── Derived permission flags based on current tier + selected department ──
  const selectedDeptId = departmentFilter?.id || null;
  // For CHIEF: if departmentFilter is not yet set but userDepartmentId is known,
  // treat it as own-department view so permissions evaluate correctly on first render
  const _isOwnDeptView = (() => {
    const result = calcIsOwnDeptView(selectedDeptId, userDepartmentId);
    if (result) return true;
    // CHIEF/HOD/CREW fallback: no filter set yet but we know the user's dept — treat as own dept view
    if ((isChief(effectiveTier) || isHod(effectiveTier) || isCrew(effectiveTier)) && !selectedDeptId && userDepartmentId) return true;
    return result;
  })();

  // Effective dept ID for permission checks — use userDepartmentId as fallback when filter not yet set
  const _effectiveDeptId = selectedDeptId || (userDepartmentId ? userDepartmentId : null);

  // Board-level permissions
  const _canCreateBoard = !tierLoading && canCreateBoard(effectiveTier, _effectiveDeptId, userDepartmentId);
  const _canDeleteBoard = !tierLoading && canDeleteBoard(effectiveTier, _effectiveDeptId, userDepartmentId);
  const _canRenameBoard = !tierLoading && canRenameBoard(effectiveTier, _effectiveDeptId, userDepartmentId);

  // Job-level permissions
  const _canAddJob = !tierLoading && canAddJob(effectiveTier, _effectiveDeptId, userDepartmentId, false);
  const _canCompleteJob = !tierLoading && canCompleteJob(effectiveTier, _effectiveDeptId, userDepartmentId, false);
  const _canComment = !tierLoading && canComment(effectiveTier, _effectiveDeptId, userDepartmentId);
  const _canEditDept = !tierLoading && canEditDepartment(effectiveTier, _effectiveDeptId, userDepartmentId);

  // Pending acceptance visibility
  const _canSeePending = !tierLoading && !!effectiveTier;

  // Archive visibility: COMMAND and CHIEF only
  const canShowArchive = !tierLoading && !!effectiveTier;

  // Board title editing: only when user can rename
  const canEditBoardTitle = _canRenameBoard;

  const enhancedUser = {
    ...currentUser,
    permission_tier: effectiveTier,
    effectiveTier,
    department_id: userDepartmentId,
    department: userDepartmentId
  };
  const userCapabilities = getUserCapabilities(enhancedUser);

  const handleQuickAddJob = async (title, boardId) => {
    const userId = authUser?.id || currentUser?.id;
    const tier = effectiveTier;
    let departmentId = null;
    if (tier === 'COMMAND') {
      const targetBoard = boardId ? boards?.find(b => b?.id === boardId) : null;
      departmentId = targetBoard?.department_id || targetBoard?.department || null;
      // If viewing a specific department (not All), use that department
      if (!departmentId && departmentFilter?.id && departmentFilter?.id !== 'ALL') {
        departmentId = departmentFilter?.id;
      }
    } else {
      departmentId = userDepartmentId || null;
    }
    const isPrivate = tier === 'CREW';
    const optimisticId = `card-${Date.now()}`;
    const optimisticCard = {
      id: optimisticId, type: 'task', title, board: boardId || null,
      status: 'pending', department: departmentId, department_id: departmentId,
      assigned_to: null, assignees: [], priority: null, is_private: isPrivate,
      created_by: userId, createdAt: new Date()?.toISOString(),
      notes: [], attachments: [], activity: [], checklist: []
    };
    const updatedCards = [...cards, optimisticCard];
    setCards(updatedCards);
    saveCards(updatedCards);
    if (activeTenantId && userId) {
      try {
        const insertPayload = {
          tenant_id: activeTenantId, title, created_by: userId,
          status: 'pending', assigned_to: null, priority: null, is_private: isPrivate
        };
        const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(val);
        if (departmentId && isValidUUID(departmentId)) insertPayload.department_id = departmentId;
        const { data: insertedJob, error: insertError } = await supabase
          ?.from('team_jobs')?.insert(insertPayload)?.select('id')?.single();
        if (insertError) {
          const revertedCards = cards?.filter(c => c?.id !== optimisticId);
          setCards(revertedCards); saveCards(revertedCards);
          throw new Error(insertError?.message || 'Failed to save job');
        }
        if (insertedJob?.id) {
          const reconciledCards = updatedCards?.map(c =>
            c?.id === optimisticId ? { ...c, supabase_id: insertedJob?.id } : c
          );
          setCards(reconciledCards); saveCards(reconciledCards);
          // Refresh jobs from Supabase to get the new job in the list
          fetchJobsFromSupabase(departmentFilter);
        }
      } catch (err) { throw err; }
    }
  };

  const canShowQuickAdd = (board) => {
    if (tierLoading || !effectiveTier || isViewOnly(effectiveTier)) return false;
    const personal = board ? isPrivateBoardOwner(board, currentUserId) : false;
    if (isCommand(effectiveTier)) return true;
    if (isChief(effectiveTier) || isHod(effectiveTier)) {
      if (personal) return true;
      if (!board) return _isOwnDeptView;
      const boardDept = board?.department_id || board?.department || '';
      if (!boardDept || boardDept === 'General') return _isOwnDeptView;
      return boardDept === userDepartmentId && _isOwnDeptView;
    }
    if (isCrew(effectiveTier)) {
      // CREW can only quick-add on their own private boards
      if (!board) return false;
      return isPrivateBoardOwner(board, currentUserId);
    }
    return false;
  };

  // ── dnd-kit sensors: pointer (mouse/pen) + touch, with 8px activation distance ──
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );

  // ── Drag-and-drop board reorder state ──
  const [boardOrder, setBoardOrder] = useState(null); // null = use default order
  const [activeDragId, setActiveDragId] = useState(null);

  // ── Legacy drag-mode state (used by long-press drag system) ──
  const [dragMode, setDragMode] = useState(false);
  const [draggingBoardId, setDraggingBoardId] = useState(null);
  const [dragOverBoardId, setDragOverBoardId] = useState(null);
  const [shakingBoardId, setShakingBoardId] = useState(null);

  // ── Legacy drag refs ──
  const draggingBoardIdRef = useRef(null);
  const dragOverBoardIdRef = useRef(null);
  const dragSourceIndexRef = useRef(null);
  const isDraggingActiveRef = useRef(false);
  const windowDragListenersAttached = useRef(false);
  const longPressTimerRef = useRef(null);
  const boardsContainerRef = useRef(null);
  const orderedBoardsRef = useRef([]);
  const effectiveDeptIdRef = useRef(null);
  const currentUserIdRef = useRef(null);

  // Ordered boards for the current user/dept view
  const orderedBoards = useMemo(() => {
    const filtered = boards?.filter(board => {
      const boardDept = board?.department_id || board?.department;
      if (!boardDept || boardDept === 'General') return true;
      return boardDept === _effectiveDeptId;
    });
    if (!boardOrder) return filtered;
    return applyBoardOrder(filtered, boardOrder);
  }, [boards, boardOrder, _effectiveDeptId]);

  // Load saved board order when user/dept changes (Supabase first, localStorage fallback)
  useEffect(() => {
    if (!currentUserId) return;
    const deptKey = _effectiveDeptId && _effectiveDeptId !== 'ALL' ? _effectiveDeptId : 'all';
    // Try Supabase first
    if (activeTenantId) {
      loadBoardOrderFromSupabase(currentUserId, activeTenantId)?.then(supabaseOrder => {
        if (supabaseOrder && supabaseOrder?.length > 0) {
          setBoardOrder(supabaseOrder);
          // Sync to localStorage as cache
          saveBoardOrder(currentUserId, deptKey, supabaseOrder);
        } else {
          // Fall back to localStorage
          const saved = loadBoardOrder(currentUserId, deptKey);
          setBoardOrder(saved);
        }
      });
    } else {
      const saved = loadBoardOrder(currentUserId, deptKey);
      setBoardOrder(saved);
    }
  }, [currentUserId, _effectiveDeptId, activeTenantId]);

  // Handle dnd-kit drag end: reorder boards and persist
  const handleDndDragEnd = useCallback(async (event) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over || active?.id === over?.id) return;

    const currentIds = orderedBoards?.map(b => b?.id);
    const oldIndex = currentIds?.indexOf(active?.id);
    const newIndex = currentIds?.indexOf(over?.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(currentIds, oldIndex, newIndex);

    // Optimistic update
    setBoardOrder(newOrder);
    const deptKey = _effectiveDeptId && _effectiveDeptId !== 'ALL' ? _effectiveDeptId : 'all';
    saveBoardOrder(currentUserId, deptKey, newOrder);

    // Persist to Supabase
    if (activeTenantId && currentUserId) {
      const ok = await saveBoardOrderToSupabase(currentUserId, activeTenantId, newOrder);
      if (!ok) {
        // Revert on failure
        setBoardOrder(currentIds);
        saveBoardOrder(currentUserId, deptKey, currentIds);
        showToast('Could not save board order. Please try again.', 'error');
      }
    }
  }, [orderedBoards, _effectiveDeptId, currentUserId, activeTenantId]);

  // Exit drag mode on Escape key
  useEffect(() => {
    if (!dragMode) return;
    const handleKeyDown = (e) => {
      if (e?.key === 'Escape') {
        detachWindowDragListeners();
        setDragMode(false);
        draggingBoardIdRef.current = null;
        dragOverBoardIdRef.current = null;
        setDraggingBoardId(null);
        setDragOverBoardId(null);
        setShakingBoardId(null);
        isDraggingActiveRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dragMode]);

  // Stable window drag handler functions stored in refs so they can be removed
  const windowPointerMoveHandlerRef = useRef(null);
  const windowPointerUpHandlerRef = useRef(null);

  const detachWindowDragListeners = () => {
    if (windowPointerMoveHandlerRef?.current) {
      window.removeEventListener('pointermove', windowPointerMoveHandlerRef?.current);
      windowPointerMoveHandlerRef.current = null;
    }
    if (windowPointerUpHandlerRef?.current) {
      window.removeEventListener('pointerup', windowPointerUpHandlerRef?.current);
      windowPointerUpHandlerRef.current = null;
    }
    windowDragListenersAttached.current = false;
  };

  const attachWindowDragListeners = () => {
    if (windowDragListenersAttached?.current) return;

    const handleWindowPointerMove = (e) => {
      if (!isDraggingActiveRef?.current || !draggingBoardIdRef?.current) return;
      const container = boardsContainerRef?.current;
      if (!container) return;
      const boardEls = container?.querySelectorAll('[data-board-id]');
      // Determine dragOverBoardId by comparing pointer X to each board's ORIGINAL
      // (untransformed) center X. We read the DOM rect but strip out any translateX
      // transform so that visual shifts don't affect hit-testing.
      let closestBoardId = null;
      let closestDist = Infinity;
      for (const el of boardEls) {
        const boardId = el?.getAttribute('data-board-id');
        if (boardId === draggingBoardIdRef?.current) continue;
        const rect = el?.getBoundingClientRect();
        // Get the current translateX applied to this element so we can undo it
        const style = window.getComputedStyle(el);
        const matrix = new DOMMatrix(style.transform);
        const appliedTranslateX = matrix?.m41; // translateX in px
        // Original center X = visual center minus the applied shift
        const originalCenterX = (rect?.left + rect?.right) / 2 - appliedTranslateX;
        const dist = Math.abs(e?.clientX - originalCenterX);
        if (dist < closestDist) {
          closestDist = dist;
          closestBoardId = boardId;
        }
      }
      // Only update if pointer is within reasonable range (half board width ~144px)
      if (closestBoardId && closestDist < 200) {
        if (dragOverBoardIdRef?.current !== closestBoardId) {
          dragOverBoardIdRef.current = closestBoardId;
          setDragOverBoardId(closestBoardId);
        }
      } else {
        if (dragOverBoardIdRef?.current !== null) {
          dragOverBoardIdRef.current = null;
          setDragOverBoardId(null);
        }
      }
    };

    const handleWindowPointerUp = (e) => {
      if (!isDraggingActiveRef?.current) return;
      isDraggingActiveRef.current = false;

      const srcId = draggingBoardIdRef?.current;
      const tgtId = dragOverBoardIdRef?.current;

      draggingBoardIdRef.current = null;
      dragOverBoardIdRef.current = null;
      setDraggingBoardId(null);
      setDragOverBoardId(null);

      detachWindowDragListeners();

      if (srcId && tgtId && srcId !== tgtId) {
        setBoardOrder(prevOrder => {
          const currentBoards = orderedBoardsRef?.current;
          const currentOrder = currentBoards?.map(b => b?.id);
          const fromIdx = currentOrder?.indexOf(srcId);
          const toIdx = currentOrder?.indexOf(tgtId);
          if (fromIdx !== -1 && toIdx !== -1) {
            const newOrder = [...currentOrder];
            newOrder?.splice(fromIdx, 1);
            newOrder?.splice(toIdx, 0, srcId);
            const deptKey = effectiveDeptIdRef?.current && effectiveDeptIdRef?.current !== 'ALL' ? effectiveDeptIdRef?.current : 'all';
            saveBoardOrder(currentUserIdRef?.current, deptKey, newOrder);
            return newOrder;
          }
          return prevOrder;
        });
      }
    };

    windowPointerMoveHandlerRef.current = handleWindowPointerMove;
    windowPointerUpHandlerRef.current = handleWindowPointerUp;
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    windowDragListenersAttached.current = true;
  };

  // Long press handlers for board header
  const handleBoardHeaderPointerDown = (e, boardId) => {
    // Don't activate if clicking on buttons/inputs inside the header
    if (e?.target?.closest('button') || e?.target?.closest('input')) return;
    if (dragMode) {
      // Already in drag mode — start dragging this board immediately on press
      e?.preventDefault();
      e?.stopPropagation();
      const boardIdx = orderedBoards?.findIndex(b => b?.id === boardId);
      draggingBoardIdRef.current = boardId;
      setDraggingBoardId(boardId);
      dragSourceIndexRef.current = boardIdx;
      isDraggingActiveRef.current = true;
      // Attach window listeners IMMEDIATELY — don't wait for React re-render
      attachWindowDragListeners();
      try { e?.currentTarget?.setPointerCapture(e?.pointerId); } catch (_) {}
      return;
    }
    // Not yet in drag mode — start long press timer
    // Capture pointer IMMEDIATELY so pointermove/pointerup keep firing even if pointer leaves element
    const pointerId = e?.pointerId;
    const targetEl = e?.currentTarget;
    const startX = e?.clientX;
    const startY = e?.clientY;
    try { targetEl?.setPointerCapture(pointerId); } catch (_) {}
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setShakingBoardId(boardId);
      setTimeout(() => {
        setShakingBoardId(null);
        setDragMode(true);
        const boardIdx = orderedBoardsRef?.current?.findIndex(b => b?.id === boardId);
        draggingBoardIdRef.current = boardId;
        setDraggingBoardId(boardId);
        dragSourceIndexRef.current = boardIdx;
        isDraggingActiveRef.current = true;
        // Attach window listeners IMMEDIATELY — don't wait for React re-render
        attachWindowDragListeners();
      }, 400);
    }, 500);
  };

  const handleBoardHeaderPointerUp = (e, boardId) => {
    // Cancel long press timer if drag hasn't started yet
    if (!isDraggingActiveRef?.current && longPressTimerRef?.current) {
      clearTimeout(longPressTimerRef?.current);
      longPressTimerRef.current = null;
      // Release pointer capture so normal click events fire correctly
      try { e?.currentTarget?.releasePointerCapture(e?.pointerId); } catch (_) {}
    }
    // Window-level handler takes care of drop logic
  };

  const handleBoardHeaderPointerMove = (e) => {
    // Cancel long press if pointer moved more than 10px (user is scrolling, not pressing)
    if (longPressTimerRef?.current && !isDraggingActiveRef?.current) {
      // movement threshold check is handled by window-level move; nothing needed here
    }
  };

  const handleBoardHeaderPointerLeave = () => {
    // Do NOT cancel long press on pointerleave — pointer capture keeps events firing
    // even after the pointer leaves the element, so we let the timer run
  };

  // Compute per-board shift offset during drag for visual push effect
  const getBoardShiftStyle = (boardIdx, totalBoards) => {
    if (!dragMode || !draggingBoardId || !dragOverBoardId) return {};
    const SHIFT = 308; // 288px (w-72) + 20px gap
    const fromIdx = orderedBoards?.findIndex(b => b?.id === draggingBoardId);
    const toIdx = orderedBoards?.findIndex(b => b?.id === dragOverBoardId);
    if (fromIdx === -1 || toIdx === -1) return {};
    // Dragging right: boards between fromIdx+1 and toIdx shift LEFT
    if (boardIdx > fromIdx && boardIdx <= toIdx) {
      return { transform: `translateX(-${SHIFT}px)` };
    }
    // Dragging left: boards between toIdx and fromIdx-1 shift RIGHT
    if (boardIdx >= toIdx && boardIdx < fromIdx) {
      return { transform: `translateX(${SHIFT}px)` };
    }
    return {};
  };

  // Drag event handlers
  const handleBoardDragStart = (e, boardId, index) => {
    // Disabled — using pointer events instead of HTML5 drag
    e?.preventDefault();
  };

  const handleBoardDragOver = (e, boardId) => {
    // Disabled — using pointer events instead
  };

  const handleBoardDragLeave = () => {
    // Disabled — using pointer events instead
  };

  const handleBoardDrop = (e, targetBoardId) => {
    // Disabled — using pointer events instead
    e?.preventDefault();
  };

  const handleBoardDragEnd = () => {
    // Disabled — using pointer events instead
  };

  const handleBoardDragCancel = () => {
    // Disabled — using pointer events instead
  };

  const exitDragMode = () => {
    detachWindowDragListeners();
    setDragMode(false);
    draggingBoardIdRef.current = null;
    dragOverBoardIdRef.current = null;
    setDraggingBoardId(null);
    setDragOverBoardId(null);
    setShakingBoardId(null);
    isDraggingActiveRef.current = false;
  };

  // ── Move Board state ──
  const [moveBoardId, setMoveBoardId] = useState(null);

  // Handle Move Board: reorder to a specific position
  const handleMoveBoard = useCallback((boardId, targetIndex) => {
    const currentIds = orderedBoards?.map(b => b?.id);
    const fromIndex = currentIds?.indexOf(boardId);
    if (fromIndex === -1 || fromIndex === targetIndex) { setMoveBoardId(null); return; }
    const newOrder = arrayMove(currentIds, fromIndex, targetIndex);
    setBoardOrder(newOrder);
    const deptKey = _effectiveDeptId && _effectiveDeptId !== 'ALL' ? _effectiveDeptId : 'all';
    saveBoardOrder(currentUserId, deptKey, newOrder);
    if (activeTenantId && currentUserId) {
      saveBoardOrderToSupabase(currentUserId, activeTenantId, newOrder)?.then(ok => {
        if (!ok) {
          setBoardOrder(currentIds);
          saveBoardOrder(currentUserId, deptKey, currentIds);
          showToast('Could not save board order. Please try again.', 'error');
        }
      });
    }
    setMoveBoardId(null);
    setShowBoardMenu(null);
  }, [orderedBoards, _effectiveDeptId, currentUserId, activeTenantId]);

  // ── SortableBoardWrapper: makes a board card draggable via dnd-kit ──
  // Drag activates from any non-interactive part of the card.
  const SortableBoardWrapper = ({ id, children }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id });

    const style = {
      transform: CSS?.Transform?.toString(transform),
      transition,
      opacity: isDragging ? 0.4 : 1,
      zIndex: isDragging ? 999 : undefined,
    };

    // Pass listeners down via render prop so the drag handle can be placed
    // precisely on the board header (non-interactive area only)
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
      >
        {typeof children === 'function' ? children(listeners) : children}
      </div>
    );
  };

  const handleCreateBoard = () => {
    if (!newBoardName?.trim()) return;
    const userId = authUser?.id || currentUser?.id;
    const deptId = departmentFilter?.id && departmentFilter?.id !== 'ALL' ? departmentFilter?.id : null;
    const newBoard = {
      id: `board-${Date.now()}`, name: newBoardName, description: newBoardDescription,
      color: '#3B82F6', department: deptId || 'General', department_id: deptId,
      members: [], created_by: userId, createdAt: new Date()?.toISOString(),
    };
    const updatedBoards = [...boards, newBoard];
    setBoards(updatedBoards); saveBoards(updatedBoards);
    // Persist to Supabase
    if (activeTenantId) {
      saveBoardToSupabase(newBoard, activeTenantId, deptId, newBoardName);
    }
    setNewBoardName(''); setNewBoardDescription(''); setShowCreateBoard(false);
  };

  const handleDeleteBoard = (boardId) => {
    const updatedBoards = boards?.filter(b => b?.id !== boardId);
    setBoards(updatedBoards); saveBoards(updatedBoards); setShowBoardMenu(null);
    // Remove from Supabase
    if (activeTenantId) {
      deleteBoardFromSupabase(boardId, activeTenantId);
    }
  };

  // canEditBoardTitle is derived from _canRenameBoard (declared above in permission flags block)

  const handleBoardTitleClick = (board) => {
    if (!canEditBoardTitle) return;
    setEditingBoardId(board?.id);
    // Use department-scoped name if available, else fall back to board.name
    const deptId = departmentFilter?.id && departmentFilter?.id !== 'ALL' ? departmentFilter?.id : null;
    const scopedName = deptId && board?.names?.[deptId] ? board?.names?.[deptId] : (board?.name || 'Board');
    setEditingBoardName(scopedName);
  };

  const handleBoardTitleSave = (boardId) => {
    const trimmed = editingBoardName?.trim();
    if (!trimmed) { setEditingBoardId(null); return; }
    const deptId = departmentFilter?.id && departmentFilter?.id !== 'ALL' ? departmentFilter?.id : null;
    const updatedBoards = boards?.map(b => {
      if (b?.id !== boardId) return b;
      if (deptId) {
        // Store name scoped to this department
        return { ...b, names: { ...(b?.names || {}), [deptId]: trimmed } };
      }
      // No specific department (ALL view): update the base name
      return { ...b, name: trimmed };
    });
    setBoards(updatedBoards);
    saveBoards(updatedBoards);
    // Persist to Supabase so all users see the updated name
    const targetBoard = boards?.find(b => b?.id === boardId);
    if (targetBoard && activeTenantId) {
      saveBoardToSupabase(targetBoard, activeTenantId, deptId, trimmed);
    }
    setEditingBoardId(null);
  };

  const handleBoardTitleKeyDown = (e, boardId) => {
    if (e?.key === 'Enter') { e?.preventDefault(); handleBoardTitleSave(boardId); }
    if (e?.key === 'Escape') { setEditingBoardId(null); }
  };

  // Build dropdown options based on tier
  const buildDeptDropdownOptions = () => {
    if (!departments || departments?.length === 0) return [];
    if (isCommand(effectiveTier)) {
      return [
        { id: 'ALL', label: 'All' },
        ...(departments || [])?.map(d => ({ id: d?.id, label: d?.name }))
      ];
    }
    if (isChief(effectiveTier)) {
      // CHIEF: own dept first, then others (view-only)
      const ownDept = departments?.find(d => d?.id === userDepartmentId);
      const otherDepts = (departments || [])?.filter(d => d?.id !== userDepartmentId);
      return [
        ...(ownDept ? [{ id: ownDept?.id, label: ownDept?.name }] : []),
        ...(otherDepts || [])?.map(d => ({ id: d?.id, label: d?.name, viewOnly: true }))
      ];
    }
    // HOD, CREW, VIEW_ONLY: only own department (dropdown disabled)
    const ownDept = departments?.find(d => d?.id === userDepartmentId);
    return ownDept ? [{ id: ownDept?.id, label: ownDept?.name }] : [];
  };

  const deptDropdownOptions = buildDeptDropdownOptions();
  // Only COMMAND and CHIEF can toggle department
  const canToggleDept = isCommand(effectiveTier) || isChief(effectiveTier);

  const handleDeptSelect = (opt) => {
    setDepartmentFilter({ id: opt?.id, label: opt?.label });
    setShowDeptDropdown(false);
  };

  const handleCreateTask = async (taskData) => {
    const userId = authUser?.id || currentUser?.id;
    const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(val);

    // Determine board_id: prefer boardId, then board field
    const boardId = taskData?.boardId || taskData?.board || null;
    // Determine department_id
    let departmentId = taskData?.department_id || taskData?.department || null;
    // Determine assigned_to
    const assignedTo = taskData?.assigned_to || taskData?.assignees?.[0] || null;
    // Determine status
    const jobStatus = taskData?.status || 'active';

    // If the job already has a supabase_id, it was saved directly to Supabase
    // (e.g. from ComprehensiveJobModal). Just add to local state and refresh.
    if (taskData?.supabase_id || (taskData?.id && isValidUUID(taskData?.id) && !taskData?.id?.startsWith('card-'))) {
      const supabaseId = taskData?.supabase_id || taskData?.id;
      const newCard = {
        ...taskData,
        id: supabaseId,
        supabase_id: supabaseId,
        type: 'task',
        board: boardId,
        boardId: boardId,
        status: jobStatus,
        department: departmentId,
        department_id: departmentId,
        assigned_to: assignedTo,
      };
      const updatedCards = [...cards, newCard];
      setCards(updatedCards); saveCards(updatedCards);
      setShowCreateCard(null); setShowCreateCardBoardId(null);
      fetchJobsFromSupabase(departmentFilter);
      return;
    }

    const optimisticId = `card-${Date.now()}`;
    const newCard = {
      ...taskData,
      id: optimisticId,
      type: 'task',
      board: boardId,
      boardId: boardId,
      status: jobStatus,
      department: departmentId,
      department_id: departmentId,
      assigned_to: assignedTo,
      notes: taskData?.notes || [],
      attachments: taskData?.attachments || [],
      activity: taskData?.activity || [],
      checklist: taskData?.checklist || []
    };
    const updatedCards = [...cards, newCard];
    setCards(updatedCards); saveCards(updatedCards);
    setShowCreateCard(null); setShowCreateCardBoardId(null);
    if (taskData?.assignees?.length > 0) {
      notifyJobAssigned(taskData?.assignees, taskData?.title, newCard?.id, taskData?.dueDate);
    }

    // Save to Supabase
    if (activeTenantId && userId) {
      try {
        const insertPayload = {
          tenant_id: activeTenantId,
          title: taskData?.title,
          description: taskData?.description || null,
          created_by: userId,
          status: jobStatus,
          priority: taskData?.priority || null,
          is_private: taskData?.isPrivate || taskData?.private || false,
          assigned_to: assignedTo && isValidUUID(assignedTo) ? assignedTo : null,
          pending_for_department: taskData?.pendingForDepartment && isValidUUID(taskData?.pendingForDepartment) ? taskData?.pendingForDepartment : null,
          source_department: taskData?.sourceDepartment && isValidUUID(taskData?.sourceDepartment) ? taskData?.sourceDepartment : null,
          metadata: taskData?.metadata || [],
        };
        if (boardId && isValidUUID(boardId)) insertPayload.board_id = boardId;
        if (departmentId && isValidUUID(departmentId)) insertPayload.department_id = departmentId;
        if (taskData?.dueDate) insertPayload.due_date = taskData?.dueDate;

        const { data: insertedJob, error: insertError } = await supabase
          ?.from('team_jobs')?.insert(insertPayload)?.select('id')?.single();
        if (insertError) {
          console.warn('[handleCreateTask] Supabase insert error:', insertError);
          // Keep optimistic card but mark it as local-only
        } else if (insertedJob?.id) {
          const reconciledCards = updatedCards?.map(c =>
            c?.id === optimisticId ? { ...c, supabase_id: insertedJob?.id, id: insertedJob?.id } : c
          );
          setCards(reconciledCards); saveCards(reconciledCards);
        }
      } catch (err) {
        console.warn('[handleCreateTask] Unexpected error saving to Supabase:', err);
      }
    }

    // Refresh from Supabase to get the latest state
    fetchJobsFromSupabase(departmentFilter);
  };

  const handleCreateDutySet = (dutySetData) => {
    const newDutySet = { ...dutySetData, id: `dutyset-${Date.now()}`, type: 'dutyset', status: 'pending' };
    const updatedCards = [...cards, newDutySet];
    setCards(updatedCards); saveCards(updatedCards);
    setShowCreateCard(null); setShowCreateCardBoardId(null);
  };

  // Complete a job: mark as completed with strikethrough (stays on card until next day)
  const handleCompleteJob = async (jobId, e) => {
    if (e) e?.stopPropagation();
    if (completingJobId === jobId) return;
    setCompletingJobId(jobId);

    const job = cards?.find(c => c?.id === jobId) || supabaseJobs?.find(c => c?.id === jobId);
    if (!job) { setCompletingJobId(null); return; }

    const userId = authUser?.id || currentUser?.id;
    const completedAt = new Date()?.toISOString();

    // Toggle: if already completed, unmark it
    const newStatus = job?.status === 'completed' ? 'pending' : 'completed';

    // If un-ticking a job, remove it from hiddenCompletedIds so it becomes visible again
    if (newStatus === 'pending') {
      setHiddenCompletedIds(prev => {
        const next = new Set(prev);
        next?.delete(jobId);
        if (job?.supabase_id) next?.delete(job?.supabase_id);
        persistHiddenIds(next);
        return next;
      });
    }

    const updatedCards = cards?.map(c =>
      c?.id === jobId
        ? { ...c, status: newStatus, completedBy: newStatus === 'completed' ? userId : null, completedAt: newStatus === 'completed' ? completedAt : null }
        : c
    );
    setCards(updatedCards);
    saveCards(updatedCards);

    // Also update supabaseJobs so mergedCards reflects the change immediately
    // (rotation jobs live in supabaseJobs and would otherwise override the cards update)
    setSupabaseJobs(prev => prev?.map(j =>
      j?.id === jobId
        ? { ...j, status: newStatus, completedBy: newStatus === 'completed' ? userId : null, completedAt: newStatus === 'completed' ? completedAt : null }
        : j
    ));

    // Sync to Supabase
    const supabaseId = job?.supabase_id || (job?.id?.includes('-') && !job?.id?.startsWith('card-') ? job?.id : null);
    if (supabaseId && activeTenantId) {
      try {
        await supabase?.from('team_jobs')?.update({
          status: newStatus,
          completed_at: newStatus === 'completed' ? completedAt : null,
          completed_by: newStatus === 'completed' ? userId : null,
          completion_date: newStatus === 'completed' ? completedAt?.split('T')?.[0] : null,
          updated_at: new Date()?.toISOString(),
        })?.eq('id', supabaseId)?.eq('tenant_id', activeTenantId);
      } catch (err) {
        console.warn('Failed to sync completion to Supabase:', err);
      }
    }
    setCompletingJobId(null);
  };

  const handleCompleteTask = (cardId, completedBy) => {
    const updatedCards = cards?.map(c =>
      c?.id === cardId ? { ...c, status: 'completed', completedBy, completedAt: new Date()?.toISOString() } : c
    );
    setCards(updatedCards);
    saveCards(updatedCards);

    // Sync to Supabase for rotation jobs and any job with a supabase_id
    const job = cards?.find(c => c?.id === cardId) || supabaseJobs?.find(c => c?.id === cardId);
    const supabaseId = job?.supabase_id || (job?.id?.includes('-') && !job?.id?.startsWith('card-') ? job?.id : null);
    if (supabaseId && activeTenantId) {
      const completedAt = new Date()?.toISOString();
      const userId = authUser?.id || currentUser?.id || completedBy;
      supabase?.from('team_jobs')?.update({
        status: 'completed',
        completed_at: completedAt,
        completed_by: userId,
        completion_date: completedAt?.split('T')?.[0],
        updated_at: new Date()?.toISOString(),
      })?.eq('id', supabaseId)?.eq('tenant_id', activeTenantId)
        ?.then(({ error }) => {
          if (error) console.warn('[TeamJobs] Failed to sync completion to Supabase:', error);
        });
    }
  };

  const handleCardClick = (card) => { setSelectedCard(card); };

  const handleCardUpdate = (updatedCard) => {
    const updatedCards = cards?.map(c => c?.id === updatedCard?.id ? updatedCard : c);
    setCards(updatedCards); saveCards(updatedCards); setSelectedCard(updatedCard);
  };

  const handleCardDelete = (cardId) => {
    const updatedCards = cards?.filter(c => c?.id !== cardId);
    setCards(updatedCards); saveCards(updatedCards); setSelectedCard(null);
  };

  // Merge supabaseJobs into cards: supabase jobs take precedence by supabase_id
  const mergedCards = React.useMemo(() => {
    const safeCards = Array.isArray(cards) ? cards : [];
    if (supabaseJobs?.length === 0) return safeCards;
    const supabaseIds = new Set(supabaseJobs?.map(j => j?.supabase_id));
    // Keep ONLY local-only cards that have NO supabase_id (truly local, never saved to Supabase)
    // Exclude any local card that has a supabase_id — those are managed by Supabase and
    // must not bleed through when the department filter changes
    const localOnly = safeCards?.filter(c => !c?.supabase_id || !supabaseIds?.has(c?.supabase_id));
    return [...supabaseJobs, ...localOnly];
  }, [supabaseJobs, cards]);

  const tasks = mergedCards?.filter(c => c?.type === 'task' || !c?.type);
  const dutySets = mergedCards?.filter(c => c?.type === 'dutyset');
  // Apply department filter client-side as a safety net so stale local cards
  // never appear in the wrong department column
  const allItems = [...tasks, ...dutySets]?.filter(item => {
    if (!departmentFilter && !_effectiveDeptId) return true;
    if (departmentFilter?.id === 'ALL') return true;
    // Always include jobs assigned to current user (they belong in My Jobs regardless of dept filter)
    const itemAssignedTo = item?.assigned_to ?? item?.assignedTo ?? (Array.isArray(item?.assignees) ? item?.assignees?.[0] : null);
    if (itemAssignedTo && (itemAssignedTo === me || itemAssignedTo === currentUserId)) return true;
    // Use _effectiveDeptId (falls back to userDepartmentId when filter not yet set)
    const filterDeptId = _effectiveDeptId;
    if (!filterDeptId) return true;
    // Items with no department_id: only show in 'ALL' view or if they have no supabase_id (purely local)
    if (!item?.department_id) return !item?.supabase_id;
    return item?.department_id === filterDeptId;
  });

  const pendingReviewCount = mergedCards?.filter(c => {
    if (c?.status !== 'pending_acceptance' && c?.status !== 'pending_review') return false;
    // COMMAND sees all departments
    if (isCommand(effectiveTier)) return true;
    // CHIEF sees only their own department
    if (isChief(effectiveTier)) {
      if (!userDepartmentId) return true;
      return c?.department_id === userDepartmentId || c?.department === userDepartmentId;
    }
    return false;
  })?.length || 0;

  const today = new Date()?.toISOString()?.split('T')?.[0];
// replace with local date to avoid timezone mismatch where rotation jobs for "today" are excluded
  const todayLocal = (() => {
    const d = new Date();
    const y = d?.getFullYear();
    const m = String(d?.getMonth() + 1)?.padStart(2, '0');
    const day = String(d?.getDate())?.padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  // Open items: not archived, no board, due today or overdue — only jobs assigned to current user
  const openItems = allItems?.filter(item => {
    if (item?.archived === true) return false;
    // For rotation jobs: allow even if board is set (rotation jobs may have board_id from RPC)
    if (item?.board && item?.source !== 'rotation') return false;
    if (item?.status === 'completed') return false;
    // Must be assigned to current user — check assigned_to first (direct Supabase field), then assignees
    const assignedTo =
      item?.assigned_to ??
      item?.assignedTo ??
      (Array.isArray(item?.assignees) ? item?.assignees?.[0] : null);
    if (!assignedTo || assignedTo !== currentUserId) return false;
    // Completed-today jobs: skip due-date check (they already passed it when they were open)
    if (item?.status === 'completed') return true;
    // Resolve due date — support both snake_case and camelCase
    const rawDue =
      item?.due_date ??
      item?.dueDate ??
      item?.due_date_str ??
      null;
    const dueDate = rawDue ? String(rawDue)?.split('T')?.[0] : null;
    // No due date = always show (job is open and assigned to me)
    if (!dueDate) return true;
    // Only show if due today or overdue (applies to ALL jobs including rotation)
    if (dueDate > todayLocal) return false;
    // Resolve department id — support both snake_case and camelCase
    const itemDeptId =
      item?.department_id ??
      item?.departmentId ??
      null;
    // Include if dept matches OR if item has no dept (unassigned dept jobs still belong to user)
    if (itemDeptId && itemDeptId !== userDepartmentId) return false;
    return true;
  });

  // My Jobs: jobs assigned to current user, due today or overdue, still open (not completed)
  // Includes rotation jobs but only if due today
  const myJobsItems = allItems?.filter(item => {
    if (item?.archived === true) return false;
    // Allow completed jobs only if completed today (they stay visible until next day/refresh)
    if (item?.status === 'completed') {
      const completedDate = item?.completedAt ? item?.completedAt?.split('T')?.[0] : null;
      if (!completedDate || completedDate < todayLocal) return false;
      // Completed today — still need to pass the assignee check below
    }
    // Resolve assigned user — support both snake_case and camelCase (Rocket mapping inconsistency)
    const assignedTo =
      item?.assigned_to ??
      item?.assignedTo ??
      (Array.isArray(item?.assignees) ? item?.assignees?.[0] : null);
    if (!assignedTo || assignedTo !== me) return false;
    // Completed-today jobs: skip due-date check (they already passed it when they were open)
    if (item?.status === 'completed') return true;
    // Resolve due date — support both snake_case and camelCase
    const rawDue =
      item?.due_date ??
      item?.dueDate ??
      item?.due_date_str ??
      null;
    const dueDate = rawDue ? String(rawDue)?.split('T')?.[0] : null;
    // No due date = always show (job is open and assigned to me)
    if (!dueDate) return true;
    // Only show if due today or overdue (applies to ALL jobs including rotation)
    if (dueDate > todayLocal) return false;
    // Resolve department id — support both snake_case and camelCase
    const itemDeptId =
      item?.department_id ??
      item?.departmentId ??
      null;
    // Include if dept matches OR if item has no dept (unassigned dept jobs still belong to user)
    if (itemDeptId && itemDeptId !== userDepartmentId) return false;
    return true;
  });

  // Determine if user is viewing their own department or a different one
  const isViewingOwnDept = !departmentFilter?.id || departmentFilter?.id === userDepartmentId;

  // Open jobs for the currently selected department (used when viewing another dept)
  // Shows ALL open jobs for that dept due today or earlier (not just user's jobs)
  const openJobsForSelectedDept = allItems?.filter(item => {
    if (item?.archived === true) return false;
    if (item?.status === 'completed') {
      // Show completed-today jobs
      const completedDate = item?.completedAt ? item?.completedAt?.split('T')?.[0] : null;
      if (!completedDate || completedDate < todayLocal) return false;
    }
    // Must belong to the selected department
    const itemDeptId = item?.department_id ?? item?.departmentId ?? null;
    if (departmentFilter?.id && departmentFilter?.id !== 'ALL') {
      if (!itemDeptId || itemDeptId !== departmentFilter?.id) return false;
    }
    // Only jobs not on a board (unboarded open jobs)
    if (item?.board && item?.source !== 'rotation') return false;
    // Exclude future-dated jobs — only show due today or overdue
    const rawDue =
      item?.due_date ??
      item?.dueDate ??
      item?.due_date_str ??
      null;
    const dueDate = rawDue ? String(rawDue)?.split('T')?.[0] : null;
    if (dueDate && dueDate > todayLocal) return false;
    return true;
  });

  const getBoardItems = (boardId) => {
    return allItems?.filter(item => {
      if (item?.board !== boardId || item?.archived) return false;
      // Hide completed jobs that have been refreshed away (user clicked Refresh or new day)
      if (item?.status === 'completed') {
        const itemId = item?.id;
        const supabaseId = item?.supabase_id;
        if (hiddenCompletedIds?.has(itemId) || (supabaseId && hiddenCompletedIds?.has(supabaseId))) return false;
      }
      return true;
    });
  };

  // Get open items for a specific department (used in ALL view)
  const getOpenItemsForDept = (deptId) => {
    return mergedCards?.filter(item => {
      if (item?.archived) return false;
      if (!item?.board) {
        // Only items with no board assignment
        if (!item?.department_id) return false;
        return item?.department_id === deptId;
      }
      return false;
    })?.filter(item => {
      const dueDate = item?.dueDate ? item?.dueDate?.split('T')?.[0] : null;
      return !item?.board || (dueDate && dueDate <= today);
    });
  };

  // For ALL view: get all open items (no board) for a department
  const getAllViewDeptItems = (deptId) => {
    return mergedCards?.filter(item => {
      if (item?.archived) return false;
      if (item?.board) return false;
      if (!item?.department_id) return false;
      if (item?.department_id !== deptId) return false;
      return true;
    });
  };

  // For ALL view: get My Jobs for a specific department (assigned to current user, no board)
  const getMyJobsForDept = (deptId) => {
    return mergedCards?.filter(item => {
      if (item?.archived === true) return false;
      // Allow completed jobs only if completed today (they stay visible until next day/refresh)
      if (item?.status === 'completed') {
        const completedDate = item?.completedAt ? item?.completedAt?.split('T')?.[0] : null;
        if (!completedDate || completedDate < todayLocal) return false;
        // Completed today — still need to pass the assignee check below
      }
      // Resolve assigned user — support both snake_case and camelCase (Rocket mapping inconsistency)
      const assignedTo =
        item?.assigned_to ??
        item?.assignedTo ??
        (Array.isArray(item?.assignees) ? item?.assignees?.[0] : null);
      if (!assignedTo || assignedTo !== me) return false;
      // Completed-today jobs: skip due-date check (they already passed it when they were open)
      if (item?.status === 'completed') return true;
      // Resolve due date — support both snake_case and camelCase
      const rawDue =
        item?.due_date ??
        item?.dueDate ??
        item?.due_date_str ??
        null;
      const dueDate = rawDue ? String(rawDue)?.split('T')?.[0] : null;
      // No due date = always show (job is open and assigned to me)
      if (!dueDate) return true;
      // Only show if due today or overdue (applies to ALL jobs including rotation)
      if (dueDate > todayLocal) return false;
      // Resolve department id — support both snake_case and camelCase
      const itemDeptId =
        item?.department_id ??
        item?.departmentId ??
        null;
      // Include if dept matches OR if item has no dept (unassigned dept jobs still belong to user)
      if (itemDeptId && itemDeptId !== deptId) return false;
      return true;
    });
  };

  // For ALL view: get all open unassigned/unboarded jobs for a department
  const getOpenJobsForDept = (deptId) => {
    return mergedCards?.filter(item => {
      if (item?.archived) return false;
      if (item?.status === 'completed') return false;
      if (!item?.department_id) return false;
      if (item?.department_id !== deptId) return false;
      if (item?.board) return false;
      // Only show jobs due today or overdue (exclude future-dated jobs)
      const rawDue =
        item?.due_date ??
        item?.dueDate ??
        item?.due_date_str ??
        null;
      const dueDate = rawDue ? String(rawDue)?.split('T')?.[0] : null;
      if (dueDate && dueDate > todayLocal) return false;
      return true;
    });
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-400';
    }
  };

  const renderJobCard = (item) => {
    const isDutySet = item?.type === 'dutyset';
    const isCompleted = item?.status === 'completed';
    // Show checkbox only when canComplete
    const isPrivateOwner = isPrivateJobOwner(item, currentUserId);
    // Rotation jobs assigned to current user are always completable
    const isRotationAssignedToMe = item?.source === 'rotation' && (
      item?.assigned_to === currentUserId || item?.assignedTo === currentUserId ||
      (Array.isArray(item?.assignees) && item?.assignees?.includes(currentUserId))
    );
    const canCompleteThis = !tierLoading && (isRotationAssignedToMe || canCompleteJob(
      effectiveTier, selectedDeptId, userDepartmentId, isPrivateOwner
    ));
    const showCheckbox = !isDutySet && canCompleteThis;
    // Show edit pen only when user can edit department AND job is not from rotation AND tier is COMMAND/CHIEF/HOD
    const isEditableTier = effectiveTier === 'COMMAND' || effectiveTier === 'CHIEF' || effectiveTier === 'HOD';
    const isPrivateBoard = isPrivateBoardOwner(item, currentUserId);
    const showEditPen = !isDutySet && _canEditDept && item?.source !== 'rotation' && isEditableTier;
    const isCheckboxLoading = completingJobId === item?.id;

    return (
      <div
        key={item?.id}
        onClick={() => !isDutySet && handleCardClick(item)}
        className={`bg-background rounded-xl border border-border p-3.5 hover:shadow-sm transition-all cursor-pointer mb-2.5 ${
          isCompleted ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-start gap-2 mb-2">
          {/* Checkbox for non-dutyset jobs — only when canComplete */}
          {showCheckbox && (
            <button
              onClick={(e) => handleCompleteJob(item?.id, e)}
              disabled={isCheckboxLoading}
              className="flex-shrink-0 mt-0.5 focus:outline-none"
              title={isCompleted ? 'Mark as open' : 'Mark as complete'}
            >
              {isCheckboxLoading ? (
                <div className="w-4 h-4 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
              ) : isCompleted ? (
                <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-500 flex items-center justify-center">
                  <Icon name="Check" size={10} className="text-white" />
                </div>
              ) : (
                <div className="w-4 h-4 rounded border-2 border-border hover:border-primary transition-colors" />
              )}
            </button>
          )}

          {isDutySet ? (
            <Icon name="ListChecks" size={14} className="text-primary flex-shrink-0 mt-0.5" />
          ) : (
            !showCheckbox && item?.priority && (
              <div className={`w-2 h-2 rounded-full ${getPriorityColor(item?.priority)} flex-shrink-0 mt-1.5`} />
            )
          )}

          {/* Priority dot (when checkbox shown, show it after) */}
          {!isDutySet && showCheckbox && item?.priority && (
            <div className={`w-2 h-2 rounded-full ${getPriorityColor(item?.priority)} flex-shrink-0 mt-1.5`} />
          )}

          <p className={`text-sm font-medium text-foreground line-clamp-2 flex-1 ${
            isCompleted ? 'line-through text-muted-foreground' : ''
          }`}>
            {isDutySet ? item?.name : item?.title}
          </p>

          {/* Edit pen icon — only when canEditDepartment */}
          {showEditPen && (
            <button
              onClick={(e) => { e?.stopPropagation(); setEditingJob(item); }}
              className="flex-shrink-0 p-1 rounded hover:bg-muted transition-colors"
              title="Edit job"
            >
              <Icon name="Pencil" size={12} className="text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {item?.dueDate && (
          <div className="flex items-center gap-1 mt-1.5">
            <Icon name="Calendar" size={12} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {new Date(item?.dueDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}
      </div>
    );
  };

  // Render items in a column: open first, then a divider, then completed
  const renderColumnItems = (items) => {
    const openJobs = items?.filter(i => i?.status !== 'completed');
    const completedJobs = items?.filter(i => i?.status === 'completed');
    return (
      <>
        <div>{openJobs?.map(renderJobCard)}</div>
        {completedJobs?.length > 0 && (
          <>
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Icon name="CheckCircle" size={11} className="text-green-500" />
                Completed today ({completedJobs?.length})
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div>{completedJobs?.map(renderJobCard)}</div>
          </>
        )}
      </>
    );
  };

  // Handle Accept with Edit — opens JobEditModal in acceptance mode
  const handleAcceptWithEdit = (card) => {
    setAcceptanceJob(card);
    setShowReviewQueue(false);
  };

  // Handle Reject pending job — update status and notify sender
  const handleRejectPending = (cardId, rejectionNotes) => {
    const card = cards?.find(c => c?.id === cardId);
    const updatedCards = cards?.map(c =>
      c?.id === cardId
        ? { ...c, status: 'rejected', rejectionNotes, rejectedAt: new Date()?.toISOString(), rejectedBy: currentUserId }
        : c
    );
    setCards(updatedCards);
    saveCards(updatedCards);

    // Notify sender
    const senderId = card?.created_by || card?.createdBy;
    if (senderId) {
      const rejectorDept = currentTenantMember?.department?.name || enhancedUser?.department || 'your department';
      notifySenderDeclined(
        senderId,
        card?.title || 'Job',
        cardId,
        rejectorDept,
        rejectionNotes
      );
    }

    // Persist rejection to Supabase if possible
    const supabaseId = card?.supabase_id || (card?.id?.includes('-') && !card?.id?.startsWith('card-') ? card?.id : null);
    if (supabaseId && activeTenantId) {
      supabase?.from('team_jobs')?.update({
        status: 'rejected',
        updated_at: new Date()?.toISOString(),
      })?.eq('id', supabaseId)?.eq('tenant_id', activeTenantId)?.then(({ error }) => {
        if (error) console.warn('[TeamJobs] Failed to persist rejection:', error);
      });
    }
  };

  return (
    <div
      className="min-h-screen bg-background transition-colors duration-300"
      onClick={(e) => {
        setShowBoardMenu(null);
        setShowDeptDropdown(false);
      }}
    >
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto pt-24">
        {/* Loading skeleton while tenantMember is loading */}
        {tierLoading ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="h-8 w-32 bg-muted rounded animate-pulse mb-2" />
                <div className="h-4 w-56 bg-muted rounded animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-9 w-36 bg-muted rounded animate-pulse" />
                <div className="h-9 w-28 bg-muted rounded animate-pulse" />
              </div>
            </div>
            <div className="flex gap-5">
              {[1, 2, 3]?.map(i => (
                <div key={i} className="flex-shrink-0 w-72 bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                  <div className="px-4 py-4 border-b border-border">
                    <div className="h-5 w-24 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="p-4 space-y-3">
                    {[1, 2, 3]?.map(j => (
                      <div key={j} className="h-16 bg-muted/40 rounded-xl animate-pulse" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
        {/* Page Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Jobs</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage all team tasks and boards</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Department Filter - COMMAND tier only */}
            {isCommand(effectiveTier) && (
              <div className="relative" onClick={e => e?.stopPropagation()}>
                <button
onClick={() => canToggleDept && departments?.length > 0 && setShowDeptDropdown(!showDeptDropdown)}
                disabled={!canToggleDept || departments?.length === 0 || deptLoading}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground transition-colors ${
                  canToggleDept && departments?.length > 0 ? 'hover:bg-muted cursor-pointer' : 'opacity-60 cursor-not-allowed'
                }`}
              >
                <span className="text-muted-foreground">Department:</span>
                {deptLoading ? (
                  <span className="font-medium text-muted-foreground">Loading...</span>
                ) : departments?.length === 0 ? (
                  <span className="font-medium text-muted-foreground">No departments configured</span>
                ) : (
                  <span className="font-medium">{departmentFilter?.label || 'All'}</span>
                )}
                {canToggleDept && departments?.length > 0 && (
                  <Icon name="ChevronDown" size={14} className="text-muted-foreground" />
                )}
              </button>
{showDeptDropdown && deptDropdownOptions?.length > 0 && (
                <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[180px]">
{deptDropdownOptions?.map(opt => (
                    <button
                      key={opt?.id}
                      onClick={() => handleDeptSelect(opt)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg ${
                        departmentFilter?.id === opt?.id ? 'text-primary font-medium' : 'text-foreground'
                      }`}
                    >
                      {opt?.label}
                      {opt?.viewOnly && (
                        <span className="ml-1 text-xs text-muted-foreground">(view only)</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Pending Acceptance — visible to COMMAND and CHIEF only */}
            {_canSeePending && (
              <button
                onClick={() => setShowReviewQueue(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Pending Acceptance ({pendingReviewCount})
              </button>
            )}

            {/* Create Job — gated by canAddJob */}
            {_canAddJob && (
              <button
                onClick={() => setShowComprehensiveModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Icon name="Plus" size={15} />
                Create Job
              </button>
            )}

            {/* Archive button - COMMAND and CHIEF only */}
            {canShowArchive && (
              <button
                onClick={() => setShowArchiveModal(true)}
                className="p-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
                title="Job History Archive"
              >
                <Icon name="Archive" size={18} className="text-foreground" />
              </button>
            )}

            {/* Refresh button - COMMAND and CHIEF only */}
            {canShowArchive && (
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="p-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
                title="Refresh jobs and archive completed"
              >
                <Icon
                  name="RefreshCw"
                  size={18}
                  className={`text-foreground ${isRefreshing ? 'animate-spin' : ''}`}
                />
              </button>
            )}

            {/* Manage Rotation */}
            <button
              onClick={() => navigate('/duty-sets-rotation-management')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="Calendar" size={15} className="text-muted-foreground" />
              Manage Rotation
            </button>
          </div>
        </div>

        {/* Drag mode banner */}
        {dragMode && (
          <div className="mb-4 flex items-center justify-between px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-xl">
            <div className="flex items-center gap-2">
              <Icon name="GripHorizontal" size={16} className="text-primary" />
              <span className="text-sm font-medium text-primary">Board reorder mode — drag boards to rearrange. Your order is private.</span>
            </div>
            <button
              onClick={(e) => { e?.stopPropagation(); exitDragMode(); }}
              className="text-xs font-medium text-primary hover:text-primary/70 transition-colors px-2 py-1 rounded hover:bg-primary/10"
            >
              Done
            </button>
          </div>
        )}

        {/* Shake keyframe style */}
        <style>{`
          @keyframes boardShake {
            0%, 100% { transform: rotate(0deg); }
            15% { transform: rotate(-1.5deg); }
            30% { transform: rotate(1.5deg); }
            45% { transform: rotate(-1.5deg); }
            60% { transform: rotate(1.5deg); }
            75% { transform: rotate(-1deg); }
            90% { transform: rotate(1deg); }
          }
          .board-shake { animation: boardShake 0.6s ease-in-out; }
          @keyframes boardWiggle {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(-0.8deg); }
            75% { transform: rotate(0.8deg); }
          }
          .board-wiggle { animation: boardWiggle 0.5s ease-in-out infinite; }
          .board-shifting { transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important; }
        `}</style>

        {/* Boards Layout */}
        <div
          className="flex gap-5 overflow-x-auto pb-6"
          style={{ alignItems: 'flex-start' }}
        >
          {departmentFilter?.id === 'ALL' ? (
            /* ALL view: My Jobs + Open Jobs columns per department */
            (departments?.length === 0 ? (<div className="flex-shrink-0 w-72 bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <h2 className="text-base font-bold text-foreground">Open Jobs</h2>
              </div>
              <div className="p-4">
                <div className="bg-muted/40 rounded-xl p-8 text-center">
                  <p className="text-sm font-medium text-foreground">No departments configured</p>
                </div>
              </div>
            </div>) : (
              <>
                {departments?.map(dept => {
                  const myJobsDept = getMyJobsForDept(dept?.id);
                  const openJobsDept = getOpenJobsForDept(dept?.id);
                  const myJobsCount = myJobsDept?.filter(i => i?.status !== 'completed')?.length;
                  const openCount = openJobsDept?.filter(i => i?.status !== 'completed')?.length;
                  return (
                    <React.Fragment key={dept?.id}>
                      {/* My Jobs column: only show for the COMMAND user's own department */}
                      {dept?.id === userDepartmentId && (
                        <div className="flex-shrink-0 w-72 bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                            <div>
                              <h2 className="text-base font-bold text-foreground">My Jobs</h2>
                              <p className="text-xs text-muted-foreground mt-0.5">{dept?.name}</p>
                            </div>
                            <span className="text-sm text-muted-foreground">{myJobsCount} tasks</span>
                          </div>
                          <div className="p-4">
                            {jobsLoading ? (
                              <div className="bg-muted/40 rounded-xl p-8 text-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                                <p className="text-xs text-muted-foreground">Loading jobs...</p>
                              </div>
                            ) : myJobsDept?.length === 0 ? (
                              <div className="bg-muted/40 rounded-xl p-8 text-center">
                                <div className="w-10 h-10 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center mx-auto mb-3">
                                  <Icon name="Check" size={18} className="text-muted-foreground/50" />
                                </div>
                                <p className="text-sm font-medium text-foreground mb-1">
                                  {departmentFilter?.id !== 'ALL' && departmentFilter?.id
                                    ? `No jobs for ${departmentFilter?.label}`
                                    : 'No open jobs'}
                          </p>
                          <p className="text-xs text-muted-foreground">Nothing due today and nothing overdue.</p>
                        </div>
                  ) : (
                    renderColumnItems(myJobsDept)
                  )}
                          </div>
                        </div>
                      )}
                      {/* Open Jobs column: show for every department */}
                      <div className="flex-shrink-0 w-72 bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                          <div>
                            <h2 className="text-base font-bold text-foreground">Open Jobs</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">{dept?.name}</p>
                          </div>
                          <span className="text-sm text-muted-foreground">{openCount} tasks</span>
                        </div>
                        <div className="p-4">
                          {jobsLoading ? (
                            <div className="bg-muted/40 rounded-xl p-8 text-center">
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                              <p className="text-xs text-muted-foreground">Loading jobs...</p>
                            </div>
                          ) : openJobsDept?.length === 0 ? (
                            <div className="bg-muted/40 rounded-xl p-8 text-center">
                              <div className="w-10 h-10 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center mx-auto mb-3">
                                <Icon name="Inbox" size={18} className="text-muted-foreground/50" />
                              </div>
                              <p className="text-sm font-medium text-foreground mb-1">No open jobs</p>
                              <p className="text-xs text-muted-foreground">All caught up for {dept?.name}.</p>
                            </div>
                          ) : (
                            renderColumnItems(openJobsDept)
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </>
            ))
          ) : (
            /* Specific department view: Open Jobs + custom boards for that department */
            (<>
              {/* My Jobs / Open Jobs Column — dynamic based on whether viewing own dept */}
              <div className="flex-shrink-0 w-72 bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {isViewingOwnDept ? 'My Jobs' : 'Open Jobs'}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{departmentFilter?.label}</p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {isViewingOwnDept
                      ? myJobsItems?.filter(i => i?.status !== 'completed')?.length
                      : openJobsForSelectedDept?.filter(i => i?.status !== 'completed')?.length
                    } tasks
                  </span>
                </div>
                <div className="p-4">
                  {jobsLoading ? (
                    <div className="bg-muted/40 rounded-xl p-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                      <p className="text-xs text-muted-foreground">Loading jobs...</p>
                    </div>
                  ) : (isViewingOwnDept ? myJobsItems : openJobsForSelectedDept)?.length === 0 ? (
                    <div className="bg-muted/40 rounded-xl p-8 text-center">
                      <div className="w-10 h-10 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center mx-auto mb-3">
                        <Icon name="Inbox" size={18} className="text-muted-foreground/50" />
                      </div>
                      <p className="text-sm font-medium text-foreground mb-1">
                        {isViewingOwnDept
                          ? (departmentFilter?.id !== 'ALL' && departmentFilter?.id
                              ? `No jobs for ${departmentFilter?.label}`
                              : 'No open jobs')
                          : `No open jobs for ${departmentFilter?.label}`
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">Nothing due today and nothing overdue.</p>
                    </div>
                  ) : (
                    renderColumnItems(isViewingOwnDept ? myJobsItems : openJobsForSelectedDept)
                  )}
                </div>
              </div>
              {/* Board Columns — dnd-kit sortable */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => setActiveDragId(active?.id)}
                onDragEnd={handleDndDragEnd}
                onDragCancel={() => setActiveDragId(null)}
              >
                <SortableContext
                  items={orderedBoards?.map(b => b?.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {orderedBoards?.map((board, boardIdx) => {
                    const boardItems = getBoardItems(board?.id);
                    const showQuickAdd = canShowQuickAdd(board);
                    const personal = isPrivateBoardOwner(board, currentUserId);
                    const openCount = boardItems?.filter(i => i?.status !== 'completed')?.length;
                    const deptId = _effectiveDeptId && _effectiveDeptId !== 'ALL' ? _effectiveDeptId : null;
                    const displayBoardName = (deptId && board?.names?.[deptId]) ? board?.names?.[deptId] : (board?.name || 'Board');
                    const boardCanAdd = _canAddJob;
                    const boardCanDelete = _canDeleteBoard;
                    const boardCanRename = _canRenameBoard;
                    const isBeingDragged = draggingBoardId === board?.id;
                    const isDragOver = dragOverBoardId === board?.id;
                    const isShaking = shakingBoardId === board?.id;
                    const shiftStyle = getBoardShiftStyle(boardIdx, orderedBoards?.length);
                    return (
                      <SortableBoardWrapper key={board?.id} id={board?.id}>
                        {(dndListeners) => (
                        <div
                          data-board-id={board?.id}
                          className="flex-shrink-0 w-72 bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
                          style={{ cursor: activeDragId === board?.id ? 'grabbing' : undefined }}
                        >
                          {/* Board header: drag handle area — listeners applied here, blocked on interactive children */}
                          <div
                            className="flex items-center justify-between px-4 py-4 border-b border-border cursor-grab active:cursor-grabbing"
                            {...(() => {
                              const { onPointerDown: _dndPD, ...restListeners } = dndListeners || {};
                              return restListeners;
                            })()}
                            onPointerDown={(e) => {
                              const target = e?.target;
                              const blocked =
                                target?.closest('button') ||
                                target?.closest('a') ||
                                target?.closest('input') ||
                                target?.closest('textarea') ||
                                target?.closest('select') ||
                                target?.closest('[role="button"]') ||
                                target?.closest('[contenteditable]');
                              if (blocked) {
                                e?.stopPropagation();
                                return;
                              }
                              dndListeners?.onPointerDown?.(e);
                            }}
                          >
                            {editingBoardId === board?.id ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingBoardName}
                                onChange={(e) => setEditingBoardName(e?.target?.value)}
                                onBlur={() => handleBoardTitleSave(board?.id)}
                                onKeyDown={(e) => handleBoardTitleKeyDown(e, board?.id)}
                                className="text-base font-bold text-foreground bg-transparent border-b border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                                onClick={(e) => e?.stopPropagation()}
                                data-no-dnd="true"
                              />
                            ) : (
                              <h2
                                className={`text-base font-bold text-foreground flex-1 truncate ${
                                  boardCanAdd || boardCanDelete ? 'hover:text-primary transition-colors' : ''
                                }`}
                              >
                                {displayBoardName}
                              </h2>
                            )}
                            {(boardCanAdd || boardCanDelete) && (
                              <div className="relative" onClick={e => e?.stopPropagation()}>
                                <button
                                  onClick={() => setShowBoardMenu(showBoardMenu === board?.id ? null : board?.id)}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
                                >
                                  <Icon name="MoreHorizontal" size={16} className="text-muted-foreground" />
                                </button>
                                {showBoardMenu === board?.id && (
                                  <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[160px]">
                                    {boardCanAdd && (
                                      <button
                                        onClick={() => { setShowCreateCardBoardId(board?.id); setShowCreateCard('task'); setShowBoardMenu(null); }}
                                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors rounded-t-lg flex items-center gap-2"
                                      >
                                        <Icon name="Plus" size={14} />Add Job
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { setMoveBoardId(board?.id); setShowBoardMenu(null); }}
                                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                                    >
                                      <Icon name="ArrowLeftRight" size={14} />Move Board
                                    </button>
                                    {boardCanDelete && (
                                      <button
                                        onClick={() => handleDeleteBoard(board?.id)}
                                        className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-muted transition-colors rounded-b-lg flex items-center gap-2"
                                      >
                                        <Icon name="Trash2" size={14} />Delete Board
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            {boardItems?.length === 0 ? (
                              <div className="bg-muted/40 rounded-xl p-8 text-center mb-3">
                                <div className="w-10 h-10 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center mx-auto mb-3">
                                  <Icon name="Inbox" size={18} className="text-muted-foreground/50" />
                                </div>
                                <p className="text-sm font-medium text-foreground mb-1">
                                  {departmentFilter?.id !== 'ALL' && departmentFilter?.id
                                    ? `No jobs for ${departmentFilter?.label}`
                                    : 'No open jobs'}
                                </p>
                                <p className="text-xs text-muted-foreground">Nothing due today and nothing overdue.</p>
                              </div>
                            ) : (
                              <div className="mb-3">{renderColumnItems(boardItems)}</div>
                            )}
                            <div className="border-t border-border pt-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-muted-foreground">Total</span>
                                <span className="text-sm font-medium text-foreground">{openCount}</span>
                              </div>
                              <div className="border-t border-border pt-3" data-no-dnd="true">
                                {showQuickAdd ? (
                                  <QuickAddJobInput
                                    boardId={board?.id} board={board} onAdd={handleQuickAddJob}
                                    currentUserId={currentUserId} isPersonalBoard={personal}
                                  />
                                ) : (
                                  boardCanAdd && (
                                    <button
                                      onClick={() => { setShowCreateCardBoardId(board?.id); setShowCreateCard('task'); }}
                                      className="w-full flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      <Icon name="Plus" size={14} />Add Job
                                    </button>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        )}
                      </SortableBoardWrapper>
                    );
                  })}
                </SortableContext>
                {/* DragOverlay: ghost card shown while dragging */}
                <DragOverlay>
                  {activeDragId ? (() => {
                    const board = orderedBoards?.find(b => b?.id === activeDragId);
                    if (!board) return null;
                    const deptId = _effectiveDeptId && _effectiveDeptId !== 'ALL' ? _effectiveDeptId : null;
                    const displayBoardName = (deptId && board?.names?.[deptId]) ? board?.names?.[deptId] : (board?.name || 'Board');
                    return (
                      <div className="flex-shrink-0 w-72 bg-card rounded-2xl border-2 border-primary shadow-2xl overflow-hidden opacity-95 rotate-1">
                        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                          <h2 className="text-base font-bold text-foreground flex-1 truncate">{displayBoardName}</h2>
                        </div>
                        <div className="p-4">
                          <div className="bg-muted/40 rounded-xl p-6 text-center">
                            <Icon name="GripVertical" size={20} className="text-muted-foreground mx-auto" />
                          </div>
                        </div>
                      </div>
                    );
                  })() : null}
                </DragOverlay>
              </DndContext>
              {/* New Board Card — only when canCreateBoard */}
              {_canCreateBoard && (
                <div
                  onClick={() => setShowCreateBoard(true)}
                  className="flex-shrink-0 w-72 rounded-2xl border-2 border-dashed border-border hover:border-primary/40 transition-colors cursor-pointer flex flex-col items-center justify-center py-16 px-6 text-center"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Icon name="Plus" size={22} className="text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-1">New Board</h3>
                  <p className="text-sm text-muted-foreground">Create a custom board for your team</p>
                </div>
              )}

              {/* Move Board Modal */}
              {moveBoardId && (() => {
                const movingBoard = orderedBoards?.find(b => b?.id === moveBoardId);
                const deptId = _effectiveDeptId && _effectiveDeptId !== 'ALL' ? _effectiveDeptId : null;
                const movingBoardName = movingBoard ? ((deptId && movingBoard?.names?.[deptId]) ? movingBoard?.names?.[deptId] : (movingBoard?.name || 'Board')) : '';
                const currentIndex = orderedBoards?.findIndex(b => b?.id === moveBoardId);
                return (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMoveBoardId(null)}>
                    <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e?.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-foreground">Move Board</h2>
                        <button onClick={() => setMoveBoardId(null)} className="text-muted-foreground hover:text-foreground">
                          <Icon name="X" size={20} />
                        </button>
                      </div>
                      <p className="text-sm text-muted-foreground mb-4">Move <strong className="text-foreground">{movingBoardName}</strong> to position:</p>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {orderedBoards?.map((b, idx) => {
                          const bName = (deptId && b?.names?.[deptId]) ? b?.names?.[deptId] : (b?.name || 'Board');
                          const isCurrent = b?.id === moveBoardId;
                          return (
                            <button
                              key={b?.id}
                              disabled={isCurrent}
                              onClick={() => handleMoveBoard(moveBoardId, idx)}
                              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                                isCurrent
                                  ? 'bg-primary/10 text-primary font-medium cursor-default' :'hover:bg-muted text-foreground'
                              }`}
                            >
                              <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0">{idx + 1}</span>
                              {bName}
                              {isCurrent && <span className="ml-auto text-xs text-primary">(current)</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4">
                        <Button variant="outline" className="w-full" onClick={() => setMoveBoardId(null)}>Cancel</Button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>)
          )}
        </div>

        {/* Create Task Modal */}
        {showCreateCard === 'task' && (
          <CreateTaskModal
            boards={boards}
            defaultBoardId={showCreateCardBoardId}
            onClose={() => { setShowCreateCard(null); setShowCreateCardBoardId(null); }}
            onSubmit={handleCreateTask}
            onCreate={handleCreateTask}
            currentUser={enhancedUser}
            activeTenantId={activeTenantId}
            selectedDepartmentId={departmentFilter?.id !== 'ALL' ? departmentFilter?.id : userDepartmentId}
            teamMembers={teamMembers}
            currentTenantMember={currentTenantMember}
            propTenantMember={currentTenantMember}
            departments={departments}
            propDepartments={departments}
            activeTenantIdProp={activeTenantId}
            currentUserProp={enhancedUser}
          />
        )}

        {/* Comprehensive Job Modal */}
        {showComprehensiveModal && (
          <ComprehensiveJobModal
            boards={boards}
            defaultBoardId={comprehensiveModalBoardId}
            onClose={() => { setShowComprehensiveModal(false); setComprehensiveModalBoardId(null); }}
            onSubmit={handleCreateTask}
            onSuccess={handleCreateTask}
            currentUser={enhancedUser}
            currentUserProp={enhancedUser}
            activeTenantId={activeTenantId}
            activeTenantIdProp={activeTenantId}
            selectedDate={null}
          />
        )}

        {/* Self Reported Job Modal */}
        {showSelfReportedModal && (
          <SelfReportedJobModal
            onClose={() => setShowSelfReportedModal(false)}
            onSubmit={handleCreateTask}
            onSuccess={handleCreateTask}
            currentUser={enhancedUser}
            activeTenantId={activeTenantId}
          />
        )}

        {/* Review Queue Panel */}
        {showReviewQueue && (
          <ReviewQueuePanel
            cards={cards}
            onClose={() => setShowReviewQueue(false)}
            onUpdate={(updatedCards) => { setCards(updatedCards); saveCards(updatedCards); }}
            onAccept={(updatedCards) => { setCards(updatedCards); saveCards(updatedCards); }}
            onReject={handleRejectPending}
            onEdit={(job) => setEditingJob(job)}
            onConvertToPlanned={(job) => handleCreateTask(job)}
            onAcceptHandoff={(updatedCards) => { setCards(updatedCards); saveCards(updatedCards); }}
            onRejectHandoff={(updatedCards) => { setCards(updatedCards); saveCards(updatedCards); }}
            onReturnHandoff={(updatedCards) => { setCards(updatedCards); saveCards(updatedCards); }}
            onAcceptWithEdit={handleAcceptWithEdit}
            currentUser={enhancedUser}
            currentTenantMember={currentTenantMember}
            selectedDepartmentId={departmentFilter?.id !== 'ALL' ? departmentFilter?.id : null}
          />
        )}

        {/* Card Detail Modal */}
        {selectedCard && (
          <CardDetailModal
            card={selectedCard}
            onClose={() => setSelectedCard(null)}
            onUpdate={handleCardUpdate}
            onDelete={handleCardDelete}
            onComplete={handleCompleteTask}
            onArchive={() => {}}
            onUnarchive={() => {}}
            currentUser={enhancedUser}
            isChiefStew={isChief(effectiveTier)}
            teamMembers={teamMembers}
            modalMode={calcJobModalMode(effectiveTier, selectedDeptId, userDepartmentId, isPrivateJobOwner(selectedCard, currentUserId))}
            activeTenantId={activeTenantId}
          />
        )}

        {/* Job Edit Modal */}
        {editingJob && (
          <JobEditModal
            job={editingJob}
            onClose={() => setEditingJob(null)}
            onSave={(updatedJob) => {
              const updatedCards = cards?.map(c => c?.id === updatedJob?.id ? updatedJob : c);
              setCards(updatedCards); saveCards(updatedCards); setEditingJob(null);
              fetchJobsFromSupabase(departmentFilter);
            }}
            onSaved={(updatedJob) => {
              const updatedCards = cards?.map(c => c?.id === updatedJob?.id ? updatedJob : c);
              setCards(updatedCards); saveCards(updatedCards); setEditingJob(null);
              fetchJobsFromSupabase(departmentFilter);
            }}
            onAccepted={(acceptedJob) => {
              const updatedCards = cards?.map(c => c?.id === acceptedJob?.id ? acceptedJob : c);
              setCards(updatedCards);
              saveCards(updatedCards);
              setEditingJob(null);
              // Notify sender of acceptance
              const senderId = editingJob?.created_by || editingJob?.createdBy;
              if (senderId) {
                const acceptorDept = currentTenantMember?.department?.name || enhancedUser?.department || 'your department';
                notifySenderAccepted(senderId, editingJob?.title || 'Job', editingJob?.id, acceptorDept);
              }
              fetchJobsFromSupabase(departmentFilter);
            }}
            currentUser={enhancedUser}
            currentUserTier={effectiveTier}
            activeTenantId={activeTenantId}
          />
        )}

        {/* Acceptance Mode Job Edit Modal */}
        {acceptanceJob && (
          <JobEditModal
            job={acceptanceJob}
            acceptanceMode={true}
            boards={boards}
            departments={departments}
            onClose={() => setAcceptanceJob(null)}
            onAccepted={(acceptedJob) => {
              const updatedCards = cards?.map(c => c?.id === acceptedJob?.id ? acceptedJob : c);
              setCards(updatedCards);
              saveCards(updatedCards);
              setAcceptanceJob(null);
              // Notify sender of acceptance
              const senderId = acceptanceJob?.created_by || acceptanceJob?.createdBy;
              if (senderId) {
                const acceptorDept = currentTenantMember?.department?.name || enhancedUser?.department || 'your department';
                notifySenderAccepted(senderId, acceptedJob?.title || 'Job', acceptedJob?.id, acceptorDept);
              }
              fetchJobsFromSupabase(departmentFilter);
            }}
            onSaved={(updatedJob) => {
              const updatedCards = cards?.map(c => c?.id === updatedJob?.id ? updatedJob : c);
              setCards(updatedCards);
              saveCards(updatedCards);
              setAcceptanceJob(null);
              fetchJobsFromSupabase(departmentFilter);
            }}
            currentUser={enhancedUser}
            currentUserTier={effectiveTier}
            activeTenantId={activeTenantId}
          />
        )}

        {/* Job Archive Calendar Modal */}
        {showArchiveModal && (
          <JobArchiveCalendarModal
            onClose={() => setShowArchiveModal(false)}
            activeTenantId={activeTenantId}
            effectiveTier={effectiveTier}
            userDepartmentId={userDepartmentId}
            currentUserId={currentUserId}
          />
        )}
      </>
      )}
      </main>
    </div>
  );
};

export default TeamJobsManagement;