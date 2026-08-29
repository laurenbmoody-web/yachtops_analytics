import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';

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
      <button onClick={handleOpen} className="tj-addjob">
        <Icon name="Plus" size={14} />
        Add a job…
      </button>
    );
  }

  return (
    <div className="tj-quickadd">
      <div className="tj-quickadd-field">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e?.target?.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder="Job title…"
          className={`jm-input${error ? ' err' : ''}`}
        />
        {saving ? (
          <span className="tj-quickadd-end"><span className="jm-spin sm" /></span>
        ) : (
          <button onClick={handleClose} className="tj-quickadd-end clear" tabIndex={-1} title="Cancel">
            <Icon name="X" size={13} />
          </button>
        )}
      </div>
      {error && (
        <p className="jm-err">
          <Icon name="AlertCircle" size={11} />
          {error}
        </p>
      )}
      <p className="jm-hint">Enter to save · Esc to cancel</p>
    </div>
  );
};

export default QuickAddJobInput;
