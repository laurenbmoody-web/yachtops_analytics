import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { Department } from '../../../utils/authStorage';


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
    <div ref={containerRef} className="relative">
      {/* Input field with chips */}
      <div
        className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 cursor-text flex flex-wrap gap-2 items-center transition-smooth focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
        onClick={() => {
          setIsOpen(true);
          inputRef?.current?.focus();
        }}
      >
        {/* Selected assignees as chips */}
        {selectedCrew?.map(crew => (
          <div
            key={crew?.id}
            className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-2.5 py-1 rounded-md text-sm font-medium"
          >
            <span>{crew?.name || crew?.fullName}</span>
            <button
              type="button"
              onClick={(e) => {
                e?.stopPropagation();
                if (crew?.isSpecial) {
                  onChange([]);
                } else {
                  removeAssignee(crew?.id);
                }
              }}
              className="hover:bg-primary/20 rounded-full p-0.5 transition-smooth"
            >
              <Icon name="X" size={12} className="text-primary" />
            </button>
          </div>
        ))}

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e?.target?.value);
            setIsOpen(true);
            setFocusedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={selectedCrew?.length === 0 ? "Assign to…" : ""}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground"
        />

        {/* Dropdown indicator */}
        <Icon 
          name={isOpen ? "ChevronUp" : "ChevronDown"} 
          size={16} 
          className="text-muted-foreground flex-shrink-0" 
        />
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          <div ref={dropdownRef}>
            {dropdownOptions?.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                No users found
              </div>
            ) : (
              dropdownOptions?.map((option, idx) => {
                const isSelected = option?.isSpecial
                  ? crewMembers?.every(c => selectedAssignees?.includes(c?.id))
                  : selectedAssignees?.includes(option?.id);
                const isFocused = focusedIndex === idx;

                return (
                  <div
                    key={option?.id}
                    className={`px-3 py-2.5 cursor-pointer transition-smooth flex items-center justify-between gap-2 ${
                      isFocused ? 'bg-accent' : 'hover:bg-accent'
                    } ${
                      option?.isSpecial ? 'font-semibold border-b border-border' : ''
                    }`}
                    onClick={() => handleSelect(option)}
                    onMouseEnter={() => setFocusedIndex(idx)}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      {!option?.isSpecial && (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                          {(option?.name || option?.fullName)?.split(' ')?.map(n => n?.[0])?.join('')?.toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {option?.name || option?.fullName}
                        </div>
                        {!option?.isSpecial && option?.role && (
                          <div className="text-xs text-muted-foreground capitalize">{option?.role}</div>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <Icon name="Check" size={16} className="text-primary flex-shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableAssigneeDropdown;