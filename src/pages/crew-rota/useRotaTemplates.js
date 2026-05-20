// useRotaTemplates — list, star, and CRUD rota_shift_templates for the
// signed-in tenant member. Combines the tenant's templates with the
// current user's stars (each user owns their own stars per the user-
// scoped RLS on rota_template_stars).
//
// Returns:
//   templates  — sorted: starred first, then alphabetical by name.
//                each row: { id, name, kind, scope, departmentId,
//                  departmentName, body, isDefault, createdBy,
//                  isStarred, isEditable }
//   loading, error, refetch
//   toggleStar(templateId)       — optimistic; reverts on failure
//   createTemplate({ name, kind, scope, departmentId, body, vesselId })
//   updateTemplate(id, patch)    — patch keys may be camelCase or
//                                  snake_case; camelCase is translated
//   deleteTemplate(id)
//
// `isEditable` is UI-only gating; the live RLS on rota_shift_templates
// is the real backstop (COMMAND/CHIEF full write, HOD CRUD on department-
// scope templates for their own department; nothing on is_default).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

export function useRotaTemplates() {
  const { user, activeTenantId, tenantRole } = useAuth();
  const tenantId = activeTenantId;
  const userId = user?.id;
  const tier = String(user?.permission_tier || tenantRole || '').toUpperCase();
  const myDeptId = user?.department_id || null;

  const [rows, setRows] = useState([]);
  const [stars, setStars] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!tenantId || !userId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        supabase.from('rota_shift_templates')
          .select('id, name, kind, scope, department_id, body, is_default, created_by, departments ( name )')
          .eq('tenant_id', tenantId),
        supabase.from('rota_template_stars')
          .select('template_id')
          .eq('user_id', userId),
      ]);
      if (tRes.error) throw tRes.error;
      if (sRes.error) throw sRes.error;
      setRows(tRes.data || []);
      setStars(new Set((sRes.data || []).map(r => r.template_id)));
      setError(null);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tenantId, userId]);

  useEffect(() => { refetch(); }, [refetch]);

  const templates = useMemo(() => rows
    .map((r) => {
      const isDefault = !!r.is_default;
      const ownDeptMatch = myDeptId && r.department_id === myDeptId;
      const isEditable = !isDefault && (
        tier === 'COMMAND' || tier === 'CHIEF'
        || (tier === 'HOD' && r.scope === 'department' && ownDeptMatch)
      );
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        scope: r.scope,
        departmentId: r.department_id,
        departmentName: r.departments?.name || null,
        body: r.body,
        isDefault,
        createdBy: r.created_by,
        isStarred: stars.has(r.id),
        isEditable,
      };
    })
    .sort((a, b) => {
      if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    }),
  [rows, stars, tier, myDeptId]);

  // Optimistic star toggle — flip the local Set immediately, fire DB in
  // the background, revert on failure.
  const toggleStar = useCallback(async (templateId) => {
    if (!userId || !tenantId || !templateId) return { ok: false, error: 'no-context' };
    const had = stars.has(templateId);
    setStars((prev) => {
      const next = new Set(prev);
      if (had) next.delete(templateId); else next.add(templateId);
      return next;
    });
    try {
      if (had) {
        const { error: delErr } = await supabase.from('rota_template_stars')
          .delete().eq('user_id', userId).eq('template_id', templateId);
        if (delErr) throw delErr;
      } else {
        const { error: insErr } = await supabase.from('rota_template_stars')
          .insert({ user_id: userId, template_id: templateId, tenant_id: tenantId });
        if (insErr) throw insErr;
      }
      return { ok: true };
    } catch (e) {
      setStars((prev) => {
        const next = new Set(prev);
        if (had) next.add(templateId); else next.delete(templateId);
        return next;
      });
      return { ok: false, error: e?.message ?? String(e) };
    }
  }, [stars, userId, tenantId]);

  const createTemplate = useCallback(async ({
    name, kind, scope, departmentId, body, vesselId,
  }) => {
    if (!tenantId || !vesselId || !name) return { ok: false, error: 'missing-context' };
    const row = {
      tenant_id: tenantId,
      vessel_id: vesselId,
      name,
      kind,
      scope,
      department_id: scope === 'department' ? (departmentId || null) : null,
      body,
      is_default: false,
    };
    if (userId) row.created_by = userId;
    const { data, error: insErr } = await supabase.from('rota_shift_templates')
      .insert(row).select('id').maybeSingle();
    if (insErr) return { ok: false, error: insErr.message };
    await refetch({ silent: true });
    return { ok: true, id: data?.id };
  }, [tenantId, userId, refetch]);

  const updateTemplate = useCallback(async (id, patch) => {
    if (!id) return { ok: false, error: 'no-id' };
    const dbPatch = { ...patch, updated_at: new Date().toISOString() };
    if ('departmentId' in dbPatch) {
      dbPatch.department_id = dbPatch.departmentId;
      delete dbPatch.departmentId;
    }
    const { error: updErr } = await supabase.from('rota_shift_templates')
      .update(dbPatch).eq('id', id);
    if (updErr) return { ok: false, error: updErr.message };
    await refetch({ silent: true });
    return { ok: true };
  }, [refetch]);

  const deleteTemplate = useCallback(async (id) => {
    if (!id) return { ok: false, error: 'no-id' };
    const { error: delErr } = await supabase.from('rota_shift_templates')
      .delete().eq('id', id);
    if (delErr) return { ok: false, error: delErr.message };
    await refetch({ silent: true });
    return { ok: true };
  }, [refetch]);

  return {
    templates, loading, error, refetch,
    toggleStar, createTemplate, updateTemplate, deleteTemplate,
  };
}
