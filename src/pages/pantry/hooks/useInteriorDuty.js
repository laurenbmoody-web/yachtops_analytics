// v1: stubbed — no real-time duty roster table exists yet.
// Returns a hardcoded on-duty stew. Real implementation will query
// an interior_duty_periods table (crew_member_id, starts_at, ends_at).
export function useInteriorDuty() {
  return {
    onDuty: { name: 'Claire', until: '20:00' },
    loading: false,
    error: null,
  };
}
