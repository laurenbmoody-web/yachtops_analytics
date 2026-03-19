import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';

const TimeRangeSelector = ({ selectedRange, onRangeChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const timeRanges = [
    { value: '1h', label: 'Last Hour', minutes: 60 },
    { value: '6h', label: 'Last 6 Hours', minutes: 360 },
    { value: '12h', label: 'Last 12 Hours', minutes: 720 },
    { value: '24h', label: 'Last 24 Hours', minutes: 1440 },
    { value: '7d', label: 'Last 7 Days', minutes: 10080 },
    { value: '30d', label: 'Last 30 Days', minutes: 43200 }
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

  const handleRangeSelect = (range) => {
    onRangeChange(range);
    setIsOpen(false);
  };

  const getCurrentLabel = () => {
    const current = timeRanges?.find(r => r?.value === selectedRange);
    return current ? current?.label : 'Select Range';
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="flex items-center gap-2 px-4 py-2 bg-card rounded-lg border border-border hover:bg-muted transition-smooth"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Icon name="Clock" size={18} color="var(--color-foreground)" />
        <span className="text-sm font-medium text-foreground hidden sm:inline">
          {getCurrentLabel()}
        </span>
        <Icon
          name={isOpen ? 'ChevronUp' : 'ChevronDown'}
          size={16}
          color="var(--color-muted-foreground)"
        />
      </button>
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-card rounded-lg shadow-elevation-lg border border-border overflow-hidden z-50">
          {timeRanges?.map((range) => (
            <button
              key={range?.value}
              className={`w-full text-left px-4 py-3 hover:bg-muted transition-smooth ${
                selectedRange === range?.value ? 'bg-primary/10 text-primary' : 'text-foreground'
              }`}
              onClick={() => handleRangeSelect(range?.value)}
            >
              <div className="text-sm font-medium">{range?.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TimeRangeSelector;