import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import { hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import DutySetTemplateCard from './components/DutySetTemplateCard';
import RotationCalendar from './components/RotationCalendar';
import CreateTemplateModal from './components/CreateTemplateModal';
import EditTemplateModal from './components/EditTemplateModal';

const DutySetsRotationManagement = () => {
  const { currentUser, tenantRole, session, bootstrapComplete } = useAuth();
  const { activeTenantId, loadingTenant, currentTenantMember } = useTenant();
  const [view, setView] = useState('templates'); // 'templates' or 'rotation'
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBoard, setFilterBoard] = useState('all');
  const [editingTemplate, setEditingTemplate] = useState(null);

  // Department state
  const [departments, setDepartments] = useState([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(null);

  // Real duty set templates from Supabase
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // ── Derive user department info ──
  const normalizedTenantRole = tenantRole?.toUpperCase()?.trim();
  const isCommandUser = normalizedTenantRole === 'COMMAND' || hasCommandAccess(currentUser);
  const isChiefOrHod = !isCommandUser && (
    normalizedTenantRole === 'CHIEF' ||
    normalizedTenantRole === 'HOD' ||
    hasChiefAccess(currentUser)
  );
  const userDepartmentId = currentTenantMember?.department_id || null;

  // ── Effective department_id to use ──
  const effectiveDepartmentId = isChiefOrHod
    ? userDepartmentId
    : selectedDepartmentId;

  // ── Fetch departments ──
  const fetchDepartments = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const { data: rpcDepts, error: rpcError } = await supabase
        ?.rpc('get_tenant_departments', { p_tenant_id: activeTenantId });
      if (!rpcError && rpcDepts && rpcDepts?.length > 0) {
        setDepartments(rpcDepts);
        return;
      }
      // Fallback: direct query
      const { data: directDepts } = await supabase
        ?.from('departments')
        ?.select('id, name')
        ?.order('name');
      if (directDepts) setDepartments(directDepts);
    } catch (err) {
      console.warn('[DutySets] fetchDepartments error:', err);
    }
  }, [activeTenantId]);

  useEffect(() => {
    if (activeTenantId && !loadingTenant) {
      fetchDepartments();
    }
  }, [activeTenantId, loadingTenant, fetchDepartments]);

  // ── Set default selectedDepartmentId once departments load ──
  useEffect(() => {
    if (isChiefOrHod && userDepartmentId) {
      setSelectedDepartmentId(userDepartmentId);
    } else if (isCommandUser && !selectedDepartmentId && departments?.length > 0) {
      setSelectedDepartmentId(departments?.[0]?.id);
    }
  }, [isChiefOrHod, isCommandUser, userDepartmentId, departments, selectedDepartmentId]);

  // ── Fetch duty_set_templates from Supabase ──
  const fetchTemplates = useCallback(async () => {
    if (!activeTenantId || !effectiveDepartmentId) return;
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase
        ?.from('duty_set_templates')
        ?.select('id, name, category, estimated_duration, task_count, tasks, department_id, tenant_id')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('department_id', effectiveDepartmentId)
        ?.order('created_at', { ascending: true });

      if (error) throw error;

      // Normalize snake_case DB fields to camelCase for UI compatibility
      const normalized = data?.map(t => ({
        ...t,
        taskCount: t?.task_count,
        estimatedDuration: t?.estimated_duration,
      })) || [];

      setTemplates(normalized);
    } catch (err) {
      console.warn('[DutySets] fetchTemplates error:', err);
    } finally {
      setLoadingTemplates(false);
    }
  }, [activeTenantId, effectiveDepartmentId]);

  useEffect(() => {
    if (activeTenantId && effectiveDepartmentId) {
      fetchTemplates();
    } else {
      setTemplates([]);
    }
  }, [activeTenantId, effectiveDepartmentId, fetchTemplates]);

  // ── Create template → INSERT into Supabase ──
  const handleCreateTemplate = async (templateData) => {
    if (!activeTenantId || !effectiveDepartmentId) return;
    try {
      const { data: inserted, error } = await supabase
        ?.from('duty_set_templates')
        ?.insert({
          tenant_id: activeTenantId,
          department_id: effectiveDepartmentId,
          name: templateData?.name,
          category: templateData?.category || 'Daily Service',
          estimated_duration: templateData?.estimatedDuration || 30,
          task_count: templateData?.tasks?.length || 0,
          tasks: templateData?.tasks || [],
          created_by: currentUser?.id || null,
        })
        ?.select()
        ?.single();

      if (error) throw error;

      if (inserted) {
        const normalized = {
          ...inserted,
          taskCount: inserted?.task_count,
          estimatedDuration: inserted?.estimated_duration,
        };
        setTemplates(prev => [...prev, normalized]);
      }
    } catch (err) {
      console.warn('[DutySets] createTemplate error:', err);
    }
    setShowCreateTemplate(false);
  };

  // ── Duplicate template → INSERT copy into Supabase ──
  const handleDuplicateTemplate = async (templateId) => {
    const template = templates?.find(t => t?.id === templateId);
    if (!template || !activeTenantId || !effectiveDepartmentId) return;
    try {
      const { data: inserted, error } = await supabase
        ?.from('duty_set_templates')
        ?.insert({
          tenant_id: activeTenantId,
          department_id: effectiveDepartmentId,
          name: `${template?.name} (Copy)`,
          category: template?.category,
          estimated_duration: template?.estimated_duration,
          task_count: template?.task_count,
          tasks: template?.tasks,
          created_by: currentUser?.id || null,
        })
        ?.select()
        ?.single();

      if (error) throw error;

      if (inserted) {
        const normalized = {
          ...inserted,
          taskCount: inserted?.task_count,
          estimatedDuration: inserted?.estimated_duration,
        };
        setTemplates(prev => [...prev, normalized]);
      }
    } catch (err) {
      console.warn('[DutySets] duplicateTemplate error:', err);
    }
  };

  // ── Delete template → DELETE from Supabase ──
  const handleDeleteTemplate = async (templateId) => {
    try {
      const { error } = await supabase
        ?.from('duty_set_templates')
        ?.delete()
        ?.eq('id', templateId);

      if (error) throw error;

      setTemplates(prev => prev?.filter(t => t?.id !== templateId));
    } catch (err) {
      console.warn('[DutySets] deleteTemplate error:', err);
    }
  };

  // ── Edit template → UPDATE in Supabase ──
  const handleEditTemplate = async (templateId, formData) => {
    try {
      const { data: updated, error } = await supabase
        ?.from('duty_set_templates')
        ?.update({
          name: formData?.name,
          category: formData?.category,
          estimated_duration: formData?.estimatedDuration,
          task_count: formData?.tasks?.length || 0,
          tasks: formData?.tasks,
        })
        ?.eq('id', templateId)
        ?.select()
        ?.single();

      if (error) throw error;

      if (updated) {
        const normalized = {
          ...updated,
          taskCount: updated?.task_count,
          estimatedDuration: updated?.estimated_duration,
        };
        setTemplates(prev => prev?.map(t => t?.id === templateId ? normalized : t));
      }
    } catch (err) {
      console.warn('[DutySets] editTemplate error:', err);
    }
    setEditingTemplate(null);
  };

  // ── Rename category inline ──
  const [renamingCategory, setRenamingCategory] = useState(null); // { old: string, value: string }

  const handleStartRenameCategory = (category) => {
    setRenamingCategory({ old: category, value: category });
  };

  const handleSaveRenameCategory = async () => {
    if (!renamingCategory) return;
    const { old: oldName, value: newName } = renamingCategory;
    const trimmed = newName?.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingCategory(null);
      return;
    }
    try {
      // Update all templates in this category
      const { error } = await supabase
        ?.from('duty_set_templates')
        ?.update({ category: trimmed })
        ?.eq('tenant_id', activeTenantId)
        ?.eq('department_id', effectiveDepartmentId)
        ?.eq('category', oldName);
      if (error) throw error;
      setTemplates(prev => prev?.map(t =>
        t?.category === oldName ? { ...t, category: trimmed } : t
      ));
    } catch (err) {
      console.warn('[DutySets] renameCategory error:', err);
    }
    setRenamingCategory(null);
  };

  const handleRenameCategoryKeyDown = (e) => {
    if (e?.key === 'Enter') { e?.preventDefault(); handleSaveRenameCategory(); }
    if (e?.key === 'Escape') setRenamingCategory(null);
  };

  // Filter templates
  const filteredTemplates = templates?.filter(template => {
    const matchesSearch = template?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase());
    const matchesDuty = filterBoard === 'all' || template?.category === filterBoard;
    return matchesSearch && matchesDuty;
  });

  // Group by category
  const groupedTemplates = filteredTemplates?.reduce((acc, template) => {
    const category = template?.category || 'Other';
    if (!acc?.[category]) acc[category] = [];
    acc?.[category]?.push(template);
    return acc;
  }, {});

  const boardOptions = [
    { value: 'all', label: 'All Duties' },
    ...Array.from(new Set(templates?.map(t => t?.category)?.filter(Boolean)))?.map(cat => ({ value: cat, label: cat }))
  ];

  // Check if user has Command or Chief access
  const hasRotationAccess = (
    hasCommandAccess(currentUser) ||
    hasChiefAccess(currentUser) ||
    normalizedTenantRole === 'COMMAND' ||
    normalizedTenantRole === 'CHIEF'
  );

  // Show loading while auth is bootstrapping
  if (!bootstrapComplete) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1800px] mx-auto">
          <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  // Redirect if not Command or Chief
  if (!hasRotationAccess) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1800px] mx-auto">
          <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
            <Icon name="Lock" size={48} className="mx-auto mb-4 text-muted-foreground opacity-30" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-sm text-muted-foreground">Only Command and Chief tier users can access duty set and rotation management.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-foreground mb-2">Duty Sets & Rotation</h1>
            <p className="text-sm text-muted-foreground">Manage recurring task templates and crew rotation schedules</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Department selector: COMMAND only — CHIEF/HOD are locked to their own dept */}
            {isCommandUser && departments?.length > 0 && (
              <Select
                options={departments?.map(d => ({ value: d?.id, label: d?.name }))}
                value={selectedDepartmentId || ''}
                onChange={(val) => setSelectedDepartmentId(val)}
                className="w-48"
                placeholder="Select department"
              />
            )}
            {isChiefOrHod && userDepartmentId && departments?.length > 0 && (
              <span className="text-sm text-muted-foreground px-3 py-2 bg-muted rounded-lg">
                {departments?.find(d => d?.id === userDepartmentId)?.name || 'My Department'}
              </span>
            )}
            <Button variant="outline" iconName="Download">
              Export Schedule
            </Button>
            <Button variant="default" iconName="Plus" onClick={() => setShowCreateTemplate(true)}>
              New Template
            </Button>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2 bg-muted rounded-lg p-1 mb-6 w-fit">
          <button
            onClick={() => setView('templates')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-smooth ${
              view === 'templates' ?'bg-card text-foreground shadow-sm' :'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name="FileText" size={16} className="inline mr-2" />
            Templates
          </button>
          <button
            onClick={() => setView('rotation')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-smooth ${
              view === 'rotation' ?'bg-card text-foreground shadow-sm' :'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name="Calendar" size={16} className="inline mr-2" />
            Rotation Calendar
          </button>
        </div>

        {/* Templates View */}
        {view === 'templates' && (
          <div>
            {/* Filters */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 max-w-md">
                <Input
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                />
              </div>
              <Select
                options={boardOptions}
                value={filterBoard}
                onChange={setFilterBoard}
                className="w-48"
              />
            </div>

            {/* Template Library */}
            {loadingTemplates ? (
              <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">Loading templates...</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedTemplates)?.map(([category, categoryTemplates]) => (
                  <div key={category}>
                    {renamingCategory?.old === category ? (
                      <div className="flex items-center gap-2 mb-4">
                        <input
                          autoFocus
                          type="text"
                          value={renamingCategory?.value}
                          onChange={(e) => setRenamingCategory(prev => ({ ...prev, value: e?.target?.value }))}
                          onKeyDown={handleRenameCategoryKeyDown}
                          onBlur={handleSaveRenameCategory}
                          className="text-lg font-semibold text-foreground bg-transparent border-b-2 border-primary focus:outline-none px-1 py-0.5 min-w-[120px]"
                        />
                        <button
                          onClick={handleSaveRenameCategory}
                          className="p-1 hover:bg-muted rounded transition-smooth"
                          title="Save"
                        >
                          <Icon name="Check" size={16} className="text-primary" />
                        </button>
                        <button
                          onClick={() => setRenamingCategory(null)}
                          className="p-1 hover:bg-muted rounded transition-smooth"
                          title="Cancel"
                        >
                          <Icon name="X" size={16} className="text-muted-foreground" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartRenameCategory(category)}
                        className="group flex items-center gap-2 mb-4 text-left"
                        title="Click to rename"
                      >
                        <h2 className="text-lg font-semibold text-foreground group-hover:text-primary transition-smooth">{category}</h2>
                        <Icon name="Pencil" size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-smooth" />
                      </button>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {categoryTemplates?.map(template => (
                        <DutySetTemplateCard
                          key={template?.id}
                          template={template}
                          onDuplicate={handleDuplicateTemplate}
                          onDelete={handleDeleteTemplate}
                          onEdit={setEditingTemplate}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {filteredTemplates?.length === 0 && (
                  <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
                    <Icon name="FileText" size={48} className="mx-auto mb-4 text-muted-foreground opacity-30" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {searchQuery || filterBoard !== 'all' ?'No templates found' :'No templates yet for this department'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {searchQuery || filterBoard !== 'all' ?'Try adjusting your search or filters' :'Create your first template using the \u201c+ New Template\u201d button above.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Rotation Calendar View */}
        {view === 'rotation' && (
          <RotationCalendar
            templates={templates}
            departmentId={effectiveDepartmentId}
            tenantId={activeTenantId}
            currentUserId={currentUser?.id || null}
          />
        )}
      </main>
      {/* Create Template Modal */}
      {showCreateTemplate && (
        <CreateTemplateModal
          existingTemplates={templates}
          onClose={() => setShowCreateTemplate(false)}
          onCreate={handleCreateTemplate}
        />
      )}

      {editingTemplate && (
        <EditTemplateModal
          template={editingTemplate}
          existingTemplates={templates}
          onClose={() => setEditingTemplate(null)}
          onSave={handleEditTemplate}
        />
      )}
    </div>
  );
};

export default DutySetsRotationManagement;