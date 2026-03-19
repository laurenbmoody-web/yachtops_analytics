import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const FilterControls = ({ onFilterChange, activeFilters }) => {
  const [showFilters, setShowFilters] = useState(false);

  const statusFilters = [
    { value: 'all', label: 'All Status', icon: 'Ship' },
    { value: 'operational', label: 'Operational', icon: 'CheckCircle' },
    { value: 'warning', label: 'Warning', icon: 'AlertCircle' },
    { value: 'critical', label: 'Critical', icon: 'AlertTriangle' }
  ];

  const handleFilterToggle = (filterType, value) => {
    onFilterChange(filterType, value);
  };

  return (
    <div className="bg-card rounded-lg border border-border p-3 md:p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm md:text-base font-semibold text-foreground flex items-center gap-2">
          <Icon name="Filter" size={18} color="var(--color-primary)" />
          Filters
        </h3>
        <button
          className="lg:hidden p-2 hover:bg-muted rounded-lg transition-smooth"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Icon
            name={showFilters ? 'ChevronUp' : 'ChevronDown'}
            size={18}
            color="var(--color-foreground)"
          />
        </button>
      </div>
      <div className={`space-y-3 ${showFilters ? 'block' : 'hidden lg:block'}`}>
        <div>
          <label className="text-xs text-muted-foreground mb-2 block caption">
            Status Filter
          </label>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {statusFilters?.map((filter) => (
              <button
                key={filter?.value}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-smooth text-sm ${
                  activeFilters?.status === filter?.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:bg-muted'
                }`}
                onClick={() => handleFilterToggle('status', filter?.value)}
              >
                <Icon
                  name={filter?.icon}
                  size={16}
                  color={activeFilters?.status === filter?.value ? 'currentColor' : 'var(--color-foreground)'}
                />
                <span className="hidden sm:inline">{filter?.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground caption">
            {activeFilters?.status === 'all' ? 'Showing all yachts' : `Filtered by ${activeFilters?.status}`}
          </span>
          {activeFilters?.status !== 'all' && (
            <Button
              variant="ghost"
              size="sm"
              iconName="X"
              onClick={() => handleFilterToggle('status', 'all')}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilterControls;