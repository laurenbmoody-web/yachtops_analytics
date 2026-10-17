import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import QuickAddDefectModal from '../../defects/components/QuickAddDefectModal';
import './provisioning-widget.css';

// Open defects at a glance, worst first, with the way in to the Defects page —
// on a phone the dashboard is how crew reach it.
const VISIBLE = 3;
const PRIORITY = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const DOT = { Critical: '#B23A2E', High: '#C65A1A', Medium: '#A8791C', Low: '#AEB4C2' };
const STATUS_LABEL = { New: 'New', Assigned: 'Assigned', InProgress: 'In progress', WaitingParts: 'Waiting parts', Reopened: 'Reopened', Fixed: 'Fixed' };

const DefectsWidget = () => {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    try {
      const { data, error: err } = await supabase.from('defects')
        .select('id, title, priority, status, location_path_label, created_at')
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null)
        .not('status', 'in', '("Closed","Declined")')
        .order('created_at', { ascending: false })
        .limit(100);
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      console.error('[DefectsWidget] fetch error:', e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const sorted = [...rows].sort((a, b) =>
    (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9) || new Date(b.created_at) - new Date(a.created_at));
  const shown = sorted.slice(0, VISIBLE);
  const moreCount = rows.length - shown.length;
  const urgent = rows.filter((d) => d.priority === 'Critical' || d.priority === 'High').length;

  let statusText = '';
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (rows.length === 0) statusText = 'Nothing open';
  else statusText = `${rows.length} open${urgent ? ` · ${urgent} high priority` : ''}`;

  return (
    <div className="ce-card rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="ce-title">Defects</h3>
          <p className={`ce-status${urgent ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <button type="button" onClick={() => navigate('/defects')} className="ce-link">View all</button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : error ? (
        <div className="prov-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load defects.
          <button type="button" className="prov-retry" onClick={load}>Retry</button>
        </div>
      ) : shown.length > 0 ? (
        <div className="prov-list">
          {shown.map((d) => (
            <div key={d.id} className="prov-row">
              <span className="prov-dot" style={{ background: DOT[d.priority] || '#AEB4C2' }} />
              <div className="prov-main">
                <div className="prov-t" title={d.title}>{d.title}</div>
                <div className="prov-s">
                  {d.priority || 'No priority'} · {STATUS_LABEL[d.status] || d.status}
                  {d.location_path_label ? ` · ${d.location_path_label}` : ''}
                </div>
              </div>
              <button type="button" className="prov-view" onClick={() => navigate(`/defects/${d.id}`)}>View</button>
            </div>
          ))}
          {moreCount > 0 && (
            <button type="button" className="prov-more" onClick={() => navigate('/defects')}>+{moreCount} more in defects</button>
          )}
        </div>
      ) : (
        <p className="prov-empty">No open defects.</p>
      )}

      <div className="mt-4 pt-3 border-t border-border">
        <button type="button" onClick={() => setReporting(true)} className="ce-action w-full text-xs">
          <Icon name="Plus" className="w-3.5 h-3.5" />
          Report defect
        </button>
      </div>

      {reporting && (
        <QuickAddDefectModal
          onClose={() => setReporting(false)}
          onSuccess={() => { setReporting(false); load(); }}
        />
      )}
    </div>
  );
};

export default DefectsWidget;
