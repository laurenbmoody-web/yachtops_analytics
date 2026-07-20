import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import './team-jobs-widget.css';

const VISIBLE = 5;
const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A job's due state → {rank, cls, label}. Overdue first, then today, then soon.
function dueState(due, todayStr) {
  if (!due) return { rank: 4, cls: 'is-soon', label: 'No date' };
  if (due < todayStr) {
    const days = Math.round((new Date(`${todayStr}T00:00:00`) - new Date(`${due}T00:00:00`)) / 86400000);
    return { rank: 0, cls: 'is-late', label: `${days}d late` };
  }
  if (due === todayStr) return { rank: 1, cls: 'is-today', label: 'Today' };
  const dt = new Date(`${due}T00:00:00`);
  return { rank: 2, cls: 'is-soon', label: `${WD[dt.getDay()]} ${dt.getDate()}` };
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
  const [completing, setCompleting] = useState(null);

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
        due: dueState(j.due_date, todayStr),
      })).sort((a, b) => a.due.rank - b.due.rank || (b.urgent - a.urgent));

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

  const complete = async (id) => {
    setCompleting(id);
    try {
      const { error: upErr } = await supabase.from('team_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString(), completion_date: todayStr, completed_by: authUser.id })
        .eq('id', id).eq('tenant_id', activeTenantId);
      if (upErr) throw upErr;
      setJobs((js) => js.filter((j) => j.id !== id));
      setDoneToday((n) => n + 1);
    } catch (err) {
      console.error('[TeamJobListWidget] complete failed:', err);
      load();
    } finally {
      setCompleting(null);
    }
  };

  const overdue = jobs.filter((j) => j.due.rank === 0).length;
  const dueToday = jobs.filter((j) => j.due.rank === 1).length;
  const shown = jobs.slice(0, VISIBLE);
  const moreCount = jobs.length - shown.length;

  let statusText = view === 'crew' ? 'Nothing due' : 'All clear';
  let attention = false;
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (overdue > 0) { statusText = `${overdue} overdue${dueToday ? ` · ${dueToday} due today` : ''}`; attention = true; }
  else if (dueToday > 0) { statusText = `${dueToday} due today`; attention = true; }
  else if (jobs.length > 0) statusText = `${jobs.length} open`;

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
        <div className="space-y-2"><div className="tj-skel" /><div className="tj-skel" /></div>
      ) : error ? (
        <div className="tj-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load jobs.
          <button type="button" className="tj-retry" onClick={load}>Retry</button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="tj-empty">
          <div className="tj-em-ic"><Icon name="Check" size={18} /></div>
          <div className="tj-em-t">{view === 'crew' ? 'You’re on top of things' : 'Nothing outstanding'}</div>
          <div className="tj-em-s">{view === 'crew' ? 'No open jobs assigned to you' : 'No open jobs in your team'}</div>
          {doneToday > 0 && <div className="tj-done" style={{ marginTop: 14 }}><b>{doneToday} done today</b></div>}
        </div>
      ) : (
        <>
          <div className="tj-list">
            {shown.map((j) => (
              <div key={j.id} className="tj-row">
                <button type="button" className="tj-tick" disabled={completing === j.id} onClick={() => complete(j.id)} aria-label={`Complete ${j.title}`}>
                  <Icon name="Check" size={11} />
                </button>
                <div className="tj-main">
                  <div className="tj-t">{j.urgent && <span className="tj-urg">URGENT</span>}{j.title}</div>
                  {view !== 'crew' && (
                    <div className="tj-sub">{j.unassigned ? <span className="tj-unassigned">Unassigned</span> : (j.assignee || 'Assigned')}</div>
                  )}
                </div>
                <span className={`tj-due ${j.due.cls}`}>{j.due.label}</span>
              </div>
            ))}
          </div>
          {moreCount > 0 && (
            <button type="button" className="tj-more" onClick={() => navigate('/team-jobs-management')}>
              +{moreCount} more {view === 'crew' ? 'assigned to you' : 'in your team'}
            </button>
          )}
          {doneToday > 0 && <div className="tj-done"><b>{doneToday} done today</b></div>}
        </>
      )}
    </div>
  );
};

export default TeamJobListWidget;
