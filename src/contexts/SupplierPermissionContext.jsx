import React, { createContext, useContext, useMemo } from 'react';
import { useSupplier } from './SupplierContext';

// ─────────────────────────────────────────────────────────────────────────────
// Source of truth: the Postgres function public.has_supplier_permission(text)
// defined in migration 20260425120000. RLS and RPCs enforce every gate on the
// server — this client map is UI-only, used to hide / disable buttons before
// the user tries an action that would fail with a 403. If this map drifts
// from the DB, the server still wins and the user gets a clear error.
//
// Keep this block in lock-step with the server matrix. Last synced with
// migration 20260425120000.
// ─────────────────────────────────────────────────────────────────────────────

const MEMBER_ACTIONS = [
  'orders:view',     'orders:confirm', 'orders:edit',
  'catalogue:view',  'catalogue:edit',
  'deliveries:view', 'deliveries:edit',
  'messages:view',   'messages:send',
  'clients:view',
  'aliases:view',
  'team:view',
  'settings:view',
];

const FINANCE_ACTIONS = [
  'orders:view',
  'invoices:view', 'invoices:edit',
  'deliveries:view',
  'clients:view',
  'aliases:view',
  'team:view',
  'settings:view',
];

// ADMIN = everything except these two
const ADMIN_EXCLUDES = new Set(['billing:manage', 'ownership:transfer']);

/**
 * Client-side mirror of has_supplier_permission. Server always wins — RLS
 * + RPC checks enforce the real matrix. Use this to gate UI only.
 */
export const hasClientPermission = (tier, action) => {
  if (!tier) return false;
  switch (tier) {
    case 'OWNER':
      return true;
    case 'ADMIN':
      return !ADMIN_EXCLUDES.has(action);
    case 'MEMBER':
      return MEMBER_ACTIONS.includes(action);
    case 'FINANCE':
      return FINANCE_ACTIONS.includes(action);
    case 'VIEWER':
      return typeof action === 'string' && action.endsWith(':view');
    default:
      return false;
  }
};

const SupplierPermissionContext = createContext(null);

export const SupplierPermissionProvider = ({ children }) => {
  const { contact, loading: supplierLoading } = useSupplier();

  const value = useMemo(() => {
    const tier = contact?.permission_tier ?? null;
    return {
      tier,
      loading: supplierLoading,
      check: (action) => hasClientPermission(tier, action),
    };
  }, [contact?.permission_tier, supplierLoading]);

  return (
    <SupplierPermissionContext.Provider value={value}>
      {children}
    </SupplierPermissionContext.Provider>
  );
};

const useSupplierPermissionCtx = () => {
  const ctx = useContext(SupplierPermissionContext);
  if (!ctx) throw new Error('usePermission/useTier must be used within SupplierPermissionProvider');
  return ctx;
};

export const usePermission = (action) => {
  const { check, loading } = useSupplierPermissionCtx();
  return { allowed: check(action), loading };
};

export const useTier = () => {
  const { tier, loading } = useSupplierPermissionCtx();
  return { tier, loading };
};
