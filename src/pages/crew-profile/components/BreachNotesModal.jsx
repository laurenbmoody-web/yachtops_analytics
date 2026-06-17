import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { upsertBreachNote, getBreachNoteForDate } from '../utils/horBreachNotesStorage';
import { upsertBreachReason } from '../utils/horBreachReasons';

import ModalShell from '../../../components/ui/ModalShell';
import './breach-notes.css';

// A reason must be a real, multi-word cause — single-word answers ("busy",
// "work", "ops") are rejected so the record means something to an auditor.
const isValidReason = (text) => {
  const t = (text || '').trim();
  if (!t) return false;
  return t.split(/\s+/).filter(Boolean).length >= 2;
};

const BreachNotesModal = ({ isOpen, onClose, breachedDates, userId, currentUserId, tenantId }) => {
  const [notes, setNotes] = useState({});
  const [sharedReason, setSharedReason] = useState('');

  useEffect(() => {
    if (isOpen && breachedDates?.length > 0) {
      // Initialize notes with existing notes if available
      const initialNotes = {};
      breachedDates?.forEach(breach => {
        const existingNote = getBreachNoteForDate(userId, breach?.date);
        initialNotes[breach.date] = existingNote?.noteText || '';
      });
      setNotes(initialNotes);
      setSharedReason('');
    }
  }, [isOpen, breachedDates, userId]);

  const handleNoteChange = (date, value) => {
    setNotes(prev => ({ ...prev, [date]: value }));
  };

  // Apply the shared reason to every breached day. The same guard still applies
  // to each row, so a blanket one-word reason fails for all of them.
  const handleApplyAll = () => {
    const value = sharedReason;
    setNotes(() => {
      const next = {};
      breachedDates?.forEach(breach => { next[breach.date] = value; });
      return next;
    });
  };

  const validCount = breachedDates?.filter(breach => isValidReason(notes?.[breach?.date]))?.length || 0;
  const isAllValid = breachedDates?.length > 0 && validCount === breachedDates?.length;

  const handleSubmit = async () => {
    // Save all breach notes. localStorage stays as a mirror so the existing PDF
    // export + "needs note" gating keep working; the DB row is the record of truth.
    const dbWrites = [];
    breachedDates?.forEach(breach => {
      const noteText = notes?.[breach?.date]?.trim();
      if (noteText) {
        upsertBreachNote({
          userId,
          date: breach?.date,
          breachTypes: breach?.breachTypes,
          noteText,
          createdByUserId: currentUserId
        });
        if (tenantId) {
          dbWrites.push(
            upsertBreachReason({
              tenantId,
              subjectUserId: userId,
              date: breach?.date,
              breachTypes: breach?.breachTypes || [],
              note: noteText,
            }).catch(err => console.warn('[HOR] breach reason DB write failed:', err))
          );
        }
      }
    });
    await Promise.allSettled(dbWrites);
    onClose();
  };

  const handleBackdropClick = (e) => {
    // Prevent closing if there are breached dates without notes
    if (breachedDates?.length > 0) {
      e?.stopPropagation();
    }
  };

  if (!isOpen) return null;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const dd = String(d?.getDate()).padStart(2, '0');
    const mm = String(d?.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d?.getFullYear()}`;
  };

  const total = breachedDates?.length || 0;

  return (
    <ModalShell onClose={handleBackdropClick} panelClassName="bn-panel">
      <div className="bn">
        {/* Header */}
        <div className="bn-head">
          <div>
            <h2 className="bn-title">Breach notes required</h2>
            <p className="bn-sub">
              {total} {total === 1 ? 'day needs' : 'days need'} a reason before sign-off.
            </p>
          </div>
          {total === 0 && (
            <button onClick={onClose} className="bn-close" aria-label="Close">
              <Icon name="X" size={18} />
            </button>
          )}
        </div>

        {/* Apply a shared reason to every day */}
        <div className="bn-all">
          <label className="bn-label bn-all-label">
            Shared reason for all days
            <span className="bn-opt"> only when one genuine cause covers every day — e.g. a single charter</span>
          </label>
          <div className="bn-all-input">
            <input
              type="text"
              value={sharedReason}
              onChange={(e) => setSharedReason(e?.target?.value)}
              placeholder="Describe the specific operation, guests, or event…"
              className="bn-field"
            />
            <button
              type="button"
              className="bn-apply"
              onClick={handleApplyAll}
              disabled={!sharedReason?.trim()}
            >
              Apply to {total}
            </button>
          </div>
        </div>

        {/* Per-day rows */}
        <div className="bn-rowhead">
          <span className="bn-label">Date</span>
          <span className="bn-label">Rest</span>
          <span className="bn-label">Reason</span>
          <span />
        </div>
        <div className="bn-body">
          {breachedDates?.map((breach) => {
            const value = notes?.[breach?.date] || '';
            const filled = value.trim().length > 0;
            const valid = isValidReason(value);
            return (
              <div key={breach?.date} className="bn-row">
                <span className="bn-date">{formatDate(breach?.date)}</span>
                <span className="bn-rest">{Number(breach?.restHours || 0)?.toFixed(1)}h</span>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => handleNoteChange(breach?.date, e?.target?.value)}
                  placeholder="Add reason…"
                  className={`bn-field${filled && !valid ? ' is-bad' : ''}`}
                />
                <span className={`bn-tick${valid ? '' : ' is-empty'}`}>
                  <Icon name={valid ? 'Check' : 'Circle'} size={valid ? 16 : 13} />
                </span>
                {filled && !valid && (
                  <p className="bn-flag">Too vague — name the specific operation or event.</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bn-foot">
          <span className="bn-prog">{validCount} of {total} valid</span>
          <button type="button" className="bn-submit" onClick={handleSubmit} disabled={!isAllValid}>
            <Icon name="Check" size={16} />
            Submit notes
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export default BreachNotesModal;
