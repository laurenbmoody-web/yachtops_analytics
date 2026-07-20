import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { useCurrentRota } from '../../crew-rota/useCurrentRota';
import { ON_DUTY_TYPES } from '../../crew-rota/restHours';
import './rota-widget.css';

// Rota widget — read-only SCHEDULE view. Your rostered hours as a strip of day
// cells (today + the days ahead), plus today's vessel watch. Logging + rest
// compliance live in the separate Hours of Rest widget. The full rota page
// (Open rota) is read-only and department-scoped for crew.

const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return toYmd(dt); };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// A member's on-duty span for a date: earliest start → latest end. Null on a
// rest day. (Schedule display only — split shifts still read as start→end here.)
function spanForDay(shifts, date) {
  const onDuty = shifts.filter((s) => s.date === date && ON_DUTY_TYPES.has(s.shiftType));
  if (onDuty.length === 0) return null;
  let start = null; let end = null;
  for (const s of onDuty) {
    const a = hhmm(s.startTime); const b = hhmm(s.endTime);
    if (a && (start === null || a < start)) start = a;
    if (b && (end === null || b > end)) end = b;
  }
  return start && end ? { start, end } : null;
}

const RotaWidget = () => {
  const navigate = useNavigate();
  const { user, activeTenantId, tenantRole } = useAuth();
  const { rota, loading: rotaLoading, error: rotaError } = useCurrentRota();

  const [myShifts, setMyShifts] = useState([]);
  const [watch, setWatch] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const tier = (tenantRole || user?.permission_tier || '').toUpperCase();
  const isCrew = !['COMMAND', 'CHIEF'].includes(tier);

  const todayStr = toYmd(new Date());
  const loadEnd = addDays(todayStr, 6);

  const load = useCallback(async () => {
    if (!activeTenantId || !rota?.id) { setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const [membersRes, shiftsRes] = await Promise.all([
        supabase.from('tenant_members')
          .select('id, user_id, display_name, department_id')
          .eq('tenant_id', activeTenantId).eq('active', true),
        supabase.from('rota_shifts')
          .select('member_id, shift_date, start_time, end_time, shift_type')
          .eq('tenant_id', activeTenantId).eq('rota_id', rota.id)
          .gte('shift_date', todayStr).lte('shift_date', loadEnd),
      ]);
      if (membersRes.error) throw membersRes.error;
      if (shiftsRes.error) throw shiftsRes.error;

      const me = (membersRes.data || []).find((m) => m.user_id && m.user_id === user?.id);
      const mine = (shiftsRes.data || [])
        .filter((s) => s.member_id === me?.id)
        .map((s) => ({ date: s.shift_date, startTime: s.start_time, endTime: s.end_time, shiftType: s.shift_type }));
      setMyShifts(mine);
      // Vessel watch — PLACEHOLDER until the watch-schedule model is built.
      setWatch((membersRes.data || []).slice(0, 3).map((m) => ({
        name: m.display_name || 'Unknown', isYou: m.id === me?.id,
      })));
    } catch (err) {
      console.error('[RotaWidget] fetch error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, rota?.id, todayStr, loadEnd, user?.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // Today + the next six days as cells.
  const cells = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const date = addDays(todayStr, i);
    const dt = new Date(`${date}T00:00:00`);
    return { date, wd: WD[dt.getDay()], dn: dt.getDate(), isToday: i === 0, span: spanForDay(myShifts, date) };
  }), [myShifts, todayStr]);

  const surname = (name) => {
    const p = String(name).trim().split(/\s+/);
    return p.length === 1 ? p[0] : `${p[0][0]}. ${p[p.length - 1]}`;
  };
  const initials = (name) => {
    const p = String(name).trim().split(/\s+/);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  };

  const busy = loading || rotaLoading;
  const failed = error || Boolean(rotaError);

  return (
    <div className="ce-card rw rounded-xl p-5">
      <div className="rw-head">
        <span className="rw-title">{isCrew ? 'My rota' : 'Rota'}</span>
        <button type="button" className="rw-link" onClick={() => navigate('/crew')}>Open rota →</button>
      </div>

      {busy ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          <div className="rw-skel" style={{ height: 66 }} />
        </div>
      ) : failed ? (
        <div className="rw-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load the rota.
          <button type="button" className="rw-retry" onClick={load}>Retry</button>
        </div>
      ) : !rota?.id ? (
        <p className="rw-empty">No rota configured yet.</p>
      ) : (
        <>
          <div className="rw-eyebrow">Your schedule</div>
          <div className="rw-cal">
            {cells.map((c) => (
              <div key={c.date} className={`rw-day${c.span ? '' : ' is-rest'}${c.isToday ? ' is-today' : ''}`}>
                <div className="rw-wd">{c.isToday ? 'Today' : c.wd}</div>
                <div className="rw-dn">{c.dn}</div>
                {c.span ? (
                  <><div className="rw-t1">{c.span.start}</div><div className="rw-t2">{c.span.end}</div></>
                ) : (
                  <><div className="rw-t1">Rest</div><div className="rw-t2">&nbsp;</div></>
                )}
              </div>
            ))}
          </div>

          <div className="rw-seclab">Vessel watch · today</div>
          {watch.length > 0 ? (
            <div className="rw-watch">
              {watch.map((w) => (
                <span key={w.name} className="rw-wm">
                  <span className={`rw-av${w.isYou ? ' is-you' : ''}`}>{w.isYou ? 'You' : initials(w.name)}</span>
                  <b>{w.isYou ? 'You' : surname(w.name)}</b>
                </span>
              ))}
            </div>
          ) : (
            <p className="rw-empty" style={{ padding: '4px 2px' }}>No one on vessel watch today.</p>
          )}
        </>
      )}
    </div>
  );
};

export default RotaWidget;
