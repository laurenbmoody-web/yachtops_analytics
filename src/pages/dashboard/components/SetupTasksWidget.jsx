// SetupTasksWidget — what's left to do before Cargo is actually set up.
//
// This is the half of the old onboarding slab that was doing real work. The slab
// itself is gone (an anchor-chain graphic, a welcome headline, four feature tiles
// and a progress percentage, above the dashboard, for thirty days) and the guided
// tour now teaches the page in place. But the task list underneath it was genuine:
// a vessel with no locations and no inventory can't use most of the app, and a
// captain needs to be told which gap to close next.
//
// So it lives on as an ordinary widget — in the grid, reorderable, removable, and
// it renders NOTHING once there is nothing left to do. Two audiences:
//
//   * Command/Chief get the vessel setup list (locations, folders, import, crew),
//     with skip and bring-back persisted to tenants.dismissed_tasks exactly as
//     before.
//   * Everyone else gets the one task that is theirs — a profile with a name and a
//     face on it, so their crew can recognise them in a job assignment.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, User } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { ONBOARDING_TASKS } from '../onboardingTasks';
import './setup-tasks.css';

const SetupTasksWidget = ({ isAdmin, ctx, tenant, userId, onSkip, onUnskip }) => {
  const [profileDone, setProfileDone] = useState(true); // optimistic: never flash the nudge
  const [checking, setChecking] = useState(true);

  // Crew-side task only — an admin's list is derived from vessel state the
  // dashboard has already loaded.
  useEffect(() => {
    if (isAdmin || !userId) { setChecking(false); return undefined; }
    let dead = false;
    (async () => {
      try {
        // Explicit columns: profiles.email is column-restricted, so select('*')
        // would 403 here.
        const { data } = await supabase
          .from('profiles').select('id, full_name, avatar_url').eq('id', userId).maybeSingle();
        if (dead) return;
        setProfileDone(!!data?.full_name?.trim() && !!data?.avatar_url);
      } catch (err) {
        console.warn('[SetupTasksWidget] profile check failed', err);
      } finally {
        if (!dead) setChecking(false);
      }
    })();
    return () => { dead = true; };
  }, [isAdmin, userId]);

  // ── Crew ───────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    if (checking || profileDone) return null;
    return (
      <div className="ce-card st rounded-xl p-5" data-tour="widget-setupTasks">
        <h3 className="ce-title">Finish your profile</h3>
        <p className="ce-status">One thing left before you’re squared away.</p>
        <Link to={`/profile/${userId}`} className="st-row st-row-link">
          <span className="st-ic"><User size={16} /></span>
          <span className="st-main">
            <span className="st-name">Add your name and a photo</span>
            <span className="st-sub">So your crew knows who picked up the job</span>
          </span>
          <span className="st-go">Start →</span>
        </Link>
      </div>
    );
  }

  // ── Command / Chief ────────────────────────────────────────────────────────
  const dismissed = tenant?.dismissed_tasks ?? [];
  const rows = ONBOARDING_TASKS.map((t) => ({
    ...t,
    done: t.isDone(ctx),
    skipped: dismissed.includes(t.key),
  }));
  const open = rows.filter((r) => !r.done && !r.skipped);
  const doneCount = rows.filter((r) => r.done).length;

  // Everything done or waved off — the widget stops existing.
  if (open.length === 0 && !rows.some((r) => r.skipped)) return null;

  return (
    <div className="ce-card st rounded-xl p-5" data-tour="widget-setupTasks">
      <div className="st-head">
        <div>
          <h3 className="ce-title">Setting up</h3>
          <p className="ce-status">
            {open.length === 0
              ? 'Nothing outstanding — skipped items below.'
              : `${doneCount} of ${rows.length} done · ${open.length} to go`}
          </p>
        </div>
        <span className="st-count">{doneCount}/{rows.length}</span>
      </div>

      <div className="st-list">
        {rows.filter((r) => !r.skipped).map((r) => {
          const Icon = r.icon;
          if (r.done) {
            return (
              <div key={r.key} className="st-row st-done">
                <span className="st-ic st-ic-done"><Check size={15} /></span>
                <span className="st-main"><span className="st-name">{r.title}</span></span>
              </div>
            );
          }
          return (
            <div key={r.key} className="st-row">
              <span className="st-ic"><Icon size={16} /></span>
              <span className="st-main"><span className="st-name">{r.title}</span></span>
              <Link to={r.href} className="st-go">
                {r.key === 'invite_crew' ? 'Invite' : 'Start'} →
              </Link>
              <button type="button" className="st-skip" onClick={() => onSkip?.(r.key)}>
                Skip
              </button>
            </div>
          );
        })}
      </div>

      {rows.some((r) => r.skipped) && (
        <div className="st-skipped">
          <p className="st-skipped-h">Skipped</p>
          {rows.filter((r) => r.skipped).map((r) => (
            <div key={r.key} className="st-row st-row-quiet">
              <span className="st-main"><span className="st-name">{r.title}</span></span>
              <button type="button" className="st-skip" onClick={() => onUnskip?.(r.key)}>
                Bring back
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SetupTasksWidget;
