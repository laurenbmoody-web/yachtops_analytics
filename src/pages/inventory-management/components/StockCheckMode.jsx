import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const StockCheckMode = () => {
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [quantities, setQuantities] = useState({});

  // Mock items for stock check
  const items = [
    { id: 'item-1', name: 'Belvedere Vodka', category: 'Alcohol & Bar', location: 'Bar Storage', currentQuantity: 4.5, unit: 'bottles' },
    { id: 'item-2', name: 'Hendrick\'s Gin', category: 'Alcohol & Bar', location: 'Bar Storage', currentQuantity: 3, unit: 'bottles' },
    { id: 'item-3', name: 'Dom Pérignon 2012', category: 'Alcohol & Bar', location: 'Wine Cellar', currentQuantity: 6, unit: 'bottles' },
    { id: 'item-4', name: 'Macallan 18yr', category: 'Alcohol & Bar', location: 'Bar Storage', currentQuantity: 2, unit: 'bottles' },
    { id: 'item-5', name: 'Grey Goose Vodka', category: 'Alcohol & Bar', location: 'Bar Storage', currentQuantity: 8, unit: 'bottles' }
  ];

  const currentItem = items?.[currentIndex];
  const progress = ((currentIndex + 1) / items?.length) * 100;
  const isLastItem = currentIndex === items?.length - 1;

  const handleQuantityChange = (value) => {
    setQuantities({
      ...quantities,
      [currentItem?.id]: value
    });
  };

  const handleNext = () => {
    if (isLastItem) {
      // Complete stock check
      navigate('/inventory');
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSkip = () => {
    if (isLastItem) {
      navigate('/inventory');
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleExit = () => {
    if (window.confirm('Are you sure you want to exit stock check? Progress will not be saved.')) {
      navigate('/inventory');
    }
  };

  const currentQuantity = quantities?.[currentItem?.id] ?? currentItem?.currentQuantity;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-[800px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleExit}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={24} className="text-foreground" />
            </button>
            <div>
              <h2 className="text-lg font-semibold text-foreground font-heading">Stock Check</h2>
              <p className="text-sm text-muted-foreground">
                Item {currentIndex + 1} of {items?.length}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-primary">{Math.round(progress)}%</p>
            <p className="text-xs text-muted-foreground">Complete</p>
          </div>
        </div>
      </div>
      {/* Progress Bar */}
      <div className="bg-muted h-2">
        <div
          className="bg-primary h-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-[600px] w-full">
          {/* Item Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-lg mb-6">
            {/* Item Info */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-semibold text-foreground mb-2 font-heading">
                {currentItem?.name}
              </h1>
              <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Icon name="Tag" size={14} />
                  <span>{currentItem?.category}</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1">
                  <Icon name="MapPin" size={14} />
                  <span>{currentItem?.location}</span>
                </div>
              </div>
            </div>

            {/* Current Quantity Display */}
            <div className="bg-muted rounded-xl p-6 mb-6">
              <p className="text-sm text-muted-foreground text-center mb-2">Last Recorded</p>
              <p className="text-2xl font-bold text-foreground text-center">
                {currentItem?.currentQuantity} {currentItem?.unit}
              </p>
            </div>

            {/* Quantity Input */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-foreground mb-3 text-center">
                Enter Current Quantity
              </label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => handleQuantityChange(Math.max(0, currentQuantity - 1))}
                  className="w-14 h-14 rounded-xl bg-muted hover:bg-muted/80 flex items-center justify-center transition-smooth"
                >
                  <Icon name="Minus" size={24} className="text-foreground" />
                </button>
                <input
                  type="number"
                  value={currentQuantity}
                  onChange={(e) => handleQuantityChange(parseFloat(e?.target?.value) || 0)}
                  className="flex-1 text-center text-3xl font-bold bg-background border-2 border-border rounded-xl py-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  step="0.5"
                  min="0"
                />
                <button
                  onClick={() => handleQuantityChange(currentQuantity + 1)}
                  className="w-14 h-14 rounded-xl bg-muted hover:bg-muted/80 flex items-center justify-center transition-smooth"
                >
                  <Icon name="Plus" size={24} className="text-foreground" />
                </button>
              </div>
              <p className="text-center text-sm text-muted-foreground mt-2">{currentItem?.unit}</p>
            </div>

            {/* Quick Adjustment Buttons */}
            <div className="flex gap-2 mb-6">
              {[0.5, 1, 2, 5]?.map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleQuantityChange(currentQuantity + amount)}
                  className="flex-1 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium text-foreground transition-smooth"
                >
                  +{amount}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              iconName="ChevronLeft"
              className="flex-1"
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={handleSkip}
              className="flex-1"
            >
              Skip
            </Button>
            <Button
              variant="default"
              size="lg"
              onClick={handleNext}
              iconName={isLastItem ? 'Check' : 'ChevronRight'}
              iconPosition="right"
              className="flex-1"
            >
              {isLastItem ? 'Complete' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StockCheckMode;