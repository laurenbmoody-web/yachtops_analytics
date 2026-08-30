import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import { hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import DutySetTemplateCard from './components/DutySetTemplateCard';
import RotationCalendar from './components/RotationCalendar';
import CreateTemplateModal from './components/CreateTemplateModal';
import EditTemplateModal from './components/EditTemplateModal';
import '../../styles/editorial.css';
import './duty-sets.css';

const DEFAULT_TEMPLATE_SORT = 'name-asc';

const TEMPLATE_SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A \u2192 Z)' },
  { value: 'name-desc', label: 'Name (Z \u2192 A)' },
  { value: 'duration-asc', label: 'Shortest first' },
  { value: 'duration-desc', label: 'Longest first' },
  { value: 'tasks-desc', label: 'Most tasks' },
];

const DutySetsRotationManagement = () => {
  const navigate = useNavigate();
  const { currentUser, tenantRole, session, bootstrapComplete } = useAuth();
  const { activeTenantId, loadingTenant, currentTenantMember } = useTenant();
  const [view, setView] = useState('templates'); // 'templates' or 'rotation'
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBoard, setFilterBoard] = useState('all');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showDeptMenu, setShowDeptMenu] = useState(false);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [lastDoneById, setLastDoneById] = useState({});
  const [sortBy, setSortBy] = useState(DEFAULT_TEMPLATE_SORT);

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
        ?.select('id, name, category, estimated_duration, task_count, tasks, recurrence, department_id, tenant_id')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('department_id', effectiveDepartmentId)
        ?.order('created_at', { ascending: true });

      if (error) throw error;

      // Normalize snake_case DB fields to camelCase for UI compatibility
      const normalized = data?.map(t => ({
        ...t,
        taskCount: t?.task_count,
        estimatedDuration: t?.estimated_duration,
        recurrence: t?.recurrence || { type: 'daily' },
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

  // ── When was each task last ticked off? ──
  // Drives the monthly "last done" line and the over-three-weeks flag. One
  // query for the whole department; the newest row per task wins.
  const fetchLastDone = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const { data, error } = await supabase
        ?.from('duty_task_progress')
        ?.select('task_id, done_at')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('done', true)
        ?.order('done_at', { ascending: false });
      if (error) throw error;
      const map = {};
      (data || [])?.forEach(r => { if (!map[r?.task_id]) map[r.task_id] = r?.done_at; });
      setLastDoneById(map);
    } catch (err) {
      console.warn('[DutySets] fetchLastDone error:', err);
    }
  }, [activeTenantId]);

  useEffect(() => { if (activeTenantId) fetchLastDone(); }, [activeTenantId, fetchLastDone]);

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
          // The modal has always collected this; it used to be dropped here.
          recurrence: templateData?.recurrence || { type: 'daily' },
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
          recurrence: inserted?.recurrence || { type: 'daily' },
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
          recurrence: template?.recurrence || { type: 'daily' },
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
          recurrence: inserted?.recurrence || { type: 'daily' },
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
          recurrence: formData?.recurrence || { type: 'daily' },
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
          recurrence: updated?.recurrence || { type: 'daily' },
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
  const filteredTemplates = (() => {
    const matched = templates?.filter(template => {
      const matchesSearch = template?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase());
      const matchesDuty = filterBoard === 'all' || template?.category === filterBoard;
      return matchesSearch && matchesDuty;
    }) || [];
    const dur = (t) => t?.estimatedDuration ?? t?.estimated_duration ?? 0;
    const tasks = (t) => t?.taskCount ?? t?.task_count ?? t?.tasks?.length ?? 0;
    return [...matched]?.sort((a, b) => {
      switch (sortBy) {
        case 'name-desc': return String(b?.name || '')?.localeCompare(String(a?.name || ''));
        case 'duration-asc': return dur(a) - dur(b);
        case 'duration-desc': return dur(b) - dur(a);
        case 'tasks-desc': return tasks(b) - tasks(a);
        default: return String(a?.name || '')?.localeCompare(String(b?.name || ''));
      }
    });
  })();

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

  // Templates shown per category, plus the meta-strip figures
  const templateCount = filteredTemplates?.length || 0;
  const categoryCount = Object.keys(groupedTemplates || {})?.length || 0;
  const activeDeptName =
    departments?.find(d => d?.id === (effectiveDepartmentId || userDepartmentId))?.name || 'All departments';

  // Show loading while auth is bootstrapping
  if (!bootstrapComplete) {
    return (
      <div className="dsr-page">
        <Header />
        <div className="dsr-wrap">
          <div className="dsr-empty">
            <LogoSpinner size={32} className="mx-auto mb-4" />
            <p className="dsr-empty-s">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  // Redirect if not Command or Chief
  if (!hasRotationAccess) {
    return (
      <div className="dsr-page">
        <Header />
        <div className="dsr-wrap">
          <div className="dsr-empty">
            <div className="dsr-empty-ico"><Icon name="Lock" size={22} /></div>
            <h2 className="dsr-empty-t">Access restricted</h2>
            <p className="dsr-empty-s">
              Only Command and Chief tier users can manage duty sets and rotation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dsr-page" onClick={() => { setShowDeptMenu(false); setShowBoardMenu(false); setShowSortMenu(false); }}>
      <Header />
      <div className="dsr-wrap">
        {/* Back to jobs — Manage rotation is reached from the Jobs header */}
        <button type="button" className="dsr-back" onClick={() => navigate('/team-jobs-management')}>
          <Icon name="ChevronLeft" size={16} />
          Back to Jobs
        </button>

        {/* Meta strip — canonical editorial inline data */}
        <p className="editorial-meta dsr-metastrip">
          <span className="dot">●</span>
          <span>Rotation</span>
          <span className="bar" />
          <span className="muted">{activeDeptName}</span>
          <span className="bar" />
          <span>{templateCount} {templateCount === 1 ? 'Template' : 'Templates'}</span>
          <span className="bar" />
          <span className="muted">{categoryCount} {categoryCount === 1 ? 'Category' : 'Categories'}</span>
        </p>

        {/* Header Row */}
        <div className="dsr-header">
          <div>
            <h1 className="dsr-headline">
              ROTATION<span className="punc">,</span> <em>on schedule</em><span className="punc">.</span>
            </h1>
            <p className="dsr-subtitle">Recurring duty templates and the crew rotation calendar.</p>
          </div>
          <div className="dsr-actions">
            {/* Department — COMMAND only; CHIEF/HOD are locked to their own */}
            {isCommandUser && departments?.length > 0 && (
              <div className="dsr-menuwrap" onClick={e => e?.stopPropagation()}>
                <button className="dsr-tool" onClick={() => setShowDeptMenu(v => !v)}>
                  <Icon name="Building2" size={15} />
                  <span>
                    {departments?.find(d => d?.id === selectedDepartmentId)?.name || 'Select department'}
                  </span>
                  <Icon name="ChevronDown" size={13} className={showDeptMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {showDeptMenu && (
                  <div className="dsr-menu left">
                    {departments?.map(d => (
                      <button
                        key={d?.id}
                        className={`dsr-menuitem${selectedDepartmentId === d?.id ? ' on' : ''}`}
                        onClick={() => { setSelectedDepartmentId(d?.id); setShowDeptMenu(false); }}
                      >
                        {d?.name}
                        {selectedDepartmentId === d?.id && <Icon name="Check" size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isChiefOrHod && userDepartmentId && departments?.length > 0 && (
              <span className="dsr-deptchip">
                <Icon name="Building2" size={14} />
                {departments?.find(d => d?.id === userDepartmentId)?.name || 'My department'}
              </span>
            )}
            <button className="dsr-btn ghost">
              <Icon name="Download" size={15} />
              <span className="hidden sm:inline">Export schedule</span>
            </button>
            <button className="dsr-btn primary" onClick={() => setShowCreateTemplate(true)}>
              <Icon name="Plus" size={15} />
              New template
            </button>
          </div>
        </div>

        {/* View toggle */}
        <div className="dsr-tabs">
          <button
            onClick={() => setView('templates')}
            className={`dsr-tab${view === 'templates' ? ' on' : ''}`}
          >
            <Icon name="FileText" size={15} />
            Templates
          </button>
          <button
            onClick={() => setView('rotation')}
            className={`dsr-tab${view === 'rotation' ? ' on' : ''}`}
          >
            <Icon name="CalendarDays" size={15} />
            Rotation calendar
          </button>
        </div>

        {/* Templates View */}
        {view === 'templates' && (
          <div>
            {/* Toolbar — search + category filter */}
            <div className="dsr-toolbar">
              <div className="dsr-search">
                <Icon name="Search" size={15} />
                <input
                  type="text"
                  placeholder="Search templates — name, category…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                />
                {searchQuery && (
                  <button className="dsr-search-clear" onClick={() => setSearchQuery('')} title="Clear search">
                    <Icon name="X" size={14} />
                  </button>
                )}
              </div>
              <div className="dsr-menuwrap" onClick={e => e?.stopPropagation()}>
                <button
                  className={`dsr-tool${filterBoard !== 'all' ? ' on' : ''}`}
                  onClick={() => setShowBoardMenu(v => !v)}
                >
                  <Icon name="SlidersHorizontal" size={15} />
                  <span>{boardOptions?.find(o => o?.value === filterBoard)?.label || 'All duties'}</span>
                  <Icon name="ChevronDown" size={13} className={showBoardMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {showBoardMenu && (
                  <div className="dsr-menu">
                    {boardOptions?.map(o => (
                      <button
                        key={o?.value}
                        className={`dsr-menuitem${filterBoard === o?.value ? ' on' : ''}`}
                        onClick={() => { setFilterBoard(o?.value); setShowBoardMenu(false); }}
                      >
                        {o?.label}
                        {filterBoard === o?.value && <Icon name="Check" size={14} />}
                      </button>
                    ))}
                    <div className="dsr-menu-foot">
                      <button
                        className="dsr-menu-clear"
                        disabled={filterBoard === 'all'}
                        onClick={() => { setFilterBoard('all'); setShowBoardMenu(false); }}
                      >
                        Clear all
                      </button>
                      <button className="dsr-menu-done" onClick={() => setShowBoardMenu(false)}>Done</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sort */}
              <div className="dsr-menuwrap" onClick={e => e?.stopPropagation()}>
                <button
                  className={`dsr-tool${sortBy !== DEFAULT_TEMPLATE_SORT ? ' on' : ''}`}
                  onClick={() => { setShowSortMenu(v => !v); setShowBoardMenu(false); }}
                >
                  <Icon name="ArrowUpDown" size={15} />
                  <span className="hidden sm:inline">Sort</span>
                  <span className="dsr-tool-cur">
                    · {TEMPLATE_SORT_OPTIONS?.find(o => o?.value === sortBy)?.label}
                  </span>
                  <Icon name="ChevronDown" size={13} className={showSortMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {showSortMenu && (
                  <div className="dsr-menu">
                    {TEMPLATE_SORT_OPTIONS?.map(o => (
                      <button
                        key={o?.value}
                        className={`dsr-menuitem${sortBy === o?.value ? ' on' : ''}`}
                        onClick={() => { setSortBy(o?.value); setShowSortMenu(false); }}
                      >
                        {o?.label}
                        {sortBy === o?.value && <Icon name="Check" size={14} />}
                      </button>
                    ))}
                    <div className="dsr-menu-foot">
                      <button
                        className="dsr-menu-clear"
                        disabled={sortBy === DEFAULT_TEMPLATE_SORT}
                        onClick={() => setSortBy(DEFAULT_TEMPLATE_SORT)}
                      >
                        Reset
                      </button>
                      <button className="dsr-menu-done" onClick={() => setShowSortMenu(false)}>Done</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Template library */}
            {loadingTemplates ? (
              <div className="dsr-empty">
                <LogoSpinner size={32} className="mx-auto mb-4" />
                <p className="dsr-empty-s">Loading templates…</p>
              </div>
            ) : (
              <div>
                {Object.entries(groupedTemplates)?.map(([category, categoryTemplates]) => (
                  <div key={category} className="dsr-cat">
                    <div className="dsr-cat-head">
                      {renamingCategory?.old === category ? (
                        <>
                          <input
                            autoFocus
                            type="text"
                            className="dsr-cat-input"
                            value={renamingCategory?.value}
                            onChange={(e) => setRenamingCategory(prev => ({ ...prev, value: e?.target?.value }))}
                            onKeyDown={handleRenameCategoryKeyDown}
                            onBlur={handleSaveRenameCategory}
                          />
                          <button className="dsr-cat-ok" onClick={handleSaveRenameCategory} title="Save">
                            <Icon name="Check" size={15} />
                          </button>
                          <button className="dsr-cat-cancel" onClick={() => setRenamingCategory(null)} title="Cancel">
                            <Icon name="X" size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="dsr-cat-name"
                            onClick={() => handleStartRenameCategory(category)}
                            title="Rename category"
                          >
                            {category}
                            <Icon name="Pencil" size={13} />
                          </button>
                          <span className="dsr-cat-count">
                            {categoryTemplates?.length} {categoryTemplates?.length === 1 ? 'template' : 'templates'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="dsr-grid">
                      {categoryTemplates?.map(template => (
                        <DutySetTemplateCard
                          key={template?.id}
                          template={template}
                          onDuplicate={handleDuplicateTemplate}
                          onDelete={handleDeleteTemplate}
                          onEdit={setEditingTemplate}
                          lastDoneById={lastDoneById}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {filteredTemplates?.length === 0 && (
                  <div className="dsr-empty">
                    <div className="dsr-empty-ico"><Icon name="FileText" size={22} /></div>
                    <h3 className="dsr-empty-t">
                      {searchQuery || filterBoard !== 'all'
                        ? 'No templates found'
                        : 'No templates yet for this department'}
                    </h3>
                    <p className="dsr-empty-s">
                      {searchQuery || filterBoard !== 'all'
                        ? 'Try adjusting your search or filter.'
                        : 'Create your first one with the “New template” button above.'}
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
      </div>

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
