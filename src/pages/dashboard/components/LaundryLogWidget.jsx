import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadAllLaundryItems, LaundryStatus } from '../../laundry-management-dashboard/utils/laundryStorage';
import AddLaundryModal from '../../laundry-management-dashboard/components/AddLaundryModal';

// Items IN = the current load (all outstanding + ready to deliver, any day).
// Items OUT = delivered today only.
const computeStats = (items) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowTime = tomorrow.getTime();

  const itemsIn = (items || []).filter((item) =>
    item?.status === LaundryStatus?.IN_PROGRESS || item?.status === LaundryStatus?.READY_TO_DELIVER
  ).length;

  const itemsOut = (items || []).filter((item) => {
    if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) return false;
    const t = new Date(item?.deliveredAt).getTime();
    return t >= todayTime && t < tomorrowTime;
  }).length;

  return { itemsIn, itemsOut };
};

const LaundryLogWidget = () => {
  const navigate = useNavigate();
  const [laundryStats, setLaundryStats] = useState({ itemsIn: 0, itemsOut: 0 });
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    const items = await loadAllLaundryItems();
    setLaundryStats(computeStats(items));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await loadAllLaundryItems();
      if (!cancelled) setLaundryStats(computeStats(items));
    })();
    return () => { cancelled = true; };
  }, []);

  // Refresh when the crew returns to the tab (an item may have moved through the
  // laundry flow elsewhere).
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const handleCenterClick = (e) => { e?.stopPropagation(); setShowAddModal(true); };
  const handleItemsInClick = (e) => { e?.stopPropagation(); navigate('/laundry-management-dashboard?filter=in'); };
  const handleItemsOutClick = (e) => { e?.stopPropagation(); navigate('/laundry-management-dashboard?filter=out'); };
  const handleAddSuccess = async () => { setShowAddModal(false); await load(); };

  return (
    <>
      <div className="relative flex items-center justify-center py-10">
        {/* Pill-shaped widget — uniform dark navy; the count turns terracotta on hover. */}
        <div className="relative flex items-stretch h-24 w-full max-w-2xl rounded-full overflow-hidden shadow-lg">
          {/* LEFT — ITEMS IN */}
          <button
            type="button"
            className="group flex-1 bg-[#0B1F33] flex flex-col items-center justify-center cursor-pointer px-8 border-0"
            onClick={handleItemsInClick}
            aria-label="View items in"
          >
            <span className="text-[10px] text-white uppercase tracking-wider font-semibold mb-1">ITEMS IN</span>
            <span className="text-4xl font-bold text-white transition-colors group-hover:text-[#C65A1A]">{laundryStats?.itemsIn}</span>
          </button>

          {/* MIDDLE — spacer behind the circle */}
          <div className="flex-1 bg-[#0B1F33]" aria-hidden="true" />

          {/* RIGHT — ITEMS OUT */}
          <button
            type="button"
            className="group flex-1 bg-[#0B1F33] flex flex-col items-center justify-center cursor-pointer px-8 border-0"
            onClick={handleItemsOutClick}
            aria-label="View items out"
          >
            <span className="text-[10px] text-white uppercase tracking-wider font-semibold mb-1">ITEMS OUT</span>
            <span className="text-4xl font-bold text-white transition-colors group-hover:text-[#C65A1A]">{laundryStats?.itemsOut}</span>
          </button>
        </div>

        {/* CENTER — quick-add circle; a thin terracotta hairline appears on hover. */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <button
            onClick={handleCenterClick}
            className="w-40 h-40 rounded-full bg-white dark:bg-[#0B1F33] flex items-center justify-center shadow-2xl hover:shadow-3xl transition-all hover:scale-105 border-4 border-white dark:border-[#0B1F33] ring-2 ring-gray-200 dark:ring-gray-700 hover:ring-[#C65A1A]"
            aria-label="Quick add laundry"
          >
            <img
              src="/assets/images/Items_20in-1770454556821.svg"
              alt="Laundry basket"
              className="w-24 h-24 object-contain"
            />
          </button>
        </div>
      </div>

      {showAddModal && (
        <AddLaundryModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleAddSuccess}
        />
      )}
    </>
  );
};

export default LaundryLogWidget;
