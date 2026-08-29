import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';


const SearchableAssigneeDropdown = ({ crewMembers, selectedAssignees, onChange, department }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const containerRef = useRef(null);

  // Filter crew members based on search query
  const filteredCrew = crewMembers?.filter(crew => {
    const query = searchQuery?.toLowerCase()?.trim();
    if (!query) return true;
    
    const firstName = crew?.name?.split(' ')?.[0]?.toLowerCase() || '';
    const lastName = crew?.name?.split(' ')?.[1]?.toLowerCase() || '';
    const role = crew?.role?.toLowerCase() || '';
    
    return firstName?.includes(query) || 
           lastName?.includes(query) || 
           role?.includes(query) ||
           crew?.name?.toLowerCase()?.includes(query);
  });

  // Add "All <Department>" option at the top (dynamic based on department)
  const allDepartmentOption = department ? {
    id: `all-${typeof department === 'string' ? department?.toLowerCase() : 'dept'}`,
    name: 'Assign to All',
    isSpecial: true
  } : null;

  const dropdownOptions = allDepartmentOption 
    ? [allDepartmentOption, ...filteredCrew]
    : filteredCrew;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef?.current && !containerRef?.current?.contains(event?.target)) {
        setIsOpen(false);
        setSearchQuery('');
        setFocusedIndex(-1);
      }
    };

    document?.addEventListener('mousedown', handleClickOutside);
    return () => document?.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen && (e?.key === 'ArrowDown' || e?.key === 'Enter')) {
      e?.preventDefault();
      setIsOpen(true);
      setFocusedIndex(0);
      return;
    }

    if (!isOpen) return;

    switch (e?.key) {
      case 'ArrowDown':
        e?.preventDefault();
        setFocusedIndex(prev => 
          prev < dropdownOptions?.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e?.preventDefault();
        setFocusedIndex(prev => prev > 0 ? prev - 1 : 0);
        break;
      case 'Enter':
        e?.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < dropdownOptions?.length) {
          handleSelect(dropdownOptions?.[focusedIndex]);
        }
        break;
      case 'Escape':
        e?.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        setFocusedIndex(-1);
        break;
      default:
        break;
    }
  };

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && dropdownRef?.current) {
      const focusedElement = dropdownRef?.current?.children?.[focusedIndex];
      if (focusedElement) {
        focusedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [focusedIndex]);

  const handleSelect = (option) => {
    if (option?.isSpecial) {
      // Toggle "All Interior" - select all or deselect all
      const allCrewIds = crewMembers?.map(c => c?.id);
      const allSelected = allCrewIds?.every(id => selectedAssignees?.includes(id));
      
      if (allSelected) {
        onChange([]);
      } else {
        onChange(allCrewIds);
      }
    } else {
      // Toggle individual crew member
      if (selectedAssignees?.includes(option?.id)) {
        onChange(selectedAssignees?.filter(id => id !== option?.id));
      } else {
        onChange([...selectedAssignees, option?.id]);
      }
    }
    
    // Keep dropdown open for multi-select
    setSearchQuery('');
    setFocusedIndex(-1);
    inputRef?.current?.focus();
  };

  const removeAssignee = (crewId) => {
    onChange(selectedAssignees?.filter(id => id !== crewId));
  };

  const getSelectedCrewMembers = () => {
    const allCrewIds = crewMembers?.map(c => c?.id);
    const allSelected = allCrewIds?.every(id => selectedAssignees?.includes(id));
    
    if (allSelected && selectedAssignees?.length > 0 && allDepartmentOption) {
      return [allDepartmentOption];
    }
    
    return crewMembers?.filter(crew => selectedAssignees?.includes(crew?.id));
  };

  const selectedCrew = getSelectedCrewMembers();

  return (
    <div ref={containerRef} className="jm-combo">
      {/* Control: selected people as chips + a type-ahead input */}
      <div
        className={`jm-combo-control multi${isOpen ? ' open' : ''}`}
        onClick={() => { setIsOpen(true); inputRef?.current?.focus(); }}
      >
        <span className="jm-combo-chips">
          {selectedCrew?.map(crew => (
            <span key={crew?.id} className="jm-tag accent">
              {crew?.name || crew?.fullName}
              <span
                role="button"
                tabIndex={-1}
                title="Remove"
                onClick={(e) => {
                  e?.stopPropagation();
                  if (crew?.isSpecial) onChange([]);
                  else removeAssignee(crew?.id);
                }}
                style={{ display: 'flex', cursor: 'pointer' }}
              >
                <Icon name="X" size={10} />
              </span>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e?.target?.value); setIsOpen(true); setFocusedIndex(0); }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(true)}
            placeholder={selectedCrew?.length === 0 ? 'Assign to…' : ''}
            className="jm-combo-input"
          />
        </span>
        <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </div>

      {isOpen && (
        <div className="jm-combo-menu" ref={dropdownRef}>
          {dropdownOptions?.length === 0 ? (
            <p className="jm-combo-empty">No crew match that search</p>
          ) : (
            dropdownOptions?.map((option, idx) => {
              const isSelected = option?.isSpecial
                ? crewMembers?.every(c => selectedAssignees?.includes(c?.id))
                : selectedAssignees?.includes(option?.id);
              const isFocused = focusedIndex === idx;
              return (
                <button
                  type="button"
                  key={option?.id}
                  className={`jm-option${isSelected ? ' on' : ''}${isFocused ? ' focused' : ''}${option?.isSpecial ? ' special' : ''}`}
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => setFocusedIndex(idx)}
                >
                  {!option?.isSpecial && (
                    <span className="jm-avatar">
                      {(option?.name || option?.fullName)?.split(' ')?.map(n => n?.[0])?.join('')?.toUpperCase()}
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {option?.name || option?.fullName}
                    {!option?.isSpecial && option?.role && (
                      <span className="jm-combo-desc">{option?.role}</span>
                    )}
                  </span>
                  {isSelected && <Icon name="Check" size={14} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default SearchableAssigneeDropdown;
