import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';

const LocationStepperSheet = ({ item, onClose, onUpdate }) => {
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    // Initialize with current stockLocations from item
    if (item?.stockLocations && item?.stockLocations?.length > 0) {
      setLocations(item?.stockLocations?.map(loc => ({
        locationId: loc?.locationId,
        locationName: loc?.locationName,
        qty: loc?.qty || 0
      })));
    } else {
      // No locations set - show empty state
      setLocations([]);
    }
  }, [item]);

  const totalQuantity = locations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0);

  const handleIncrement = (index) => {
    const updated = [...locations];
    updated[index] = { ...updated?.[index], qty: (updated?.[index]?.qty || 0) + 1 };
    setLocations(updated);
    // Save instantly
    onUpdate?.(updated);
  };

  const handleDecrement = (index) => {
    const updated = [...locations];
    updated[index] = { ...updated?.[index], qty: Math.max(0, (updated?.[index]?.qty || 0) - 1) };
    setLocations(updated);
    // Save instantly
    onUpdate?.(updated);
  };

  const handleQuantityChange = (index, value) => {
    // Parse and validate input
    const numValue = parseInt(value, 10);
    
    // If empty or invalid, set to 0
    const newQty = isNaN(numValue) || numValue < 0 ? 0 : numValue;
    
    const updated = [...locations];
    updated[index] = { ...updated?.[index], qty: newQty };
    setLocations(updated);
    // Save instantly
    onUpdate?.(updated);
  };

  const handleInputBlur = (index, e) => {
    // On blur, if empty, default to 0
    if (e?.target?.value === '' || e?.target?.value === null) {
      handleQuantityChange(index, '0');
    }
  };

  const handleInputKeyDown = (index, e) => {
    // Save on Enter key
    if (e?.key === 'Enter') {
      e?.target?.blur();
    }
  };

  const handleBackdropClick = (e) => {
    // Prevent closing when clicking backdrop - user must use Done button
    e?.stopPropagation();
  };

  return (
    <>
      {/* Backdrop - clicking does NOT close */}
      <div
        className="fixed inset-0 bg-black/30 z-50 transition-opacity"
        onClick={handleBackdropClick}
      />

      {/* Bottom Sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-50 max-h-[80vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Adjust stock by location</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <Icon name="X" size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Location List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {locations?.length === 0 ? (
            <div className="py-8 text-center">
              <Icon name="MapPin" size={48} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-600 mb-2">No locations set for this item.</p>
              <p className="text-xs text-gray-500">Edit item to add locations.</p>
            </div>
          ) : (
            locations?.map((location, index) => (
              <div key={location?.locationId || index} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <span className="text-sm font-medium text-gray-900">{location?.locationName || `Location ${index + 1}`}</span>
                <div className="flex items-center bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => handleDecrement(index)}
                    className="w-10 h-9 flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors"
                    aria-label="Decrease"
                  >
                    <Icon name="Minus" size={16} />
                  </button>
                  <div className="w-14 text-center">
                    <input
                      type="number"
                      value={location?.qty || 0}
                      onChange={(e) => handleQuantityChange(index, e?.target?.value)}
                      onBlur={(e) => handleInputBlur(index, e)}
                      onKeyDown={(e) => handleInputKeyDown(index, e)}
                      className="w-full text-sm font-semibold text-gray-900 text-center bg-transparent border-0 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      min="0"
                      aria-label={`Quantity for ${location?.locationName}`}
                    />
                  </div>
                  <button
                    onClick={() => handleIncrement(index)}
                    className="w-10 h-9 flex items-center justify-center text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors"
                    aria-label="Increase"
                  >
                    <Icon name="Plus" size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer: Total + Done Button */}
        {locations?.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Total onboard:</span>
              <span className="text-lg font-bold text-gray-900">{totalQuantity}</span>
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  );
};

export default LocationStepperSheet;