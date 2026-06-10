// fmtDateRange — a compact, day-first label for a submission's span.
// Inputs are local YYYY-MM-DD strings (parsed by split, not Date, to avoid
// timezone drift). Examples:
//   '2026-06-10' → '2026-06-22'  →  '10–22 Jun'
//   '2026-06-30' → '2026-07-02'  →  '30 Jun – 2 Jul'
//   single day / no end          →  '10 Jun'
//   no start                     →  null (caller falls back to a count)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDateRange(start, end) {
  if (!start) return null;
  const [sy, sm, sd] = String(start).split('-').map(Number);
  const [ey, em, ed] = end ? String(end).split('-').map(Number) : [sy, sm, sd];
  const sMon = MONTHS[sm - 1];
  const eMon = MONTHS[em - 1];
  if (!end || start === end) return `${sd} ${sMon}`;
  if (sy === ey && sm === em) return `${sd}–${ed} ${sMon}`;
  if (sy === ey) return `${sd} ${sMon} – ${ed} ${eMon}`;
  return `${sd} ${sMon} ${sy} – ${ed} ${eMon} ${ey}`;
}
