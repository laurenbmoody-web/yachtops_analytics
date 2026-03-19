import React, { useState } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import Icon from '../../../components/AppIcon';
import ItemTile from './ItemTile';

const VirtualizedItemGrid = ({ items, onQuantityChange, searchQuery, onSearchChange, onAddItem }) => {
  // Calculate grid dimensions
  const getColumnCount = (width) => {
    if (width >= 1280) return 5; // lg
    if (width >= 1024) return 4; // md
    if (width >= 768) return 3;  // sm
    return 3; // mobile
  };

  const GAP = 16; // 1rem gap
  const TILE_SIZE = 280; // approximate tile height

  const Cell = ({ columnIndex, rowIndex, style, data }) => {
    const { items, columnCount, onQuantityChange } = data;
    const index = rowIndex * columnCount + columnIndex;
    
    if (index >= items?.length) return null;
    
    const item = items?.[index];
    
    return (
      <div style={{
        ...style,
        left: style?.left + GAP / 2,
        top: style?.top + GAP / 2,
        width: style?.width - GAP,
        height: style?.height - GAP,
      }}>
        <ItemTile
          item={item}
          onQuantityChange={onQuantityChange}
          selectionMode={false}
          isSelected={false}
          onToggleSelect={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          canEdit={false}
          onQuickView={() => {}}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Icon name="Search" size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>
      {items?.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-2xl">
          <Icon name="Package" size={48} className="mx-auto text-gray-400 mb-3" />
          <p className="text-gray-600">No items found</p>
        </div>
      ) : (
        <div style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
          <AutoSizer>
            {({ height, width }) => {
              const columnCount = getColumnCount(width);
              const columnWidth = width / columnCount;
              const rowCount = Math.ceil(items?.length / columnCount);
              
              return (
                <Grid
                  columnCount={columnCount}
                  columnWidth={columnWidth}
                  height={height}
                  rowCount={rowCount}
                  rowHeight={TILE_SIZE}
                  width={width}
                  itemData={{
                    items,
                    columnCount,
                    onQuantityChange
                  }}
                >
                  {Cell}
                </Grid>
              );
            }}
          </AutoSizer>
        </div>
      )}
    </div>
  );
};

export default VirtualizedItemGrid;