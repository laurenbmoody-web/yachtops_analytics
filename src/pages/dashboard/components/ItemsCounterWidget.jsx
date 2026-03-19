import React from 'react';
import Icon from '../../../components/AppIcon';

const ItemsCounterWidget = ({ itemsIn = 0, itemsOut = 0 }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-center gap-8">
        {/* Items IN */}
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Icon name="ArrowDownCircle" className="w-8 h-8 text-primary" />
          </div>
          <span className="text-4xl font-bold text-foreground mb-1">{itemsIn}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Items IN</span>
        </div>

        {/* Divider */}
        <div className="h-24 w-px bg-border" />

        {/* Items OUT */}
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-3">
            <Icon name="ArrowUpCircle" className="w-8 h-8 text-success" />
          </div>
          <span className="text-4xl font-bold text-foreground mb-1">{itemsOut}</span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Items OUT</span>
        </div>
      </div>
    </div>
  );
};

export default ItemsCounterWidget;