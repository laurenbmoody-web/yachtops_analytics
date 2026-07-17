// The defect drawer for a `defect`-layer map pin. Links the pin (scan_hotspots)
// to a public.defects row (defects.hotspot_id): empty → the shared "log a defect"
// form here; linked → the shared two-column DefectDetail.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDefectActor } from '../../defects/utils/useDefectActor';
import { getDefectByHotspot, getDefectById, createDefect } from '../../defects/utils/defectsStorage';
import DefectDetail from '../../defects/components/DefectDetail';
import DefectLogForm from '../../defects/components/DefectLogForm';
import './DefectPin.css';

export default function DefectPin({ hotspot, scanName, containerTrail, onChanged, onTitled, onCancel, onMode }) {
  const actor = useDefectActor();
  const [loading, setLoading] = useState(true);
  const [defect, setDefect] = useState(null);

  // Tell the host modal which layout to size to: the narrow single-column log
  // form, or the wide two-column detail. Defaults to the form width while
  // loading so the log-a-defect flow never flashes wide.
  useEffect(() => {
    if (loading) return;
    onMode?.(defect ? 'detail' : 'form');
  }, [loading, defect, onMode]);

  const locationLabel = useMemo(() => {
    const trail = (containerTrail || []).map((c) => c?.name || c).filter(Boolean);
    return [scanName, ...trail, hotspot?.label].filter(Boolean).join(' · ');
  }, [scanName, containerTrail, hotspot?.label]);

  const loadForPin = useCallback(async () => {
    if (!hotspot?.id || !actor?.tenantId) { setLoading(false); return; }
    setLoading(true);
    setDefect(await getDefectByHotspot(hotspot.id, actor));
    setLoading(false);
  }, [hotspot?.id, actor?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadForPin(); }, [loadForPin]);

  const refetchById = async (id) => { setDefect(await getDefectById(id, actor)); onChanged?.(); };

  const handleLogSubmit = async (base) => {
    const created = await createDefect({
      ...base,
      hotspotId: hotspot.id,
      locationNodeId: hotspot.location_node_id || null,
      locationPathLabel: locationLabel,
    }, actor);
    if (created) { setDefect(created); onTitled?.(created.title); onChanged?.(); }
  };

  if (loading) return <div className="vmd-formwrap"><p className="vmd-loading">Loading defect…</p></div>;

  if (defect) return <DefectDetail defect={defect} onChanged={() => refetchById(defect.id)} locationLabel={locationLabel} />;

  return (
    <div className="vmd-formwrap">
      <div className="vmd-form-head">
        <p className="vmd-modal-eyebrow">New defect{scanName ? ` · ${scanName}` : ''}</p>
        <h3 className="vmd-form-title">Log a defect</h3>
      </div>
      <DefectLogForm onSubmit={handleLogSubmit} onCancel={onCancel} />
    </div>
  );
}
