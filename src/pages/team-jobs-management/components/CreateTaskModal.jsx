import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import AssigneePicker from './AssigneePicker';
import '../job-modals.css';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import { normalizeTier, canAssignTo } from '../utils/tierPermissions';

const CreateTaskModal = ({ boards, defaultBoardId, onClose, onCreate, selectedDepartmentId, currentTenantMember: propTenantMember, departments: propDepartments }) => {
  const { currentUser } = useAuth();
  const { activeTenantId, currentTenantMember: contextTenantMember } = useTenant();

  // Prefer prop-passed tenantMember (from parent which already has it loaded)
  const myTenantMember = propTenantMember || contextTenantMember;
  const currentUserTier = normalizeTier(myTenantMember?.permission_tier) || 'VIEW_ONLY';
  const myDepartmentId = myTenantMember?.department_id || null;

  // Tiers that can select department
  const canSelectDept = currentUserTier === 'COMMAND' || currentUserTier === 'CHIEF' || currentUserTier === 'HOD';

  // Determine initial department: use selectedDepartmentId if valid UUID, else own dept
  const isValidUUID = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i?.test(val);
  const initialDeptId = (selectedDepartmentId && isValidUUID(selectedDepartmentId))
    ? selectedDepartmentId
    : myDepartmentId;

  const [selectedTargetDeptId, setSelectedTargetDeptId] = useState(initialDeptId);
  const [departments, setDepartments] = useState(propDepartments || []);
  const [loadingDepts, setLoadingDepts] = useState(
    canSelectDept && (!propDepartments || propDepartments?.length === 0)
  );

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    board: defaultBoardId || boards?.[0]?.id || '',
    assignees: [],
    dueDate: new Date()?.toISOString()?.split('T')?.[0],
    priority: 'medium'
  });

  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [assigneesEmpty, setAssigneesEmpty] = useState(false);

  // Is a cross-department send (selected dept differs from own dept)
  const isCrossDeptSelected = selectedTargetDeptId && selectedTargetDeptId !== myDepartmentId;

  // Fetch departments if not passed as prop
  useEffect(() => {
    if (!canSelectDept) return;
    if (propDepartments && propDepartments?.length > 0) {
      setDepartments(propDepartments);
      return;
    }
    if (!activeTenantId) return;
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
          setDepartments(deptRows || []);
        }
      } catch (err) {
        console.warn('[CreateTaskModal] fetchDepts error:', err);
      } finally {
        setLoadingDepts(false);
      }
    };
    fetchDepts();
  }, [activeTenantId, canSelectDept, propDepartments]);

  // Get department name for display
  const getDeptName = (deptId) => {
    if (!deptId) return 'Unknown Department';
    const dept = departments?.find(d => d?.id === deptId);
    return dept?.name || 'Unknown Department';
  };

  // Fetch assignees — only when NOT cross-dept (cross-dept goes to dept chief automatically)
  const fetchAssignees = useCallback(async () => {
    // If cross-dept send, no individual assignee selection needed
    if (isCrossDeptSelected) {
      setAssigneeOptions([]);
      setAssigneesEmpty(false);
      setLoadingAssignees(false);
      return;
    }

    if (!activeTenantId) return;

    let effectiveDeptId = null;
    if (selectedTargetDeptId && isValidUUID(selectedTargetDeptId)) {
      effectiveDeptId = selectedTargetDeptId;
    } else if (currentUserTier !== 'COMMAND') {
      effectiveDeptId = myDepartmentId || null;
    }

    setLoadingAssignees(true);
    setAssigneesEmpty(false);
    try {
      let tmQuery = supabase?.from('tenant_members')?.select('user_id, department_id, permission_tier')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('active', true);

      if (effectiveDeptId) {
        tmQuery = tmQuery?.eq('department_id', effectiveDeptId);
      }

      const { data: tmData, error: tmError } = await tmQuery;

      if (tmError) {
        console.error('[CREATE TASK MODAL] tenant_members query error:', tmError);
        setAssigneeOptions([]);
        setAssigneesEmpty(true);
        return;
      }

      if (!tmData || tmData?.length === 0) {
        setAssigneeOptions([]);
        setAssigneesEmpty(true);
        return;
      }

      const userIds = tmData?.map(tm => tm?.user_id)?.filter(Boolean);
      const { data: profilesData, error: profilesError } = await supabase
        ?.from('profiles')
        ?.select('id, full_name, first_name, last_name, email')
        ?.in('id', userIds);

      if (profilesError) {
        console.error('[CREATE TASK MODAL] profiles query error:', profilesError);
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
          name: displayName
        };
      });

      let filtered = members;
      if (currentUserTier === 'CREW') {
        filtered = members?.filter(m => m?.user_id === (myTenantMember?.user_id || currentUser?.id));
      } else {
        filtered = members?.filter(m => canAssignTo(m?.permission_tier, currentUserTier));
      }

      if (filtered?.length === 0) {
        setAssigneesEmpty(true);
      }

      setAssigneeOptions(filtered?.map(m => ({ value: m?.user_id, label: m?.display_name })));
    } catch (err) {
      console.error('[CREATE TASK MODAL] fetchAssignees unexpected error:', err);
      setAssigneeOptions([]);
      setAssigneesEmpty(true);
    } finally {
      setLoadingAssignees(false);
    }
  }, [activeTenantId, currentUserTier, myTenantMember, selectedTargetDeptId, currentUser?.id, myDepartmentId, isCrossDeptSelected]);

  useEffect(() => {
    fetchAssignees();
  }, [fetchAssignees]);

  // When target dept changes, reset assignees
  useEffect(() => {
    setFormData(prev => ({ ...prev, assignees: [] }));
  }, [selectedTargetDeptId]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!formData?.title?.trim()) return;
    // Determine if this is a cross-department send
    const isCrossDeptSend = canSelectDept &&
      selectedTargetDeptId && selectedTargetDeptId !== myDepartmentId;
    onCreate({
      ...formData,
      dueDate: new Date(formData?.dueDate)?.toISOString(),
      targetDepartmentId: selectedTargetDeptId,
      isCrossDeptSend,
      // If cross-dept send, mark as pending_acceptance for the target dept chief
      status: isCrossDeptSend ? 'pending_acceptance' : 'pending',
    });
  };

  const boardOptions = boards?.map(b => ({ value: b?.id, label: b?.name }));
  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' }
  ];

  const showAssignTo = currentUserTier === 'COMMAND' || currentUserTier === 'CHIEF' || currentUserTier === 'HOD';
  const crewCannotAssign = currentUserTier === 'CREW' || currentUserTier === 'VIEW_ONLY';

  // Department options for COMMAND/CHIEF/HOD dropdown
  const deptOptions = departments?.map(d => ({ value: d?.id, label: d?.name })) || [];

  return (
    <ModalShell onClose={onClose} panelClassName="jm-panel lg">
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Jobs</p>
          <h2 className="jm-title">Create a job</h2>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="jm-body" id="tj-create-task-form">
        <div className="jm-section">
          <label className="jm-label" htmlFor="ctm-title">
            Job title<span className="req">required</span>
          </label>
          <input
            id="ctm-title"
            autoFocus
            type="text"
            className="jm-titlefield"
            placeholder="What needs doing?"
            value={formData?.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="ctm-desc">
            Description<span className="opt">optional</span>
          </label>
          <textarea
            id="ctm-desc"
            className="jm-textarea"
            rows={4}
            placeholder="Any detail the crew will need"
            value={formData?.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
          />
        </div>

        {/* Department */}
        <div className="jm-section">
          <label className="jm-label" htmlFor="ctm-dept">
            Department<span className="req">required</span>
          </label>
          {canSelectDept ? (
            loadingDepts ? (
              <div className="jm-readonly muted">Loading departments…</div>
            ) : (
              <select
                id="ctm-dept"
                className="jm-select"
                value={selectedTargetDeptId || ''}
                onChange={(e) => setSelectedTargetDeptId(e?.target?.value)}
              >
                <option value="">Select department…</option>
                {deptOptions?.map(o => (
                  <option key={o?.value} value={o?.value}>{o?.label}</option>
                ))}
              </select>
            )
          ) : (
            <div className="jm-readonly">
              <span>{loadingDepts ? 'Loading…' : getDeptName(myDepartmentId)}</span>
              <span className="note">locked to your department</span>
            </div>
          )}
        </div>

        {/* Cross-department warning */}
        {canSelectDept && isCrossDeptSelected && (
          <div className="jm-section">
            <div className="jm-notice warn">
              <Icon name="AlertTriangle" size={15} />
              <span>
                This job will be sent to the <strong>{getDeptName(selectedTargetDeptId)}</strong> chief
                for acceptance before it lands on their board.
              </span>
            </div>
          </div>
        )}

        {/* Board */}
        <div className="jm-section">
          <label className="jm-label" htmlFor="ctm-board">
            Board<span className="req">required</span>
          </label>
          <select
            id="ctm-board"
            className="jm-select"
            value={formData?.board || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, board: e?.target?.value }))}
          >
            <option value="">Select board…</option>
            {boardOptions?.map(o => (
              <option key={o?.value} value={o?.value}>{o?.label}</option>
            ))}
          </select>
        </div>

        {/* Assign to — cross-dept locks to the receiving chief */}
        {showAssignTo && (
          <div className="jm-section">
            <label className="jm-label">
              Assign to<span className="opt">optional</span>
            </label>
            {isCrossDeptSelected ? (
              <div className="jm-readonly">
                <span>Department chief</span>
                <span className="note">goes to all chiefs in {getDeptName(selectedTargetDeptId)}</span>
              </div>
            ) : loadingAssignees ? (
              <div className="jm-readonly muted">Loading crew members…</div>
            ) : assigneesEmpty ? (
              <div className="jm-readonly muted">No eligible crew in this department</div>
            ) : (
              <AssigneePicker
                options={assigneeOptions}
                value={formData?.assignees}
                onChange={(next) => setFormData(prev => ({ ...prev, assignees: next }))}
                placeholder="Select crew members…"
              />
            )}
          </div>
        )}

        {crewCannotAssign && (
          <div className="jm-section">
            <div className="jm-notice info">
              <Icon name="Info" size={15} />
              <span>
                {currentUserTier === 'CREW'
                  ? "Crew can't assign jobs — this one will be created for you."
                  : 'Assignment is not available for your role.'}
              </span>
            </div>
          </div>
        )}

        <div className="jm-section jm-grid">
          <div>
            <label className="jm-label" htmlFor="ctm-due">
              Due date<span className="req">required</span>
            </label>
            <input
              id="ctm-due"
              type="date"
              className="jm-input"
              value={formData?.dueDate}
              onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e?.target?.value }))}
            />
          </div>
          <div>
            <label className="jm-label" htmlFor="ctm-priority">Priority</label>
            <select
              id="ctm-priority"
              className="jm-select"
              value={formData?.priority || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: e?.target?.value }))}
            >
              {priorityOptions?.map(o => (
                <option key={o?.value} value={o?.value}>{o?.label}</option>
              ))}
            </select>
          </div>
        </div>
      </form>

      <div className="jm-foot">
        <button type="button" className="jm-btn ghost" onClick={onClose}>Cancel</button>
        <div className="spacer" />
        <button type="submit" form="tj-create-task-form" className="jm-btn primary">
          <Icon name={isCrossDeptSelected ? 'Send' : 'Plus'} size={15} />
          {isCrossDeptSelected ? 'Send for acceptance' : 'Create job'}
        </button>
      </div>
    </ModalShell>
  );
};

export default CreateTaskModal;
