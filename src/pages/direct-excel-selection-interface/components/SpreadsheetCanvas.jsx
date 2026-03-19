import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const SpreadsheetCanvas = ({
  headers,
  data,
  selectedColumns,
  selectedRows,
  columnMappings,
  rowMappings,
  onColumnClick,
  onRowClick
}) => {
  const getMappingLabel = (mapping) => {
    const labels = {
      itemName: 'Item Name',
      category: 'Category',
      location: 'Location',
      quantity: 'Quantity',
      notes: 'Notes',
      unit: 'Unit'
    };
    return labels?.[mapping] || mapping;
  };

  const getMappingColor = (mapping) => {
    const colors = {
      itemName: 'bg-primary/20 text-primary border-primary',
      category: 'bg-secondary/20 text-secondary border-secondary',
      location: 'bg-success/20 text-success border-success',
      quantity: 'bg-warning/20 text-warning border-warning',
      notes: 'bg-muted text-muted-foreground border-border',
      unit: 'bg-purple-100 text-purple-700 border-purple-300'
    };
    return colors?.[mapping] || 'bg-muted text-muted-foreground border-border';
  };

  const isColumnSelected = (colIndex) => selectedColumns?.includes(colIndex);
  const isRowSelected = (rowIndex) => selectedRows?.includes(rowIndex);

  // Show first 20 rows for preview
  const displayData = data?.slice(0, 20);

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {/* Row number header */}
                <th className="sticky left-0 z-20 bg-muted border-b border-r border-border p-2 text-xs font-medium text-muted-foreground w-12">
                  #
                </th>
                
                {/* Column headers */}
                {headers?.map((header, colIndex) => {
                  const isSelected = isColumnSelected(colIndex);
                  const mapping = columnMappings?.[colIndex];
                  
                  return (
                    <th
                      key={colIndex}
                      onClick={(e) => onColumnClick(colIndex, e)}
                      className={cn(
                        "relative border-b border-r border-border p-3 text-left cursor-pointer transition-all",
                        "hover:bg-primary/5",
                        isSelected && "bg-primary/10 border-primary"
                      )}
                    >
                      <div className="flex flex-col gap-2 min-w-[120px]">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {header}
                          </span>
                          {isSelected && (
                            <Icon name="Check" size={14} className="text-primary flex-shrink-0" />
                          )}
                        </div>
                        
                        {mapping && (
                          <span className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border",
                            getMappingColor(mapping)
                          )}>
                            {getMappingLabel(mapping)}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            
            <tbody>
              {displayData?.map((row, rowIndex) => {
                const isRowSel = isRowSelected(rowIndex);
                const rowMapping = rowMappings?.[rowIndex];
                
                return (
                  <tr
                    key={rowIndex}
                    className={cn(
                      "transition-colors",
                      isRowSel && "bg-secondary/10"
                    )}
                  >
                    {/* Row number + selection */}
                    <td
                      onClick={(e) => onRowClick(rowIndex, e)}
                      className={cn(
                        "sticky left-0 z-10 bg-muted border-b border-r border-border p-2 text-center cursor-pointer",
                        "hover:bg-secondary/20",
                        isRowSel && "bg-secondary/30 border-secondary"
                      )}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {rowIndex + 1}
                        </span>
                        {rowMapping && (
                          <Icon name="Tag" size={12} className="text-secondary" />
                        )}
                      </div>
                    </td>
                    
                    {/* Data cells */}
                    {row?.map((cell, colIndex) => {
                      const isColSel = isColumnSelected(colIndex);
                      const colMapping = columnMappings?.[colIndex];
                      
                      return (
                        <td
                          key={colIndex}
                          className={cn(
                            "border-b border-r border-border p-3 text-sm text-foreground",
                            isColSel && "bg-primary/5",
                            isRowSel && "bg-secondary/5",
                            isColSel && isRowSel && "bg-primary/10"
                          )}
                        >
                          <div className="truncate max-w-[200px]" title={cell}>
                            {cell || <span className="text-muted-foreground italic">empty</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {data?.length > 20 && (
        <div className="p-3 bg-muted/50 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">
            Showing first 20 rows of {data?.length} total rows
          </p>
        </div>
      )}
    </div>
  );
};

export default SpreadsheetCanvas;