import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { BREACH_TYPE_LABELS, QUICK_TAGS, upsertBreachNote, getBreachNoteForDate } from '../utils/horBreachNotesStorage';
import { upsertBreachReason } from '../utils/horBreachReasons';

import ModalShell from '../../../components/ui/ModalShell';
import './breach-notes.css';
const BreachNotesModal = ({ isOpen, onClose, breachedDates, userId, currentUserId, tenantId }) => {
  const [notes, setNotes] = useState({});
  const [selectedTags, setSelectedTags] = useState({});

  useEffect(() => {
    if (isOpen && breachedDates?.length > 0) {
      // Initialize notes with existing notes if available
      const initialNotes = {};
      breachedDates?.forEach(breach => {
        const existingNote = getBreachNoteForDate(userId, breach?.date);
        initialNotes[breach.date] = existingNote?.noteText || '';
      });
      setNotes(initialNotes);
      setSelectedTags({});
    }
  }, [isOpen, breachedDates, userId]);

  const handleNoteChange = (date, value) => {
    setNotes(prev => ({
      ...prev,
      [date]: value
    }));
  };

  const handleQuickTag = (date, tag) => {
    const currentNote = notes?.[date] || '';
    const tagPrefix = tag?.prefix;
    
    // Toggle tag selection
    const isSelected = selectedTags?.[date] === tag?.id;
    
    if (isSelected) {
      // Remove tag prefix if it exists at the start
      const newNote = currentNote?.startsWith(tagPrefix) 
        ? currentNote?.substring(tagPrefix?.length)
        : currentNote;
      setNotes(prev => ({ ...prev, [date]: newNote }));
      setSelectedTags(prev => ({ ...prev, [date]: null }));
    } else {
      // Add tag prefix
      const newNote = tagPrefix + currentNote?.replace(/^[^:]+:\s*/, '');
      setNotes(prev => ({ ...prev, [date]: newNote }));
      setSelectedTags(prev => ({ ...prev, [date]: tag?.id }));
    }
  };

  const isAllNotesComplete = () => {
    return breachedDates?.every(breach => {
      const note = notes?.[breach?.date]?.trim();
      return note && note?.length > 0;
    });
  };

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

  return (
    <ModalShell onClose={handleBackdropClick} panelClassName="bn-panel">
      <div className="bn">
        {/* Header */}
        <div className="bn-head">
          <div>
            <h2 className="bn-title">Breach notes required</h2>
            <p className="bn-sub">
              Some days are non-compliant. Add a short reason for each breached day.
            </p>
          </div>
          {breachedDates?.length === 0 && (
            <button onClick={onClose} className="bn-close" aria-label="Close">
              <Icon name="X" size={18} />
            </button>
          )}
        </div>

        {/* Days */}
        <div className="bn-body">
          {breachedDates?.map((breach) => (
            <div key={breach?.date} className="bn-day">
              <div className="bn-day-head">
                <span className="bn-date">{formatDate(breach?.date)}</span>
                <span className="bn-rest">Rest {Number(breach?.restHours || 0)?.toFixed(1)}h</span>
                {breach?.breachTypes?.length > 0 && (
                  <span className="bn-types">
                    {breach?.breachTypes?.map((type) => (
                      <span key={type} className="bn-typepill">{BREACH_TYPE_LABELS?.[type] || type}</span>
                    ))}
                  </span>
                )}
              </div>

              {/* Quick-tag pills */}
              <label className="bn-label">Quick tags <span className="bn-opt">optional</span></label>
              <div className="bn-tags">
                {QUICK_TAGS?.map((tag) => (
                  <button
                    key={tag?.id}
                    type="button"
                    onClick={() => handleQuickTag(breach?.date, tag)}
                    className={`bn-pill${selectedTags?.[breach?.date] === tag?.id ? ' is-sel' : ''}`}
                  >
                    {tag?.label}
                  </button>
                ))}
              </div>

              {/* Reason */}
              <label className="bn-label">Reason <span className="bn-req">required</span></label>
              <textarea
                value={notes?.[breach?.date] || ''}
                onChange={(e) => handleNoteChange(breach?.date, e?.target?.value)}
                placeholder="e.g. Night watch during guest departure…"
                rows={3}
                className="bn-textarea"
              />

              {breach?.explanation && (
                <p className="bn-expl">
                  <Icon name="AlertCircle" size={12} />
                  {breach?.explanation}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bn-foot">
          <button type="button" className="bn-submit" onClick={handleSubmit} disabled={!isAllNotesComplete()}>
            <Icon name="Check" size={16} />
            Submit notes
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export default BreachNotesModal;