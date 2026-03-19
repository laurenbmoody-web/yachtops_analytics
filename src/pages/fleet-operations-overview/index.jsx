import React, { useState, useEffect } from 'react';
import Header from '../../components/navigation/Header';
import AlertPanel from '../../components/navigation/AlertPanel';
import KPIStrip from '../../components/dashboard/KPIStrip';
import BlueprintNavigator from '../../components/dashboard/BlueprintNavigator';
import TimeRangeSelector from './components/TimeRangeSelector';
import AutoRefreshControl from './components/AutoRefreshControl';
import ConnectionStatusIndicator from './components/ConnectionStatusIndicator';
import YachtPerformanceCard from './components/YachtPerformanceCard';
import FilterControls from './components/FilterControls';

const FleetOperationsOverview = () => {
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState('24h');
  const [refreshInterval, setRefreshInterval] = useState('10m');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connected');
  const [activeFilters, setActiveFilters] = useState({ status: 'all' });

  const yachtsData = [
  {
    id: 1,
    name: "Azure Horizon",
    status: "operational",
    location: "Mediterranean Sea",
    image: "https://img.rocket.new/generatedImages/rocket_gen_img_1b8fe4c14-1773100589069.png",
    imageAlt: "Luxury white yacht Azure Horizon sailing in calm Mediterranean waters with blue sky background",
    utilization: 87,
    activeJobs: 3,
    inventoryStatus: 92,
    efficiency: "18.2 L/nm"
  },
  {
    id: 2,
    name: "Ocean Majesty",
    status: "warning",
    location: "Caribbean Sea",
    image: "https://img.rocket.new/generatedImages/rocket_gen_img_11bd9d66b-1772968278005.png",
    imageAlt: "Modern superyacht Ocean Majesty anchored in turquoise Caribbean waters near tropical island",
    utilization: 65,
    activeJobs: 5,
    inventoryStatus: 78,
    efficiency: "19.8 L/nm"
  },
  {
    id: 3,
    name: "Serenity Wave",
    status: "operational",
    location: "Pacific Ocean",
    image: "https://img.rocket.new/generatedImages/rocket_gen_img_1c93373a0-1773083431466.png",
    imageAlt: "Elegant motor yacht Serenity Wave cruising through Pacific Ocean waves at sunset",
    utilization: 92,
    activeJobs: 2,
    inventoryStatus: 95,
    efficiency: "17.5 L/nm"
  },
  {
    id: 4,
    name: "Neptune Star",
    status: "critical",
    location: "Atlantic Ocean",
    image: "https://img.rocket.new/generatedImages/rocket_gen_img_14c413d5c-1772135791311.png",
    imageAlt: "Large expedition yacht Neptune Star navigating Atlantic Ocean with dramatic cloudy sky",
    utilization: 45,
    activeJobs: 8,
    inventoryStatus: 62,
    efficiency: "21.3 L/nm"
  },
  {
    id: 5,
    name: "Crystal Voyager",
    status: "operational",
    location: "Indian Ocean",
    image: "https://img.rocket.new/generatedImages/rocket_gen_img_13ca0ed56-1772968273377.png",
    imageAlt: "Sleek white superyacht Crystal Voyager sailing in Indian Ocean with clear blue waters",
    utilization: 78,
    activeJobs: 4,
    inventoryStatus: 88,
    efficiency: "18.9 L/nm"
  },
  {
    id: 6,
    name: "Royal Breeze",
    status: "operational",
    location: "Red Sea",
    image: "https://img.rocket.new/generatedImages/rocket_gen_img_1a2069fd4-1773600934118.png",
    imageAlt: "Luxury charter yacht Royal Breeze moored in Red Sea with desert coastline in background",
    utilization: 83,
    activeJobs: 3,
    inventoryStatus: 90,
    efficiency: "17.8 L/nm"
  }];


  const [filteredYachts, setFilteredYachts] = useState(yachtsData);

  useEffect(() => {
    if (activeFilters?.status === 'all') {
      setFilteredYachts(yachtsData);
    } else {
      setFilteredYachts(yachtsData?.filter((yacht) => yacht?.status === activeFilters?.status));
    }
  }, [activeFilters]);

  useEffect(() => {
    const simulateConnection = () => {
      const statuses = ['connected', 'connecting', 'connected'];
      let index = 0;
      const interval = setInterval(() => {
        setConnectionStatus(statuses?.[index % statuses?.length]);
        index++;
      }, 5000);
      return interval;
    };

    const connectionInterval = simulateConnection();

    return () => clearInterval(connectionInterval);
  }, []);

  useEffect(() => {
    if (refreshInterval === 'off') return;

    const intervalMap = {
      '5m': 300000,
      '10m': 600000,
      '15m': 900000
    };

    const interval = setInterval(() => {
      setIsRefreshing(true);
      setTimeout(() => setIsRefreshing(false), 2000);
    }, intervalMap?.[refreshInterval]);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  const handleTimeRangeChange = (range) => {
    setSelectedTimeRange(range);
  };

  const handleRefreshIntervalChange = (interval) => {
    setRefreshInterval(interval);
  };

  const handleFilterChange = (filterType, value) => {
    setActiveFilters((prev) => ({
      ...prev,
      [filterType]: value
    }));
  };

  const handleViewYachtDetails = (yacht) => {
    console.log('View details for:', yacht?.name);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="pt-16">
        <div className="lg:pr-96">
          <div className="px-4 md:px-6 lg:px-8 py-6 md:py-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 md:mb-8">
              <div>
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-foreground mb-2">
                  Fleet Operations Overview
                </h1>
                <p className="text-sm md:text-base text-muted-foreground">
                  Real-time monitoring and analytics for yacht fleet performance
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <TimeRangeSelector
                  selectedRange={selectedTimeRange}
                  onRangeChange={handleTimeRangeChange} />

                <AutoRefreshControl
                  selectedInterval={refreshInterval}
                  onIntervalChange={handleRefreshIntervalChange}
                  isRefreshing={isRefreshing} />

                <ConnectionStatusIndicator status={connectionStatus} />
              </div>
            </div>

            <KPIStrip />

            <div className="mb-6 md:mb-8">
              <div className="bg-card rounded-xl border border-border p-4 md:p-6 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg md:text-xl font-semibold text-foreground">
                    Fleet Blueprint Overview
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs md:text-sm text-muted-foreground caption">
                      Interactive Asset Map
                    </span>
                  </div>
                </div>
                <BlueprintNavigator
                  heroImageUrl=""
                  useCustomHero={false} />
                
              </div>
            </div>

            <FilterControls
              onFilterChange={handleFilterChange}
              activeFilters={activeFilters} />


            <div className="mt-6 md:mt-8">
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h2 className="text-lg md:text-xl font-semibold text-foreground">
                  Individual Yacht Performance
                </h2>
                <span className="text-sm text-muted-foreground caption">
                  {filteredYachts?.length} {filteredYachts?.length === 1 ? 'yacht' : 'yachts'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
                {filteredYachts?.map((yacht) =>
                <YachtPerformanceCard
                  key={yacht?.id}
                  yacht={yacht}
                  onViewDetails={handleViewYachtDetails} />
                )}
              </div>

              {filteredYachts?.length === 0 &&
              <div className="text-center py-12 md:py-16">
                  <div className="w-16 h-16 md:w-20 md:h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                    className="w-8 h-8 md:w-10 md:h-10 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor">

                      <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />

                    </svg>
                  </div>
                  <h3 className="text-lg md:text-xl font-semibold text-foreground mb-2">
                    No Yachts Found
                  </h3>
                  <p className="text-sm md:text-base text-muted-foreground">
                    No yachts match the selected filters. Try adjusting your filter criteria.
                  </p>
                </div>
              }
            </div>
          </div>
        </div>

        <AlertPanel
          isOpen={alertPanelOpen}
          onClose={() => setAlertPanelOpen(false)} />

      </div>
    </div>);

};

export default FleetOperationsOverview;