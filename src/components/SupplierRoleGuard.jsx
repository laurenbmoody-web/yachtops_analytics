import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSupplier } from '../contexts/SupplierContext';

const TIER_ORDER = { admin: 3, manager: 2, staff: 1 };

// Maps supplier_contacts.role → permission tier
export const getSupplierTier = (role) => {
  if (role === 'owner') return 'admin';
  if (role === 'sales' || role === 'accounts') return 'manager';
  return 'staff'; // logistics or unknown
};

const SupplierRoleGuard = ({ minTier = 'staff', children }) => {
  const { contact, loading } = useSupplier();
  if (loading) return null;
  const tier = getSupplierTier(contact?.role);
  if (TIER_ORDER[tier] < TIER_ORDER[minTier]) {
    return <Navigate to="/supplier/overview" replace />;
  }
  return children;
};

export default SupplierRoleGuard;
