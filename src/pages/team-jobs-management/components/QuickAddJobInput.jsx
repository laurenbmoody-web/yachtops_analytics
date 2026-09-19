import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';

/**
 * Type a title, press Enter, it is on the list.
 *
 * Always a live field rather than a button that reveals one: the To Do move is
 * that adding costs a keystroke, not a click then a keystroke, and the row
 * sitting there ready is half of what makes a list feel quick to keep.
 *
 * Enter saves and keeps focus so several can go in one after another. The text
 * survives a failure — losing what someone just typed because the network
 * blipped is worse than the failure itself.
 *
 * Props:
 *   target  - { boardId?, departmentId?, assignToMe? } — what the column this
 *             input sits in means, passed straight back to onAdd
 *   onAdd   - async fn(title, target) — called on Enter
 *   placeholder - overrides the default, so a column can say where it lands
 */
const QuickAddJobInput = ({ target = {}, onAdd, placeholder = 'Add a job…' }) => {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  // Deliberately never disables the field. A disabled input loses focus, and
  // focus is the whole point of the row: you type, press Enter, and type the
  // next one. Double submits are guarded on `saving` instead.
  const submit = async () => {
    const trimmed = value?.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed, target);
      setValue('');
      setError(null);
    } catch (err) {
      setError(err?.message || 'That did not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e?.key === 'Escape') { setValue(''); setError(null); inputRef?.current?.blur(); return; }
    if (e?.key === 'Enter') { e?.preventDefault(); submit(); }
  };

  return (
    <div className="tj-quickadd">
      <div className={`tj-quickadd-row${focused ? ' on' : ''}${error ? ' err' : ''}`}>
        <span className="tj-quickadd-ico">
          {saving ? <span className="jm-spin sm" /> : <Icon name="Plus" size={14} />}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e?.target?.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="tj-quickadd-input"
          aria-label={placeholder}
        />
        {value?.trim() && !saving && (
          <button type="button" className="tj-quickadd-go" onClick={submit} title="Add">
            <Icon name="CornerDownLeft" size={13} />
          </button>
        )}
      </div>
      {error && (
        <p className="jm-err">
          <Icon name="AlertCircle" size={11} />
          {error}
        </p>
      )}
    </div>
  );
};

export default QuickAddJobInput;
