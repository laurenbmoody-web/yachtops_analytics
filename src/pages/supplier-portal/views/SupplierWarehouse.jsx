// Standalone Warehouse page — the layout designer as its own full-width
// destination (under Catalogue in the nav), not buried in the Workspace
// settings two-column layout.

import React from 'react';
import { useSupplier } from '../../../contexts/SupplierContext';
import WarehouseDesigner from './WarehouseDesigner';

export default function SupplierWarehouse() {
  const { supplier } = useSupplier();
  if (!supplier?.id) return <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;
  return (
    <div className="sp-page">
      <WarehouseDesigner supplierId={supplier.id} />
    </div>
  );
}
