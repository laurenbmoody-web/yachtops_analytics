import React, { useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const SelectionContextMenu = ({
  type,
  index,
  x,
  y,
  currentMapping,
  onColumnMapping,
  onRowMapping,
  onClose
}) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef?.current && !menuRef?.current?.contains(event?.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const columnOptions = [
    { value: 'itemName', label: 'This is Item Name', icon: 'Package', required: true },
    { value: 'category', label: 'This is Category', icon: 'Tag' },
    { value: 'location', label: 'This column is a Location', icon: 'MapPin' },
    { value: 'quantity', label: 'This is Quantity', icon: 'Hash' },
    { value: 'unit', label: 'This is Unit of Measure', icon: 'Ruler' },
    { value: 'notes', label: 'This is Notes', icon: 'FileText' },
    { value: 'ignore', label: 'Ignore this column', icon: 'X', variant: 'muted' }
  ];

  const rowOptions = [
    { value: 'category', label: 'This row defines a category', icon: 'Tag' },
    { value: 'remove', label: 'Remove selection', icon: 'X', variant: 'muted' }
  ];

  const options = type === 'column' ? columnOptions : rowOptions;

  const handleOptionClick = (value) => {
    if (type === 'column') {
      onColumnMapping(index, value === 'ignore' ? null : value);
    } else {
      onRowMapping(index, value === 'remove' ? null : value);
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-border rounded-lg shadow-lg py-1 min-w-[240px]"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="px-3 py-2 border-b border-border">
        <p className="text-xs font-medium text-muted-foreground">
          {type === 'column' ? `Column ${index + 1}` : `Row ${index + 1}`}
        </p>
      </div>
      
      {options?.map((option) => {
        const isSelected = currentMapping === option?.value;
        
        return (
          <button
            key={option?.value}
            onClick={() => handleOptionClick(option?.value)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
              "hover:bg-accent",
              isSelected && "bg-primary/10 text-primary font-medium",
              option?.variant === 'muted' && "text-muted-foreground"
            )}
          >
            <Icon 
              name={option?.icon} 
              size={16} 
              className={cn(
                isSelected ? "text-primary" : "text-muted-foreground"
              )} 
            />
            <span className="flex-1">{option?.label}</span>
            {option?.required && (
              <span className="text-xs text-error">*</span>
            )}
            {isSelected && (
              <Icon name="Check" size={14} className="text-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default SelectionContextMenu;