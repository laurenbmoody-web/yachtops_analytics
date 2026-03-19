// This file is no longer needed - vessel settings save logic has been moved directly into the component
// and now uses the public.vessels table instead of tenants table.
// Keeping this file as a placeholder to avoid import errors during transition.

export function saveVesselSettings() {
  throw new Error('saveVesselSettings has been removed - logic is now in the component');
}

export function patchTenantWithSelect() {
  throw new Error('patchTenantWithSelect has been removed - logic is now in the component');
}