import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';

const TeamJobListWidget = () => {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { activeTenantId } = useTenant();

  const [counts, setCounts] = useState({ overdue: 0, dueToday: 0, completedToday: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeTenantId || !authUser?.id) {
      setLoading(false);
      return;
    }

    const fetchCounts = async () => {
      setLoading(true);
      try {
        const todayStr = (() => {
          const d = new Date();
          return `${d?.getFullYear()}-${String(d?.getMonth() + 1)?.padStart(2, '0')}-${String(d?.getDate())?.padStart(2, '0')}`;
        })();

        // Fetch all OPEN jobs assigned to the current user
        const { data: openJobs } = await supabase
          ?.from('team_jobs')
          ?.select('id, due_date, status')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('assigned_to', authUser?.id)
          ?.eq('status', 'OPEN');

        // Fetch completed jobs assigned to the current user completed today
        const { data: completedJobs } = await supabase
          ?.from('team_jobs')
          ?.select('id, completion_date, status')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('assigned_to', authUser?.id)
          ?.eq('status', 'completed')
          ?.eq('completion_date', todayStr);

        const openList = openJobs || [];
        const dueToday = openList?.filter(j => j?.due_date === todayStr)?.length;
        const overdue = openList?.filter(j => j?.due_date && j?.due_date < todayStr)?.length;
        const completedToday = (completedJobs || [])?.length;

        setCounts({ overdue, dueToday, completedToday });
      } catch (err) {
        console.warn('[TeamJobListWidget] fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCounts();
  }, [activeTenantId, authUser?.id]);

  const total = counts?.overdue + counts?.dueToday;

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Team's job list</h3>
        <button
          onClick={() => navigate('/team-jobs-management')}
          className="text-xs text-primary hover:underline"
        >
          View all
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <LogoSpinner size={20} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-error/10 flex items-center justify-center">
                <Icon name="AlertCircle" className="w-4 h-4 text-error" />
              </div>
              <span className="text-sm text-muted-foreground">Overdue</span>
            </div>
            <span className="text-2xl font-bold text-error">{counts?.overdue}</span>
          </div>

          <div className="flex items-center justify-between py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                <Icon name="Clock" className="w-4 h-4 text-warning" />
              </div>
              <span className="text-sm text-muted-foreground">Due today</span>
            </div>
            <span className="text-2xl font-bold text-warning">{counts?.dueToday}</span>
          </div>

          <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <Icon name="CheckCircle" className="w-4 h-4 text-success" />
              </div>
              <span className="text-sm text-muted-foreground">Completed</span>
            </div>
            <span className="text-2xl font-bold text-success">{counts?.completedToday}</span>
          </div>
        </div>
      )}
      {!loading && total === 0 && counts?.completedToday === 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground text-center italic">
            No open jobs — you're on top of things.
          </p>
        </div>
      )}
    </div>
  );
};

export default TeamJobListWidget;