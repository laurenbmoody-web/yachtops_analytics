import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';


const ReviewConfirmModal = ({ data, onConfirm, onAdjust, onClose }) => {
  const { items, locations, categories, skippedRows } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Review Import
              </h2>
              <p className="text-muted-foreground">
                Here's what we'll create from your selections
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="Package" size={20} className="text-primary" />
                <span className="text-sm font-medium text-primary">Items</span>
              </div>
              <p className="text-3xl font-bold text-foreground">{items?.length || 0}</p>
            </div>

            <div className="bg-success/10 border border-success/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="MapPin" size={20} className="text-success" />
                <span className="text-sm font-medium text-success">Locations</span>
              </div>
              <p className="text-3xl font-bold text-foreground">{locations?.length || 0}</p>
            </div>

            <div className="bg-secondary/10 border border-secondary/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="Tag" size={20} className="text-secondary" />
                <span className="text-sm font-medium text-secondary">Categories</span>
              </div>
              <p className="text-3xl font-bold text-foreground">{categories?.length || 0}</p>
            </div>

            <div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="AlertCircle" size={20} className="text-warning" />
                <span className="text-sm font-medium text-warning">Skipped</span>
              </div>
              <p className="text-3xl font-bold text-foreground">{skippedRows?.length || 0}</p>
            </div>
          </div>

          {/* Items Preview */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Icon name="Package" size={20} />
              Items to Create
            </h3>
            <div className="bg-muted/50 border border-border rounded-xl overflow-hidden">
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-muted-foreground">Item Name</th>
                      <th className="text-left p-3 text-sm font-medium text-muted-foreground">Category</th>
                      <th className="text-left p-3 text-sm font-medium text-muted-foreground">Locations</th>
                      <th className="text-right p-3 text-sm font-medium text-muted-foreground">Total Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items?.slice(0, 10)?.map((item, idx) => (
                      <tr key={idx} className="border-t border-border">
                        <td className="p-3 text-sm text-foreground">{item?.name}</td>
                        <td className="p-3 text-sm text-muted-foreground">{item?.category}</td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {item?.locations?.length} location(s)
                        </td>
                        <td className="p-3 text-sm text-foreground text-right font-medium">
                          {item?.totalQuantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {items?.length > 10 && (
                <div className="p-3 bg-muted border-t border-border text-center">
                  <p className="text-sm text-muted-foreground">
                    + {items?.length - 10} more items
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Locations Created */}
          {locations?.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <Icon name="MapPin" size={20} />
                Locations Created
              </h3>
              <div className="flex flex-wrap gap-2">
                {locations?.map((location, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-success/10 text-success border border-success/20 rounded-lg text-sm font-medium"
                  >
                    <Icon name="MapPin" size={14} />
                    {location}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Categories */}
          {categories?.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <Icon name="Tag" size={20} />
                Categories Used
              </h3>
              <div className="flex flex-wrap gap-2">
                {categories?.map((category, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-secondary/10 text-secondary border border-secondary/20 rounded-lg text-sm font-medium"
                  >
                    <Icon name="Tag" size={14} />
                    {category}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Skipped Rows */}
          {skippedRows?.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <Icon name="AlertCircle" size={20} />
                Rows Skipped
              </h3>
              <div className="bg-warning/10 border border-warning/20 rounded-xl p-4">
                <ul className="space-y-2">
                  {skippedRows?.slice(0, 5)?.map((skip, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground">
                      Row {skip?.rowIndex + 1}: {skip?.reason}
                    </li>
                  ))}
                </ul>
                {skippedRows?.length > 5 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    + {skippedRows?.length - 5} more rows skipped
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-muted/30">
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={onAdjust}
              iconName="ArrowLeft"
            >
              Go back and adjust selections
            </Button>
            <Button
              onClick={onConfirm}
              iconName="Check"
            >
              Import inventory
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewConfirmModal;