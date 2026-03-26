import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadAllLaundryItems, LaundryStatus } from '../../laundry-management-dashboard/utils/laundryStorage';
import AddLaundryModal from '../../laundry-management-dashboard/components/AddLaundryModal';

const LaundryLogWidget = () => {
  const navigate = useNavigate();
  const [laundryStats, setLaundryStats] = useState({
    itemsIn: 0,
    itemsOut: 0
  });
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    // Load real laundry data
    const items = loadAllLaundryItems();
    
    // Get today's date at midnight for comparison
    const today = new Date();
    today?.setHours(0, 0, 0, 0);
    const todayTime = today?.getTime();
    
    const tomorrow = new Date(today);
    tomorrow?.setDate(tomorrow?.getDate() + 1);
    const tomorrowTime = tomorrow?.getTime();
    
    // Count items IN (InProgress + ReadyToDeliver created today)
    const itemsIn = items?.filter(item => {
      if (item?.status !== LaundryStatus?.IN_PROGRESS && item?.status !== LaundryStatus?.READY_TO_DELIVER) {
        return false;
      }
      
      // Check if created today
      const createdDate = new Date(item?.createdAt);
      const createdTime = createdDate?.getTime();
      return createdTime >= todayTime && createdTime < tomorrowTime;
    })?.length || 0;
    
    // Count items OUT (Delivered today)
    const itemsOut = items?.filter(item => {
      if (item?.status !== LaundryStatus?.DELIVERED) {
        return false;
      }
      
      // Check if delivered today
      if (item?.deliveredAt) {
        const deliveredDate = new Date(item?.deliveredAt);
        const deliveredTime = deliveredDate?.getTime();
        return deliveredTime >= todayTime && deliveredTime < tomorrowTime;
      }
      
      return false;
    })?.length || 0;
    
    setLaundryStats({ itemsIn, itemsOut });
  }, []);

  const handleCenterClick = (e) => {
    e?.stopPropagation();
    // Open Quick Add Laundry modal
    setShowAddModal(true);
  };

  const handleItemsInClick = (e) => {
    e?.stopPropagation();
    navigate('/laundry-management-dashboard?filter=in');
  };

  const handleItemsOutClick = (e) => {
    e?.stopPropagation();
    navigate('/laundry-management-dashboard?filter=out');
  };

  const handleAddSuccess = () => {
    setShowAddModal(false);
    // Reload laundry stats after adding new item
    const items = loadAllLaundryItems();
    
    const today = new Date();
    today?.setHours(0, 0, 0, 0);
    const todayTime = today?.getTime();
    
    const tomorrow = new Date(today);
    tomorrow?.setDate(tomorrow?.getDate() + 1);
    const tomorrowTime = tomorrow?.getTime();
    
    const itemsIn = items?.filter(item => {
      if (item?.status !== LaundryStatus?.IN_PROGRESS && item?.status !== LaundryStatus?.READY_TO_DELIVER) {
        return false;
      }
      const createdDate = new Date(item?.createdAt);
      const createdTime = createdDate?.getTime();
      return createdTime >= todayTime && createdTime < tomorrowTime;
    })?.length || 0;
    
    const itemsOut = items?.filter(item => {
      if (item?.status !== LaundryStatus?.DELIVERED) {
        return false;
      }
      if (item?.deliveredAt) {
        const deliveredDate = new Date(item?.deliveredAt);
        const deliveredTime = deliveredDate?.getTime();
        return deliveredTime >= todayTime && deliveredTime < tomorrowTime;
      }
      return false;
    })?.length || 0;
    
    setLaundryStats({ itemsIn, itemsOut });
  };

  return (
    <>
      <div className="relative flex items-center justify-center py-10">
        {/* Pill-shaped widget with two-tone coloring */}
        <div className="relative flex items-stretch h-24 w-full max-w-2xl rounded-full overflow-hidden shadow-lg">
          {/* LEFT SECTION - Dark Navy with ITEMS IN */}
          <div 
            className="flex-1 bg-[#0B1F33] dark:bg-[#0B1F33] flex flex-col items-center justify-center cursor-pointer hover:opacity-90 transition-opacity px-8"
            onClick={handleItemsInClick}
          >
            <span className="text-[10px] text-white uppercase tracking-wider font-semibold mb-1">ITEMS IN</span>
            <span className="text-4xl font-bold text-white">{laundryStats?.itemsIn}</span>
          </div>

          {/* MIDDLE SECTION - Same dark navy as sides */}
          <div className="flex-1 bg-[#0B1F33] dark:bg-[#0B1F33]">
            {/* Empty middle section for visual separation */}
          </div>

          {/* RIGHT SECTION - Dark Navy with ITEMS OUT */}
          <div 
            className="flex-1 bg-[#0B1F33] dark:bg-[#0B1F33] flex flex-col items-center justify-center cursor-pointer hover:opacity-90 transition-opacity px-8"
            onClick={handleItemsOutClick}
          >
            <span className="text-[10px] text-white uppercase tracking-wider font-semibold mb-1">ITEMS OUT</span>
            <span className="text-4xl font-bold text-white">{laundryStats?.itemsOut}</span>
          </div>
        </div>

        {/* CENTER - Large Circular Button that overlaps widget significantly */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <button
            onClick={handleCenterClick}
            className="w-40 h-40 rounded-full bg-white dark:bg-[#0B1F33] flex items-center justify-center shadow-2xl hover:shadow-3xl transition-all hover:scale-105 border-4 border-white dark:border-[#0B1F33] ring-2 ring-gray-200 dark:ring-gray-700"
            aria-label="Quick Add Laundry"
          >
            <img 
              src="/assets/images/Items_20in-1770454556821.svg" 
              alt="Laundry basket icon" 
              className="w-24 h-24 object-contain"
            />
          </button>
        </div>
      </div>

      {/* Quick Add Laundry Modal */}
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