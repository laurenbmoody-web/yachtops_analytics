import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useDefectActor } from '../defects/utils/useDefectActor';
import {
  fetchSchedules, fetchEquipment, fetchCategories,
  createSchedule, updateSchedule, deleteSchedule, generateOccurrence,
} from './utils/upkeepStorage';
import { describeRecurrence, nextDue, dueState } from './utils/recurrence';
import ScheduleEditorModal from './components/ScheduleEditorModal';
import './upkeep.css';

// Upkeep — recurring work across every department.
//
// The list of SCHEDULES (the templates). Doing the work happens in Team Jobs:
// a schedule generates a team_jobs row with source='upkeep', so an engine
// service and a laundry daily sit in the same crew list rather than in a
// separate maintenance module the crew has to remember to open.

const UpkeepPage = () => {
  const navigate = useNavigate();
  const actor = useDefectActor();

  const [schedules, setSchedules] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [editing, setEditing] = useState(null);   // schedule | {} for new | null
  const [raising, setRaising] = useState(null);

  const load = useCallback(async () => {
    if (!actor?.tenantId) { setLoading(false); return; }
    try {
      setLoading(true);
      const [s, e, c] = await Promise.all([
        fetchSchedules(actor.tenantId),
        fetchEquipment(actor.tenantId),
        fetchCategories(actor.tenantId),
      ]);
      setSchedules(s);
      setEquipment(e);
      setCategories(c);
      setError('');
    } catch (err) {
      setError(err?.message || 'Could not load Upkeep.');
    } finally {
      setLoading(false);
    }
  }, [actor?.tenantId]);

  useEffect(() => { load(); }, [load]);

  // counters are looked up by id when describing a counter-driven recurrence
  const counterById = useMemo(() => {
    const m = new Map();
    equipment.forEach((e) => (e.counters || []).forEach((c) => m.set(c.id, c)));
    return m;
  }, [equipment]);

  const equipmentById = useMemo(
    () => new Map(equipment.map((e) => [e.id, e])),
    [equipment],
  );

  const decorated = useMemo(() => schedules.map((s) => {
    const counter = s.counterId ? counterById.get(s.counterId) : null;
    const due = s.nextDueDate ? { date: s.nextDueDate } : nextDue(s, counter);
    return {
      ...s,
      counter,
      due: dueState(due.date, s.leadTimeDays),
      dueDate: due.date,
      recurrenceLabel: describeRecurrence(s, counter),
      equipmentName: s.equipmentId ? equipmentById.get(s.equipmentId)?.name : null,
    };
  }), [schedules, counterById, equipmentById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return decorated
      .filter((s) => categoryFilter === 'All' || s.category === categoryFilter)
      .filter((s) => !q
        || s.name.toLowerCase().includes(q)
        || (s.category || '').toLowerCase().includes(q)
        || (s.equipmentName || '').toLowerCase().includes(q)
        || s.steps.some((st) => st.text.toLowerCase().includes(q)))
      .sort((a, b) => {
        const rank = { overdue: 0, today: 1, soon: 2, ahead: 3, none: 4 };
        const d = (rank[a.due.key] ?? 5) - (rank[b.due.key] ?? 5);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
  }, [decorated, categoryFilter, search]);

  const stats = useMemo(() => ({
    total: decorated.length,
    overdue: decorated.filter((s) => s.due.key === 'overdue').length,
    today: decorated.filter((s) => s.due.key === 'today').length,
    steps: decorated.reduce((n, s) => n + s.steps.length, 0),
  }), [decorated]);

  const handleSave = async (draft) => {
    if (draft.id) await updateSchedule(draft.id, draft, actor);
    else await createSchedule(draft, actor);
    setEditing(null);
    await load();
  };

  const handleDelete = async (schedule) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${schedule.name}"? Jobs already raised from it are kept.`)) return;
    try {
      await deleteSchedule(schedule.id);
      await load();
    } catch (e) {
      setError(e?.message || 'Could not delete that schedule.');
    }
  };

  // Raise the occurrence now — the manual version of what the generator will do
  // on a schedule. Lands in Team Jobs like any other job.
  const handleRaise = async (schedule) => {
    setRaising(schedule.id);
    try {
      await generateOccurrence(schedule, actor, { counter: schedule.counter });
      navigate('/team-jobs-management');
    } catch (e) {
      setError(e?.message || 'Could not raise the job.');
      setRaising(null);
    }
  };

  const headline = stats.overdue > 0 ? 'behind' : stats.today > 0 ? 'due today' : 'on schedule';

  return (
    <>
      <Header />
      <div className="uk-page">
        <div className="uk-wrap">
          <button type="button" className="uk-back" onClick={() => navigate('/dashboard')}>
            <Icon name="ChevronLeft" size={16} /> Back to Dashboard
          </button>

          <div className="uk-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Upkeep</span>
              <span className="bar" />
              <span className="muted">{stats.total} schedule{stats.total === 1 ? '' : 's'}</span>
              <span className="bar" />
              <span className="muted">
                {stats.overdue > 0 ? `${stats.overdue} overdue` : `${stats.steps} steps`}
              </span>
            </p>
            <div className="uk-titlerow">
              <h1 className="editorial-greeting">
                Upkeep<span className="period">,</span> <em>{headline}</em><span className="period">.</span>
              </h1>
              <div className="uk-actions">
                <button type="button" className="uk-btn" onClick={() => navigate('/team-jobs-management')}>
                  <Icon name="ClipboardList" size={15} /> Team Jobs
                </button>
                <button type="button" className="uk-btn uk-btn--primary" onClick={() => setEditing({})}>
                  <Icon name="Plus" size={15} /> New schedule
                </button>
              </div>
            </div>
          </div>

          {error && <div className="uk-error">{error}</div>}

          <div className="uk-stats">
            <div>
              <div className="uk-stat-n">{stats.total}</div>
              <div className="uk-stat-l">Schedules</div>
            </div>
            <div>
              <div className={`uk-stat-n ${stats.overdue ? 'is-alert' : ''}`}>{stats.overdue}</div>
              <div className="uk-stat-l">Overdue</div>
            </div>
            <div>
              <div className="uk-stat-n">{stats.today}</div>
              <div className="uk-stat-l">Due today</div>
            </div>
            <div>
              <div className="uk-stat-n">{stats.steps}</div>
              <div className="uk-stat-l">Steps</div>
            </div>
          </div>

          <div className="uk-filters">
            <button type="button" className={`uk-pill ${categoryFilter === 'All' ? 'is-on' : ''}`}
              onClick={() => setCategoryFilter('All')}>All</button>
            {categories.map((c) => (
              <button key={c} type="button" className={`uk-pill ${categoryFilter === c ? 'is-on' : ''}`}
                onClick={() => setCategoryFilter(c)}>{c}</button>
            ))}
            <input
              className="uk-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search schedules, equipment or a step…"
              aria-label="Search Upkeep"
            />
          </div>

          {loading ? (
            <div className="uk-empty">Loading…</div>
          ) : !filtered.length ? (
            <div className="uk-empty">
              <h3>{schedules.length ? 'Nothing matches' : 'No schedules yet'}</h3>
              <p>
                {schedules.length
                  ? 'Try a different category or search term.'
                  : 'A schedule is a piece of recurring work — a daily round, a weekly clean, a service every 250 hours. Each one holds its own steps.'}
              </p>
              {!schedules.length && (
                <button type="button" className="uk-btn uk-btn--primary" onClick={() => setEditing({})}>
                  <Icon name="Plus" size={15} /> New schedule
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="uk-seclabel">Schedules</p>
              <div className="uk-list">
                {filtered.map((s) => (
                  <div key={s.id} className="uk-row" role="button" tabIndex={0}
                    onClick={() => setEditing(s)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditing(s); }}>
                    <div className="uk-row-main">
                      <p className="uk-row-name">{s.name}</p>
                      <div className="uk-row-sub">
                        {s.category && <span className="uk-chip uk-chip--plain">{s.category}</span>}
                        {s.isClassItem && <span className="uk-chip uk-chip--class">Class</span>}
                        <span className="uk-count">{s.steps.length} step{s.steps.length === 1 ? '' : 's'}</span>
                        {s.equipmentName && (<><span className="sep">·</span><span>{s.equipmentName}</span></>)}
                      </div>
                    </div>

                    <div className="uk-row-cell">{s.recurrenceLabel}</div>

                    <div className="uk-row-cell">
                      <span className={`uk-due uk-due--${s.due.key}`}>{s.due.label}</span>
                    </div>

                    <div className="uk-row-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="uk-btn" disabled={raising === s.id}
                        onClick={() => handleRaise(s)} title="Raise this job now, into Team Jobs">
                        {raising === s.id ? 'Raising…' : 'Raise now'}
                      </button>
                      <button type="button" className="uk-btn uk-btn--ghostdanger"
                        onClick={() => handleDelete(s)} aria-label={`Delete ${s.name}`}>
                        <Icon name="Trash2" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {editing && (
        <ScheduleEditorModal
          schedule={editing.id ? editing : null}
          categories={categories}
          equipment={equipment}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
};

export default UpkeepPage;
