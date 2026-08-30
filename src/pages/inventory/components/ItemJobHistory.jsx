import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { isoToUK } from '../../../utils/dateFormat';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { loadJobHistoryForTarget, INVENTORY } from '../../team-jobs-management/utils/jobLinks';
import './item-job-history.css';

/**
 * Every job this item has been used on, and a way to raise the next one.
 *
 * The point of linking a job to stock is that the item's own page can answer
 * "what has been done with this, and what did it cost us" without anyone
 * keeping a second list. Completed jobs show the quantity actually taken;
 * open ones show what they are expected to take.
 */
const ItemJobHistory = ({ item, canRaise = true }) => {
  // Pulled from context rather than threaded through the item view, which has
  // neither to hand.
  const { activeTenantId: tenantId, currentTenantMember } = useTenant();
  const { session } = useAuth();
  const currentUserId = session?.user?.id || null;
  const departmentId = currentTenantMember?.department_id || null;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState({});
  const [raising, setRaising] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const itemId = item?.id || null;

  const refresh = useCallback(async () => {
    if (!itemId || !tenantId) { setLoading(false); return; }
    try {
      const history = await loadJobHistoryForTarget({
        tenantId, kind: INVENTORY, targetId: itemId,
      });
      setRows(history);

      // Resolve the names once, rather than printing a uuid for who did it.
      const ids = [...new Set(history
        ?.flatMap(h => [h?.job?.completed_by, h?.job?.assigned_to])
        ?.filter(Boolean))];
      if (ids?.length) {
        const { data } = await supabase
          ?.from('profiles')?.select('id, full_name, first_name, last_name')?.in('id', ids);
        const map = {};
        (data || [])?.forEach(p => {
          map[p?.id] = p?.full_name
            || [p?.first_name, p?.last_name]?.filter(Boolean)?.join(' ')
            || null;
        });
        setNames(map);
      }
      setError(null);
    } catch (err) {
      console.warn('[ItemJobHistory] load failed:', err);
      setError('Could not load this item’s job history.');
    } finally {
      setLoading(false);
    }
  }, [itemId, tenantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRaise = async () => {
    const clean = title?.trim();
    if (!clean || !tenantId || !itemId) return;
    setSaving(true);
    try {
      const { data: job, error: jobErr } = await supabase
        ?.from('team_jobs')
        ?.insert({
          tenant_id: tenantId,
          title: clean,
          status: 'OPEN',
          created_by: currentUserId || null,
          department_id: departmentId || null,
          is_private: false,
        })
        ?.select('id')
        ?.single();
      if (jobErr) throw jobErr;

      const { error: linkErr } = await supabase?.from('job_links')?.insert({
        tenant_id: tenantId,
        job_id: job?.id,
        kind: INVENTORY,
        inventory_item_id: itemId,
        created_by: currentUserId || null,
      });
      if (linkErr) throw linkErr;

      setTitle('');
      setRaising(false);
      await refresh();
    } catch (err) {
      console.warn('[ItemJobHistory] raise failed:', err);
      setError('Could not raise that job. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const who = (row) => names?.[row?.job?.completed_by] || names?.[row?.job?.assigned_to] || null;

  return (
    <div className="ijh">
      <div className="ijh-head">
        <p className="ijh-label">
          <Icon name="ClipboardList" size={13} />
          Jobs
        </p>
        {canRaise && (
          <button type="button" className="ijh-raise" onClick={() => setRaising(!raising)}>
            <Icon name={raising ? 'X' : 'Plus'} size={13} />
            {raising ? 'Cancel' : 'Raise a job'}
          </button>
        )}
      </div>

      {error && (
        <div className="ijh-err">
          <Icon name="AlertCircle" size={14} />
          <span>{error}</span>
        </div>
      )}

      {raising && (
        <div className="ijh-raisebox">
          <input
            autoFocus
            type="text"
            className="ijh-input"
            placeholder={`What needs doing with the ${item?.name || 'item'}?`}
            value={title}
            onChange={(e) => setTitle(e?.target?.value)}
            onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); handleRaise(); } }}
          />
          <button
            type="button"
            className="ijh-save"
            onClick={handleRaise}
            disabled={saving || !title?.trim()}
          >
            {saving ? 'Saving…' : 'Raise'}
          </button>
        </div>
      )}

      {rows?.length === 0 ? (
        <p className="ijh-empty">No jobs have used this item yet.</p>
      ) : (
        <div className="ijh-list">
          {rows?.map(row => {
            const done = row?.job?.status === 'completed';
            const when = row?.job?.completed_at || row?.job?.due_date || null;
            const name = who(row);
            return (
              <div key={row?.linkId} className={`ijh-row${done ? ' done' : ''}`}>
                <span className={`ijh-dot${done ? ' on' : ''}`}>
                  {done && <Icon name="Check" size={10} />}
                </span>
                <div className="ijh-main">
                  <p className="ijh-title">{row?.job?.title}</p>
                  <p className="ijh-meta">
                    {[
                      done ? 'Completed' : (row?.job?.status === 'OPEN' ? 'Open' : row?.job?.status),
                      when ? isoToUK(String(when)?.split('T')?.[0]) : null,
                      name,
                    ]?.filter(Boolean)?.join(' · ')}
                  </p>
                </div>
                {row?.qty > 0 && (
                  <span className={`ijh-qty${row?.consumedAt ? ' used' : ''}`}>
                    {row?.consumedAt ? '−' : ''}{row?.qty}
                    {item?.unit ? ` ${item?.unit}` : ''}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ItemJobHistory;
