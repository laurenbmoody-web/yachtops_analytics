import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';

/**
 * Trello-style inline Quick Add Job input.
 * Props:
 *   boardId        - the board/list this input belongs to
 *   board          - full board object (for personal board detection)
 *   onAdd          - async fn(title, boardId) => void — called on Enter
 *   currentUserId  - auth user id
 *   isPersonalBoard - boolean: is this board personal to the current user?
 */
const QuickAddJobInput = ({ boardId, board, onAdd, currentUserId, isPersonalBoard }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef?.current) {
      inputRef?.current?.focus();
    }
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setError(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    setValue('');
    setError(null);
  };

  const handleKeyDown = async (e) => {
    if (e?.key === 'Escape') {
      handleClose();
      return;
    }
    if (e?.key === 'Enter') {
      e?.preventDefault();
      const trimmed = value?.trim();
      if (!trimmed) return;

      setSaving(true);
      setError(null);
      try {
        await onAdd(trimmed, boardId);
        // On success: clear input, keep focus for rapid entry
        setValue('');
        setError(null);
        if (inputRef?.current) inputRef?.current?.focus();
      } catch (err) {
        // On failure: revert optimistic UI is handled by parent; show inline error without losing text
        setError(err?.message || 'Failed to add job. Please try again.');
      } finally {
        setSaving(false);
      }
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="w-full flex items-center gap-2 py-2 px-1 text-sm text-muted-foreground hover:text-foreground transition-colors group"
      >
        <div className="w-5 h-5 rounded-full flex items-center justify-center group-hover:bg-muted transition-colors flex-shrink-0">
          <Icon name="Plus" size={13} />
        </div>
        <span>Add a job…</span>
      </button>
    );
  }

  return (
    <div className="mt-1">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e?.target?.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder="Job title… (Enter to save, Esc to cancel)"
          className={`w-full px-3 py-2 pr-8 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors ${
            error
              ? 'border-red-400 focus:ring-red-300' :'border-border'
          } ${
            saving ? 'opacity-60 cursor-not-allowed' : ''
          }`}
        />
        {saving && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <div className="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
          </div>
        )}
        {!saving && (
          <button
            onClick={handleClose}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            <Icon name="X" size={13} />
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
          <Icon name="AlertCircle" size={11} />
          {error}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground/60">Enter to save · Esc to cancel</p>
    </div>
  );
};

export default QuickAddJobInput;
