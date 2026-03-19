import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';

const AutoRefreshControl = ({ selectedInterval, onIntervalChange, isRefreshing }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const refreshIntervals = [
    { value: 'off', label: 'Off', seconds: 0 },
    { value: '5m', label: '5 Minutes', seconds: 300 },
    { value: '10m', label: '10 Minutes', seconds: 600 },
    { value: '15m', label: '15 Minutes', seconds: 900 }
  ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef?.current && !dropdownRef?.current?.contains(event?.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleIntervalSelect = (interval) => {
    onIntervalChange(interval);
    setIsOpen(false);
  };

  const getCurrentLabel = () => {
    const current = refreshIntervals?.find(i => i?.value === selectedInterval);
    return current ? current?.label : 'Off';
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="flex items-center gap-2 px-4 py-2 bg-card rounded-lg border border-border hover:bg-muted transition-smooth"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Icon
          name="RefreshCw"
          size={18}
          color="var(--color-foreground)"
          className={isRefreshing ? 'animate-spin' : ''}
        />
        <span className="text-sm font-medium text-foreground hidden sm:inline">
          Auto: {getCurrentLabel()}
        </span>
        <Icon
          name={isOpen ? 'ChevronUp' : 'ChevronDown'}
          size={16}
          color="var(--color-muted-foreground)"
        />
      </button>
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-44 bg-card rounded-lg shadow-elevation-lg border border-border overflow-hidden z-50">
          {refreshIntervals?.map((interval) => (
            <button
              key={interval?.value}
              className={`w-full text-left px-4 py-3 hover:bg-muted transition-smooth ${
                selectedInterval === interval?.value ? 'bg-primary/10 text-primary' : 'text-foreground'
              }`}
              onClick={() => handleIntervalSelect(interval?.value)}
            >
              <div className="text-sm font-medium">{interval?.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AutoRefreshControl;