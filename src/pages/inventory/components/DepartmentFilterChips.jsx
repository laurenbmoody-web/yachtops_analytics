import React from 'react';
import { getCurrentUser, hasCommandAccess } from '../../../utils/authStorage';

const DEPARTMENTS = [
  { value: 'ALL', label: 'All' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'GALLEY', label: 'Galley' },
  { value: 'DECK', label: 'Deck' },
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'MANAGEMENT', label: 'Management' }
];

const STORAGE_KEY = 'cargo_inventory_department_filter';

export const getDepartmentFilter = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || 'ALL';
  } catch (error) {
    console.error('Error reading department filter:', error);
    return 'ALL';
  }
};

export const setDepartmentFilter = (department) => {
  try {
    localStorage.setItem(STORAGE_KEY, department);
  } catch (error) {
    console.error('Error saving department filter:', error);
  }
};

export const filterItemsByDepartment = (items, departmentFilter, currentUser) => {
  if (!items) return [];
  
  const isCommand = hasCommandAccess(currentUser);
  
  // Command users with 'ALL' see everything
  if (isCommand && departmentFilter === 'ALL') {
    return items;
  }
  
  // Command users with specific department selected
  if (isCommand && departmentFilter !== 'ALL') {
    return items?.filter(item => {
      const itemDept = item?.usageDepartment?.toUpperCase();
      return itemDept === departmentFilter;
    });
  }
  
  // Non-Command users: filter to their own department only
  const userDept = currentUser?.department?.toUpperCase();
  return items?.filter(item => {
    const itemDept = item?.usageDepartment?.toUpperCase();
    return itemDept === userDept;
  });
};

const DepartmentFilterChips = ({ selectedDepartment, onDepartmentChange }) => {
  const currentUser = getCurrentUser();
  const isCommand = hasCommandAccess(currentUser);
  
  // Non-Command users see only their department
  const availableDepartments = isCommand 
    ? DEPARTMENTS 
    : DEPARTMENTS?.filter(dept => dept?.value === currentUser?.department?.toUpperCase() || dept?.value === 'ALL');

  const handleChipClick = (deptValue) => {
    setDepartmentFilter(deptValue);
    onDepartmentChange?.(deptValue);
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {availableDepartments?.map(dept => {
        const isSelected = selectedDepartment === dept?.value;
        return (
          <button
            key={dept?.value}
            onClick={() => handleChipClick(dept?.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              isSelected
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {dept?.label}
          </button>
        );
      })}
    </div>
  );
};

export default DepartmentFilterChips;