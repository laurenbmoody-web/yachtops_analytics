import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import './team-jobs-widget.css';

const VISIBLE = 4; // shown in the quiet index, after the lead
const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A job's due state. `rank` sorts (overdue → today → soon → undated); `label`
// is the compact index tag; `num`/`unit`/`word` drive the lead's serif figure.
function dueState(due, todayStr) {
  if (!due) return { rank: 4, cls: 'is-soon', label: 'No date', num: null, unit: null, word: 'Open' };
  if (due < todayStr) {
    const days = Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${due}T00:00:00`)) / 86400000);
    return { rank: 0, cls: 'is-late', label: `${days}d late`, num: days, unit: days === 1 ? 'day late' : 'days late', word: null };
  }
  if (due === todayStr) return { rank: 1, cls: 'is-today', label: 'Today', num: null, unit: null, word: 'Today' };
  const dt = new Date(`${due}T00:00:00`);
  return { rank: 2, cls: 'is-soon', label: `${WD[dt.getDay()]} ${dt.getDate()}`, num: null, unit: null, word: WD[dt.getDay()] };
}

const TeamJobListWidget = () => {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { activeTenantId } = useTenant();

  const [jobs, setJobs] = useState([]);
  const [doneToday, setDoneToday] = useState(0);
  const [view, setView] = useState('crew');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [clearing, setClearing] = useState(null); // job id mid strike-through

  const todayStr = toYmd(new Date());

  const load = useCallback(async () => {
    if (!activeTenantId || !authUser?.id) { setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      // Resolve my tier + department, and a user→name map for assignees.
      const membersRes = await supabase.from('tenant_members')
        .select('user_id, display_name, department_id, permission_tier')
        .eq('tenant_id', activeTenantId).eq('active', true);
      if (membersRes.error) throw membersRes.error;
      const me = (membersRes.data || []).find((m) => m.user_id === authUser.id);
      const myDept = me?.department_id || null;
      const nameByUser = new Map((membersRes.data || []).map((m) => [m.user_id, m.display_name]));
      const tier = (me?.permission_tier || '').toUpperCase();
      const v = tier === 'COMMAND' ? 'command' : tier === 'CHIEF' ? 'chief' : 'crew';
      setView(v);

      // Open jobs in scope. status IN ('OPEN','active') — 'OPEN' is rotation
      // jobs, 'active' is manually-created ones (the old widget missed those).
      let q = supabase.from('team_jobs')
        .select('id, title, due_date, assigned_to, metadata')
        .eq('tenant_id', activeTenantId).in('status', ['OPEN', 'active']);
      if (v === 'crew') q = q.eq('assigned_to', authUser.id);
      else if (v === 'chief' && myDept) q = q.eq('department_id', myDept);
      const openRes = await q;
      if (openRes.error) throw openRes.error;

      // Completed today, same scope — the momentum number.
      let cq = supabase.from('team_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', activeTenantId).eq('status', 'completed').eq('completion_date', todayStr);
      if (v === 'crew') cq = cq.eq('assigned_to', authUser.id);
      else if (v === 'chief' && myDept) cq = cq.eq('department_id', myDept);
      const doneRes = await cq;

      const shaped = (openRes.data || []).map((j) => ({
        id: j.id,
        title: j.title || 'Untitled job',
        urgent: j.metadata?.priority === 'urgent',
        assignee: j.assigned_to ? (nameByUser.get(j.assigned_to) || null) : null,
        unassigned: !j.assigned_to,
        dueRaw: j.due_date || null,
        due: dueState(j.due_date, todayStr),
      })).sort((a, b) => {
        // Overdue → today → soon → undated. Within a group, the earliest due
        // date wins (most-overdue leads; soonest-upcoming first), so the lead
        // is always the single most pressing job. Urgent breaks exact ties.
        if (a.due.rank !== b.due.rank) return a.due.rank - b.due.rank;
        if (a.dueRaw && b.dueRaw && a.dueRaw !== b.dueRaw) return a.dueRaw < b.dueRaw ? -1 : 1;
        return b.urgent - a.urgent;
      });

      setJobs(shaped);
      setDoneToday(doneRes.count || 0);
    } catch (err) {
      console.error('[TeamJobListWidget] fetch error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, authUser?.id, todayStr]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // Tick to complete: strike the row through (CSS animation), write it, then
  // drop it from the list once the animation has played.
  const complete = async (id, e) => {
    if (e) e.stopPropagation();
    if (clearing) return;
    setClearing(id);
    try {
      const { error: upErr } = await supabase.from('team_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString(), completion_date: todayStr, completed_by: authUser.id })
        .eq('id', id).eq('tenant_id', activeTenantId);
      if (upErr) throw upErr;
      setDoneToday((n) => n + 1);
      setTimeout(() => {
        setJobs((js) => js.filter((j) => j.id !== id));
        setClearing(null);
      }, 520);
    } catch (err) {
      console.error('[TeamJobListWidget] complete failed:', err);
      setClearing(null);
      load();
    }
  };

  const openJob = (id) => navigate(`/team-jobs-management?job=${id}`);

  const overdue = jobs.filter((j) => j.due.rank === 0).length;
  const dueToday = jobs.filter((j) => j.due.rank === 1).length;
  const lead = jobs[0] || null;
  const rest = jobs.slice(1, 1 + VISIBLE);
  const moreCount = Math.max(0, jobs.length - 1 - rest.length);

  let statusText = view === 'crew' ? 'Nothing due' : 'All clear';
  let attention = false;
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (overdue > 0) { statusText = `${overdue} overdue${dueToday ? ` · ${dueToday} today` : ''}`; attention = true; }
  else if (dueToday > 0) { statusText = `${dueToday} due today`; attention = true; }
  else if (jobs.length > 0) statusText = `${jobs.length} open`;

  // The lead's serif figure: a number for overdue (days late), otherwise a word.
  const leadSub = lead && (
    view === 'crew'
      ? (lead.urgent ? 'Flagged urgent' : 'Your next priority')
      : (lead.unassigned ? <><span className="u">Unassigned</span> · needs an owner</> : <>Owned by <span className="u">{lead.assignee || 'someone'}</span></>)
  );

  return (
    <div className="ce-card rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="ce-title">{view === 'crew' ? 'My jobs' : 'Team jobs'}</h3>
          <p className={`ce-status${attention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <button type="button" className="ce-link" onClick={() => navigate('/team-jobs-management')}>View all</button>
      </div>

      {loading ? (
        <div className="space-y-2"><div className="tj-skel" style={{ height: 62 }} /><div className="tj-skel" style={{ height: 40 }} /><div className="tj-skel" style={{ height: 40 }} /></div>
      ) : error ? (
        <div className="tj-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load jobs.
          <button type="button" className="tj-retry" onClick={load}>Retry</button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="tj-empty">
          <div className="ic"><Icon name="Check" size={18} /></div>
          <div className="t">{view === 'crew' ? 'You’re on top of things' : 'Nothing outstanding'}</div>
          <div className="s">{view === 'crew' ? 'No open jobs assigned to you' : 'No open jobs in your team'}</div>
          {doneToday > 0 && <div className="tj-cleared" style={{ justifyContent: 'center', marginTop: 14 }}><Icon name="Check" size={13} /> <b>{doneToday}</b> cleared today</div>}
        </div>
      ) : (
        <>
          {/* Lead — the one job that matters most, its urgency as a serif figure. */}
          <div className={`tj-lead${clearing === lead.id ? ' is-clearing' : ''}`} onClick={() => openJob(lead.id)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openJob(lead.id)}>
            <div className="tj-lead-fig">
              {lead.due.num != null ? (
                <>
                  <div className="tj-lead-num">{lead.due.num}</div>
                  <div className="tj-lead-unit">{lead.due.unit}</div>
                </>
              ) : (
                <>
                  <div className="tj-lead-word">{lead.due.word}</div>
                  <div className="tj-lead-unit">{lead.due.rank === 1 ? 'due' : lead.due.rank === 4 ? 'no date' : 'due'}</div>
                </>
              )}
            </div>
            <div className="tj-lead-m">
              <div className="tj-lead-e">{lead.due.rank === 0 ? 'Overdue' : lead.due.rank === 1 ? 'Due today' : 'Up next'}</div>
              <div className="tj-lead-t">{lead.title}</div>
              <div className="tj-lead-s">{leadSub}</div>
            </div>
            <button type="button" className="tj-tick" disabled={!!clearing} onClick={(e) => complete(lead.id, e)} aria-label={`Complete ${lead.title}`} style={{ marginRight: 2 }}>
              <Icon name="Check" size={11} />
            </button>
          </div>

          {/* The quiet index — everything else. */}
          {rest.length > 0 && (
            <>
              <div className="tj-then">Then</div>
              <div className="tj-list">
                {rest.map((j) => (
                  <div key={j.id} className={`tj-row${clearing === j.id ? ' is-clearing' : ''}`} onClick={() => openJob(j.id)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openJob(j.id)}>
                    <button type="button" className="tj-tick" disabled={!!clearing} onClick={(e) => complete(j.id, e)} aria-label={`Complete ${j.title}`}>
                      <Icon name="Check" size={11} />
                    </button>
                    <div className="tj-t">
                      {j.title}
                      {view !== 'crew' && <span className="tj-sub"> · {j.unassigned ? <span className="u">Unassigned</span> : (j.assignee || 'Assigned')}</span>}
                    </div>
                    <span className={`tj-d ${j.due.cls}`}>{j.due.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="tj-foot">
            {moreCount > 0
              ? <button type="button" className="tj-more" onClick={() => navigate('/team-jobs-management')}>+{moreCount} more {view === 'crew' ? 'assigned to you' : 'in your team'} →</button>
              : <span />}
            {doneToday > 0 && <span className="tj-cleared"><Icon name="Check" size={13} /> <b>{doneToday}</b> cleared today</span>}
          </div>
        </>
      )}
    </div>
  );
};

export default TeamJobListWidget;
