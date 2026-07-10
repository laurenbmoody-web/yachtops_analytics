-- Rotation-pattern unit for the employment record. The `rotation_pattern` free
-- text (e.g. "2:2") has no unit, but PYA's Sea Service Testimonial asks for the
-- rotation program in WEEKS. Capturing the unit explicitly lets the autofill
-- convert exactly instead of inferring (months for small figures, weeks for
-- large). NULL = not set → the autofill falls back to inference.
alter table public.crew_employment
  add column if not exists rotation_unit text
    check (rotation_unit in ('weeks', 'months'));
