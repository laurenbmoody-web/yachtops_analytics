-- Marks a tick that came from completing the whole job rather than from
-- someone ticking that task themselves.
--
-- Completing a duty set job means the round is done, so its tasks should read
-- as done — nobody wants to tick eighteen boxes and then tick the job as well.
-- But completion toggles: the same checkbox reopens the job when the crew
-- realise something was missed. Reopening must undo the ticks that completion
-- made without touching the ones the person actually did on the round, and
-- without ever discarding a note. This flag is what tells those two apart.

alter table public.duty_task_progress
  add column if not exists auto_completed boolean not null default false;
