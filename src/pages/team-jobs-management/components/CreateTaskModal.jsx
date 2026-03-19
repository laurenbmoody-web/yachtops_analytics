import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
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
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e?.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">Create New Job</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <Input
            label="Task Title"
            required
            value={formData?.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
            placeholder="Enter task title"
          />

          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Description</label>
            <textarea
              value={formData?.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
              placeholder="Enter task description"
              rows={4}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Department field */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Department <span className="text-red-500">*</span>
            </label>
            {canSelectDept ? (
              loadingDepts ? (
                <div className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-muted-foreground">
                  Loading departments...
                </div>
              ) : (
                <>
                  <Select
                    options={deptOptions}
                    value={selectedTargetDeptId}
                    onChange={(val) => setSelectedTargetDeptId(val)}
                    placeholder="Select department..."
                  />
                </>
              )
            ) : (
              <div className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground flex items-center justify-between">
                <span>{loadingDepts ? 'Loading...' : getDeptName(myDepartmentId)}</span>
                <span className="text-xs text-muted-foreground">(locked to your department)</span>
              </div>
            )}
          </div>

          {/* Cross-department warning box */}
          {canSelectDept && isCrossDeptSelected && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
              <Icon name="AlertTriangle" size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Confirm job to be sent to <strong>'{getDeptName(selectedTargetDeptId)}'</strong> chief for acceptance
              </p>
            </div>
          )}

          <Select
            label="Board"
            required
            options={boardOptions}
            value={formData?.board}
            onChange={(value) => setFormData(prev => ({ ...prev, board: value }))}
          />

          {/* Assign to — cross-dept shows locked "Department Chief", same-dept shows crew picker */}
          {showAssignTo && (
            <div>
              {isCrossDeptSelected ? (
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">Assign to</label>
                  <div className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground flex items-center justify-between">
                    <span className="font-medium">Department Chief</span>
                    <span className="text-xs text-muted-foreground">(goes to all chiefs in {getDeptName(selectedTargetDeptId)})</span>
                  </div>
                </div>
              ) : loadingAssignees ? (
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">Assign to</label>
                  <div className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-muted-foreground">
                    Loading crew members...
                  </div>
                </div>
              ) : assigneesEmpty ? (
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">Assign to</label>
                  <div className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-muted-foreground italic">
                    No eligible crew in this department
                  </div>
                </div>
              ) : (
                <Select
                  label="Assign to"
                  options={assigneeOptions}
                  value={formData?.assignees}
                  onChange={(value) => setFormData(prev => ({ ...prev, assignees: value }))}
                  multiple
                  searchable
                  placeholder="Select crew members"
                />
              )}
            </div>
          )}

          {crewCannotAssign && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {currentUserTier === 'CREW' ? "Crew can't assign jobs — this task will be created for yourself." : "Assignment is not available for your role."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Due Date"
              type="date"
              required
              value={formData?.dueDate}
              onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e?.target?.value }))}
            />

            <Select
              label="Priority"
              options={priorityOptions}
              value={formData?.priority}
              onChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}
            />
          </div>

          <div className="flex items-center gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} fullWidth>
              Cancel
            </Button>
            <Button type="submit" variant="default" iconName={isCrossDeptSelected ? 'Send' : 'Plus'} fullWidth>
              {isCrossDeptSelected ? 'Send for Acceptance' : 'Create Job'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTaskModal;