-- ─────────────────────────────────────────────────────────────────────────────
-- 20260518000007_seed_default_templates.sql
--
-- WHAT: Seeds the 21 default rota_shift_templates (2 vessel-scope + 19
--       department-scope) for every tenant that currently has ZERO templates.
--       department_id is resolved BY NAME against the global departments table
--       (no hardcoded UUIDs). Department-scope rows are seeded only for
--       departments the tenant actually uses (vessels.departments_in_use).
--
-- RECOVERY MIGRATION: NO-OP ON PROD. All 5 live tenants already have exactly
--       21 templates each (B3-Q3), so the per-tenant NOT EXISTS guard inserts
--       zero rows. This file exists so a fresh environment reproduces the live
--       seed.
--
-- IDEMPOTENCY: single INSERT…SELECT guarded by
--       `NOT EXISTS (templates for this tenant)` — re-running never duplicates
--       (a tenant with ≥1 template is skipped entirely).
--
-- AUDIT NOTES / QUIRKS — READ THIS:
--   * Catalog transcribed VERBATIM from B3-Q1 (test tenant). The set is
--     identical across all 5 live tenants (B3-Q3). `name` is NOT unique
--     ("Full day" exists in both Galley and Interior) — disambiguated by the
--     dept_name column in the VALUES list.
--   * is_default=true and created_by=NULL for all 21 (matches live).
--   * vessel_id is set to the tenant id (tenant↔vessel id reuse, same pattern
--     as the standing-rota trigger).
--   * DEPARTMENT-AWARE (locked decision): a department-scope template is
--     seeded only when its department is present in
--     vessels.departments_in_use for that tenant. DEPENDENCY: this relies on
--     vessels.departments_in_use being uuid[], which is ITSELF undocumented
--     out-of-band drift (no committed migration — see Phase-0 report). Flagged.
--   * If a global department NAME in the catalog does not exist in
--     public.departments, that template is silently skipped (LEFT JOIN →
--     d.id IS NULL → excluded by the guard) rather than inserting a NULL
--     department_id (which template_scope_matches would reject). Flagged as a
--     known, safe degradation.
--   * NO database trigger seeds templates for NEW tenants — future tenants
--     will not get templates without app-layer code or a separate trigger
--     migration. Standing product gap (out of scope here).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.rota_shift_templates
  (tenant_id, vessel_id, name, kind, scope, department_id, body, is_default)
SELECT
  t.id,
  t.id,
  c.name,
  c.kind,
  c.scope,
  d.id,
  c.body::jsonb,
  true
FROM public.tenants t
CROSS JOIN (VALUES
  -- vessel-scope (always seeded)
  ('Off',                  'simple', 'vessel',      NULL,          '{"shift_type":"off"}'),
  ('Training',             'simple', 'vessel',      NULL,          '{"shift_type":"training"}'),
  -- Bridge
  ('Bridge watch (day)',   'simple', 'department',  'Bridge',      '{"end_time":"18:00","sub_type":"navigation","shift_type":"watch","start_time":"06:00"}'),
  ('Bridge watch (night)', 'simple', 'department',  'Bridge',      '{"end_time":"06:00","sub_type":"navigation","shift_type":"watch","start_time":"18:00"}'),
  -- Deck
  ('Anchor watch',         'simple', 'department',  'Deck',        '{"end_time":"04:00","sub_type":"anchor","shift_type":"watch","start_time":"00:00"}'),
  ('Day deck',             'simple', 'department',  'Deck',        '{"end_time":"17:00","shift_type":"duty","start_time":"07:00"}'),
  ('Day watch',            'simple', 'department',  'Deck',        '{"end_time":"18:00","sub_type":"navigation","shift_type":"watch","start_time":"06:00"}'),
  ('Night watch',          'simple', 'department',  'Deck',        '{"end_time":"06:00","sub_type":"navigation","shift_type":"watch","start_time":"18:00"}'),
  ('Tender standby',       'simple', 'department',  'Deck',        '{"end_time":"18:00","sub_type":"tender","shift_type":"standby","start_time":"08:00"}'),
  -- Engineering
  ('Day engineer',         'simple', 'department',  'Engineering', '{"end_time":"18:00","shift_type":"duty","start_time":"08:00"}'),
  ('Engine watch (night)', 'simple', 'department',  'Engineering', '{"end_time":"06:00","sub_type":"engine","shift_type":"watch","start_time":"18:00"}'),
  ('On-call standby',      'simple', 'department',  'Engineering', '{"sub_type":"maintenance","shift_type":"standby"}'),
  -- Galley
  ('Breakfast',            'simple', 'department',  'Galley',      '{"end_time":"11:00","shift_type":"duty","start_time":"05:00"}'),
  ('Dinner service',       'simple', 'department',  'Galley',      '{"end_time":"22:00","shift_type":"duty","start_time":"16:00"}'),
  ('Full day',             'simple', 'department',  'Galley',      '{"end_time":"22:00","shift_type":"duty","start_time":"06:00"}'),
  ('Lunch service',        'simple', 'department',  'Galley',      '{"end_time":"15:00","shift_type":"duty","start_time":"10:00"}'),
  -- Interior
  ('Early',                'simple', 'department',  'Interior',    '{"end_time":"14:00","shift_type":"duty","start_time":"06:00"}'),
  ('Full day',             'simple', 'department',  'Interior',    '{"end_time":"22:00","shift_type":"duty","start_time":"06:00"}'),
  ('Late',                 'simple', 'department',  'Interior',    '{"end_time":"22:00","shift_type":"duty","start_time":"14:00"}'),
  ('Mid',                  'simple', 'department',  'Interior',    '{"end_time":"18:00","shift_type":"duty","start_time":"10:00"}'),
  ('Night',                'simple', 'department',  'Interior',    '{"end_time":"06:00","shift_type":"duty","start_time":"22:00"}')
) AS c(name, kind, scope, dept_name, body)
LEFT JOIN public.departments d ON d.name = c.dept_name
WHERE NOT EXISTS (
        SELECT 1 FROM public.rota_shift_templates rst WHERE rst.tenant_id = t.id
      )
  AND (
        c.scope = 'vessel'
        OR (
             d.id IS NOT NULL
             AND d.id = ANY (
               COALESCE(
                 (SELECT ve.departments_in_use FROM public.vessels ve
                  WHERE ve.tenant_id = t.id LIMIT 1),
                 '{}'::uuid[]
               )
             )
           )
      );
