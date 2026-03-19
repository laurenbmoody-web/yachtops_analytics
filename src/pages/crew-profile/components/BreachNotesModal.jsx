import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { BREACH_TYPE_LABELS, QUICK_TAGS, upsertBreachNote, getBreachNoteForDate } from '../utils/horBreachNotesStorage';

const BreachNotesModal = ({ isOpen, onClose, breachedDates, userId, currentUserId }) => {
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

  const handleSubmit = () => {
    // Save all breach notes
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
      }
    });

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
    const date = new Date(dateStr);
    return date?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        onClick={handleBackdropClick}
      >
        {/* Modal */}
        <div 
          className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Breach Notes Required</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Some days are non-compliant. Please add a short reason for each breached day.
              </p>
            </div>
            {breachedDates?.length === 0 && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
              >
                <Icon name="X" size={20} className="text-foreground" />
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {breachedDates?.map((breach, index) => (
              <div 
                key={breach?.date}
                className="bg-card border border-border rounded-xl p-5 space-y-4"
              >
                {/* Date and Breach Types */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {formatDate(breach?.date)}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Rest: {breach?.restHours?.toFixed(1)}h
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {breach?.breachTypes?.map(type => (
                      <span
                        key={type}
                        className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      >
                        {BREACH_TYPE_LABELS?.[type]}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Quick Tags */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Quick Tags (optional)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_TAGS?.map(tag => (
                      <button
                        key={tag?.id}
                        onClick={() => handleQuickTag(breach?.date, tag)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                          selectedTags?.[breach?.date] === tag?.id
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground hover:bg-muted/80'
                        }`}
                      >
                        {tag?.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Note Text Area */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Reason / Notes <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={notes?.[breach?.date] || ''}
                    onChange={(e) => handleNoteChange(breach?.date, e?.target?.value)}
                    placeholder="Enter reason for breach..."
                    rows={3}
                    className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                  />
                </div>

                {/* Explanation */}
                {breach?.explanation && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">
                      <Icon name="AlertCircle" size={12} className="inline mr-1" />
                      {breach?.explanation}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!isAllNotesComplete()}
            >
              Submit Notes
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default BreachNotesModal;