-- Demo seed — rest-panel forward projection + coverage-safe suggestions
-- ---------------------------------------------------------------------------
-- Purpose: give the crew-rota rest panel a crew member whose rolling-7 rest
-- dips below the 77h MLC floor across the week AND the next 2 days, with a
-- coverage-safe daytime fix available — so the forward bars dip and the
-- "WORTH CONSIDERING" suggestions fire with a working "Apply to grid".
--
-- Tenant : de051fc7-ec3b-4c22-96e8-b9834acda6aa  (demo)
-- Rota   : 1320e29e-da65-4185-aff5-297580eed0cc  (June 2026)
-- Source : Sophie van Dijk  (Interior CREW, b0000001-0000-4000-8000-000000000004)
-- Cover  : Claire Dubois    (Interior, light standby 09:00–17:00 → free evenings)
--
-- Scenario: Sophie works sustained 13.5h daytime duties (08:00–21:30). Any
-- rolling 7-day window = 94.5h on-duty → 73.5h rest (< 77h), tripping ONLY the
-- weekly rule (no 14h-continuous, daily rest 10.5h ≥ 10h). The engine offers to
-- trim ~4h off an upcoming evening (17:30–21:30) for Claire to absorb — a clean,
-- night-safe coverage handoff that clears the breach.
--
-- Verified: produces a HIGH-confidence "shorten 17:30–21:30 → Claire covers"
-- plus a "day off tomorrow" option, both resolving the weekly shortfall.

-- ── APPLY ──────────────────────────────────────────────────────────────────
DELETE FROM rota_shifts
WHERE tenant_id = 'de051fc7-ec3b-4c22-96e8-b9834acda6aa'
  AND member_id = 'b0000001-0000-4000-8000-000000000004'
  AND shift_date BETWEEN '2026-06-11' AND '2026-06-23';

INSERT INTO rota_shifts (tenant_id, member_id, rota_id, shift_date, start_time, end_time, shift_type, sub_type, status)
SELECT 'de051fc7-ec3b-4c22-96e8-b9834acda6aa',
       'b0000001-0000-4000-8000-000000000004',
       '1320e29e-da65-4185-aff5-297580eed0cc',
       d::date, TIME '08:00', TIME '21:30', 'duty', NULL, 'published'
FROM generate_series('2026-06-11'::date, '2026-06-23'::date, INTERVAL '1 day') d;

-- ── REVERT ─────────────────────────────────────────────────────────────────
-- Restores Sophie's original uniform standby 09:00–17:00 for the same range.
--
-- DELETE FROM rota_shifts
-- WHERE tenant_id = 'de051fc7-ec3b-4c22-96e8-b9834acda6aa'
--   AND member_id = 'b0000001-0000-4000-8000-000000000004'
--   AND shift_date BETWEEN '2026-06-11' AND '2026-06-23';
--
-- INSERT INTO rota_shifts (tenant_id, member_id, rota_id, shift_date, start_time, end_time, shift_type, sub_type, status)
-- SELECT 'de051fc7-ec3b-4c22-96e8-b9834acda6aa',
--        'b0000001-0000-4000-8000-000000000004',
--        '1320e29e-da65-4185-aff5-297580eed0cc',
--        d::date, TIME '09:00', TIME '17:00', 'standby', NULL, 'published'
-- FROM generate_series('2026-06-11'::date, '2026-06-23'::date, INTERVAL '1 day') d;
