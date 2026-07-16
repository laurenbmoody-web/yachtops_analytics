// Defects-page defect view. Thin wrapper around the shared DefectDetail
// (Direction B) that adds a "View on map" deep link so, from the list, you can
// jump straight to exactly where the defect is on the vessel.
import React, { useCallback, useEffect, useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import { useDefectActor } from '../utils/useDefectActor';
import { getDefectById, getHotspotScanId } from '../utils/defectsStorage';
import DefectDetail from './DefectDetail';

const ViewDefectModal = ({ defectId, onClose, onUpdate }) => {
  const actor = useDefectActor();
  const [defect, setDefect] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mapHref, setMapHref] = useState(null);

  const reload = useCallback(async () => {
    const d = await getDefectById(defectId, actor);
    setDefect(d);
    setLoading(false);
    if (d?.hotspotId) {
      const scanId = await getHotspotScanId(d.hotspotId);
      setMapHref(scanId ? `/vessel/map?scan=${scanId}&pin=${d.hotspotId}` : `/vessel/map?pin=${d.hotspotId}`);
    } else {
      setMapHref(null);
    }
  }, [defectId, actor]);

  useEffect(() => { setLoading(true); reload(); }, [reload]);

  return (
    <ModalShell onClose={onClose} panelClassName="dd-modal">
      {loading ? (
        <div style={{ padding: 44, textAlign: 'center', color: '#8B8478', fontSize: 13 }}>Loading defect…</div>
      ) : !defect ? (
        <div style={{ padding: 44, textAlign: 'center', color: '#1C1B3A', fontSize: 13 }}>Defect not found.</div>
      ) : (
        <DefectDetail
          defect={defect}
          mapHref={mapHref}
          onClose={onClose}
          onChanged={async () => { await reload(); onUpdate?.(); }}
        />
      )}
    </ModalShell>
  );
};

export default ViewDefectModal;
