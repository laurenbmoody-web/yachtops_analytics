import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import Button from '../../../components/ui/Button';

import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, parseISO, isWithinInterval, startOfDay, differenceInDays } from 'date-fns';
import EditEventModal from './EditEventModal';

const MonthView = ({ currentMonth, onMonthChange, selectedDate, onDateSelect, events }) => {
  const [hoveredEventId, setHoveredEventId] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [barPositions, setBarPositions] = useState([]);
  const [cellHeights, setCellHeights] = useState({}); // Track dynamic cell heights per week
  const [eventLanes, setEventLanes] = useState({}); // Track lane assignments per event
  const weekRefs = useRef([]);
  const cellRefs = useRef({});

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Fixed neutral surface color palette (surface-1 to surface-5)
  const SURFACE_COLORS = [
    { id: 'surface-1', bg: 'bg-slate-400/90', hover: 'hover:bg-slate-400', outline: 'ring-slate-400' },
    { id: 'surface-2', bg: 'bg-zinc-400/90', hover: 'hover:bg-zinc-400', outline: 'ring-zinc-400' },
    { id: 'surface-3', bg: 'bg-neutral-400/90', hover: 'hover:bg-neutral-400', outline: 'ring-neutral-400' },
    { id: 'surface-4', bg: 'bg-stone-400/90', hover: 'hover:bg-stone-400', outline: 'ring-stone-400' },
    { id: 'surface-5', bg: 'bg-gray-400/90', hover: 'hover:bg-gray-400', outline: 'ring-gray-400' }
  ];

  // Assign surface colors to events based on date conflicts
  const eventColorMap = useMemo(() => {
    const colorMap = new Map(); // eventId -> surface color object
    const dateColorUsage = new Map(); // date string -> Set of surface color IDs

    // Helper: Get all dates an event spans
    const getEventDates = (event) => {
      if (!event?.startDate) return [];
      try {
        const eventStart = startOfDay(parseISO(event?.startDate));
        const eventEnd = event?.endDate ? startOfDay(parseISO(event?.endDate)) : eventStart;
        return eachDayOfInterval({ start: eventStart, end: eventEnd });
      } catch {
        return [];
      }
    };

    // Helper: Get colors already used on any of the given dates
    const getUsedColorsOnDates = (dates) => {
      const usedColors = new Set();
      dates?.forEach(date => {
        const dateKey = format(date, 'yyyy-MM-dd');
        const colorsOnDate = dateColorUsage?.get(dateKey);
        if (colorsOnDate) {
          colorsOnDate?.forEach(colorId => usedColors?.add(colorId));
        }
      });
      return usedColors;
    };

    // Helper: Find first available color not used on any of the dates
    const findAvailableColor = (dates) => {
      const usedColors = getUsedColorsOnDates(dates);
      
      // Find first color not in use
      for (const color of SURFACE_COLORS) {
        if (!usedColors?.has(color?.id)) {
          return { color, needsOutline: false };
        }
      }
      
      // All colors used - reuse surface-1 with outline
      return { color: SURFACE_COLORS?.[0], needsOutline: true };
    };

    // Helper: Mark color as used on all dates
    const markColorUsed = (dates, colorId) => {
      dates?.forEach(date => {
        const dateKey = format(date, 'yyyy-MM-dd');
        if (!dateColorUsage?.has(dateKey)) {
          dateColorUsage?.set(dateKey, new Set());
        }
        dateColorUsage?.get(dateKey)?.add(colorId);
      });
    };

    // Sort events by start date to ensure consistent assignment
    const sortedEvents = [...(events || [])]?.sort((a, b) => {
      if (!a?.startDate || !b?.startDate) return 0;
      return new Date(a?.startDate) - new Date(b?.startDate);
    });

    // Assign colors to each event
    sortedEvents?.forEach(event => {
      const eventDates = getEventDates(event);
      if (eventDates?.length === 0) return;

      const { color, needsOutline } = findAvailableColor(eventDates);
      colorMap?.set(event?.id, { ...color, needsOutline });
      markColorUsed(eventDates, color?.id);
    });

    return colorMap;
  }, [events]);

  // Get surface color for an event
  const getEventColor = (eventId) => {
    return eventColorMap?.get(eventId) || SURFACE_COLORS?.[0];
  };

  // Get single-day events for a specific date (non-multi-day)
  const getSingleDayEvents = useCallback((date) => {
    return events?.filter(event => {
      if (!event?.startDate) return false;
      try {
        const eventStart = startOfDay(parseISO(event?.startDate));
        const eventEnd = event?.endDate ? startOfDay(parseISO(event?.endDate)) : eventStart;
        const isMultiDay = differenceInDays(eventEnd, eventStart) > 0;
        
        return !isMultiDay && isSameDay(date, eventStart);
      } catch {
        return false;
      }
    }) || [];
  }, [events]);

  // LANE-BASED STACKING SYSTEM
  // Assign lanes to all events (multi-day and single-day) to prevent overlap
  const laneAssignments = useMemo(() => {
    const lanes = {}; // eventId -> lane number
    const dateLaneOccupancy = new Map(); // date key -> Set of occupied lane numbers
    const multiDayEvents = new Set(); // Track which events are multi-day

    // Helper: Get all dates an event spans
    const getEventDates = (event) => {
      if (!event?.startDate) return [];
      try {
        const eventStart = startOfDay(parseISO(event?.startDate));
        const eventEnd = event?.endDate ? startOfDay(parseISO(event?.endDate)) : eventStart;
        return eachDayOfInterval({ start: eventStart, end: eventEnd });
      } catch {
        return [];
      }
    };

    // Helper: Check if event is multi-day
    const isEventMultiDay = (event) => {
      if (!event?.startDate) return false;
      try {
        const eventStart = startOfDay(parseISO(event?.startDate));
        const eventEnd = event?.endDate ? startOfDay(parseISO(event?.endDate)) : eventStart;
        return differenceInDays(eventEnd, eventStart) > 0;
      } catch {
        return false;
      }
    };

    // Helper: Find first available lane across all dates the event spans
    const findAvailableLane = (dates) => {
      let lane = 0;
      while (true) {
        // Check if this lane is free on ALL dates
        const isFree = dates?.every(date => {
          const dateKey = format(date, 'yyyy-MM-dd');
          const occupiedLanes = dateLaneOccupancy?.get(dateKey) || new Set();
          return !occupiedLanes?.has(lane);
        });
        
        if (isFree) return lane;
        lane++;
      }
    };

    // Helper: Mark lane as occupied on all dates
    const occupyLane = (dates, lane) => {
      dates?.forEach(date => {
        const dateKey = format(date, 'yyyy-MM-dd');
        if (!dateLaneOccupancy?.has(dateKey)) {
          dateLaneOccupancy?.set(dateKey, new Set());
        }
        dateLaneOccupancy?.get(dateKey)?.add(lane);
      });
    };

    // Sort events: multi-day first (by start date), then single-day (by start date)
    const sortedEvents = [...(events || [])]?.sort((a, b) => {
      if (!a?.startDate || !b?.startDate) return 0;
      
      const aIsMultiDay = isEventMultiDay(a);
      const bIsMultiDay = isEventMultiDay(b);
      
      // Multi-day events first
      if (aIsMultiDay && !bIsMultiDay) return -1;
      if (!aIsMultiDay && bIsMultiDay) return 1;
      
      // Then by start date
      const aStart = startOfDay(parseISO(a?.startDate));
      const bStart = startOfDay(parseISO(b?.startDate));
      return aStart - bStart;
    });

    // Assign lanes to each event
    sortedEvents?.forEach(event => {
      const eventDates = getEventDates(event);
      if (eventDates?.length === 0) return;

      const isMultiDay = isEventMultiDay(event);
      if (isMultiDay) {
        multiDayEvents?.add(event?.id);
      }

      let lane = findAvailableLane(eventDates);
      lanes[event?.id] = lane;
      occupyLane(eventDates, lane);
    });

    // NEW: Build per-day compacted lane mapping for ALL events
    // Compact all events together to eliminate gaps
    const perDayLaneMap = new Map(); // date key -> Map(globalLane -> displayLane)
    
    dateLaneOccupancy?.forEach((occupiedLanes, dateKey) => {
      // Get all events on this date
      const eventsOnDate = sortedEvents?.filter(event => {
        const eventDates = getEventDates(event);
        return eventDates?.some(d => format(d, 'yyyy-MM-dd') === dateKey);
      });

      // Sort ALL events by their global lane (no separation by type)
      const allEventsSorted = eventsOnDate?.sort((a, b) => lanes?.[a?.id] - lanes?.[b?.id]);

      // Assign compacted display lanes sequentially to eliminate gaps
      const laneMap = new Map();
      let nextDisplayLane = 0;

      allEventsSorted?.forEach(event => {
        const globalLane = lanes?.[event?.id];
        laneMap?.set(globalLane, nextDisplayLane);
        nextDisplayLane++;
      });

      perDayLaneMap?.set(dateKey, laneMap);
    });

    // Calculate max lanes per date for density calculation (using compacted count)
    const maxLanesPerDate = new Map();
    dateLaneOccupancy?.forEach((occupiedLanes, dateKey) => {
      maxLanesPerDate?.set(dateKey, occupiedLanes?.size); // Count of actual events
    });

    return { lanes, maxLanesPerDate, perDayLaneMap, multiDayEvents };
  }, [events]);

  // Calculate event bar positions for multi-day events
  const calculateEventBars = useMemo(() => {
    const bars = [];

    // Group calendar days into weeks
    const weeks = [];
    for (let i = 0; i < calendarDays?.length; i += 7) {
      weeks?.push(calendarDays?.slice(i, i + 7));
    }

    weeks?.forEach((weekDays, weekIndex) => {
      const weekEvents = new Map();

      // Find all events that appear in this week
      weekDays?.forEach((day, dayIndex) => {
        events?.forEach(event => {
          if (!event?.startDate) return;
          try {
            const eventStart = startOfDay(parseISO(event?.startDate));
            const eventEnd = event?.endDate ? startOfDay(parseISO(event?.endDate)) : eventStart;
            const isMultiDay = differenceInDays(eventEnd, eventStart) > 0;

            if (isWithinInterval(day, { start: eventStart, end: eventEnd }) ||
                isSameDay(day, eventStart) || isSameDay(day, eventEnd)) {
              
              if (!weekEvents?.has(event?.id)) {
                weekEvents?.set(event?.id, {
                  event,
                  startDayIndex: dayIndex,
                  endDayIndex: dayIndex,
                  isMultiDay,
                  eventStart,
                  eventEnd
                });
              } else {
                const existing = weekEvents?.get(event?.id);
                existing.endDayIndex = dayIndex;
              }
            }
          } catch {}
        });
      });

      // Convert to bar objects with positioning (only multi-day)
      weekEvents?.forEach((data, eventId) => {
        const { event, startDayIndex, endDayIndex, isMultiDay, eventStart, eventEnd } = data;
        
        if (!isMultiDay) return; // Skip single-day events
        
        // Determine if this is the actual start/end or just week boundary
        const isActualStart = isSameDay(weekDays?.[startDayIndex], eventStart) || eventStart < weekDays?.[startDayIndex];
        const isActualEnd = isSameDay(weekDays?.[endDayIndex], eventEnd) || eventEnd > weekDays?.[endDayIndex];
        
        bars?.push({
          eventId,
          event,
          weekIndex,
          startDayIndex,
          endDayIndex,
          lane: laneAssignments?.lanes?.[eventId] ?? 0,
          isMultiDay,
          isActualStart,
          isActualEnd
        });
      });
    });

    return bars;
  }, [events, calendarDays, laneAssignments]);

  // Calculate event density per day and determine adaptive heights
  const calculateEventDensity = useMemo(() => {
    const weekDensity = {}; // weekIndex -> max lanes in any day of that week

    // Calculate max lanes per week based on lane assignments
    for (let weekIndex = 0; weekIndex < calendarDays?.length / 7; weekIndex++) {
      const weekDays = calendarDays?.slice(weekIndex * 7, (weekIndex + 1) * 7);
      let maxLanes = 0;
      
      weekDays?.forEach(day => {
        const dateKey = format(day, 'yyyy-MM-dd');
        const lanesOnDate = laneAssignments?.maxLanesPerDate?.get(dateKey) || 0;
        if (lanesOnDate > maxLanes) {
          maxLanes = lanesOnDate;
        }
      });
      
      weekDensity[weekIndex] = maxLanes;
    }

    return { weekDensity };
  }, [calendarDays, laneAssignments]);

  // Calculate adaptive bar height and cell height based on density
  const getAdaptiveHeights = (weekIndex) => {
    const MIN_BAR_HEIGHT = 18; // Minimum bar height
    const DEFAULT_BAR_HEIGHT = 24; // Default bar height
    const MIN_CELL_HEIGHT = 80; // Minimum cell height
    const DATE_NUMBER_HEIGHT = 32; // Space for date number + margin
    const BAR_GAP = 4; // Gap between bars

    const weekDays = calendarDays?.slice(weekIndex * 7, (weekIndex + 1) * 7);
    
    // Find maximum lanes needed across all days in this week (using compacted per-day counts)
    let maxLanes = 0;
    weekDays?.forEach(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const lanesOnDate = laneAssignments?.maxLanesPerDate?.get(dateKey) || 0;
      if (lanesOnDate > maxLanes) {
        maxLanes = lanesOnDate;
      }
    });

    let barHeight = DEFAULT_BAR_HEIGHT;
    let cellHeight = MIN_CELL_HEIGHT;

    if (maxLanes > 0) {
      // Calculate required space for all lanes
      const requiredSpace = maxLanes * DEFAULT_BAR_HEIGHT + (maxLanes - 1) * BAR_GAP;
      const availableSpace = MIN_CELL_HEIGHT - DATE_NUMBER_HEIGHT - 16; // 16px for top/bottom padding

      if (requiredSpace > availableSpace) {
        // Try to compress bar height
        const compressedBarHeight = Math.floor((availableSpace - (maxLanes - 1) * BAR_GAP) / maxLanes);
        
        if (compressedBarHeight >= MIN_BAR_HEIGHT) {
          // Priority A: Use compressed bar height
          barHeight = compressedBarHeight;
        } else {
          // Priority B: Use minimum bar height and increase cell height
          barHeight = MIN_BAR_HEIGHT;
          const requiredSpaceWithMinHeight = maxLanes * MIN_BAR_HEIGHT + (maxLanes - 1) * BAR_GAP;
          cellHeight = DATE_NUMBER_HEIGHT + requiredSpaceWithMinHeight + 16; // +16 for top/bottom padding
        }
      }
    }
    
    return { barHeight, cellHeight };
  };

  // Calculate precise bar positions using getBoundingClientRect
  useEffect(() => {
    const calculatePrecisePositions = () => {
      const positions = [];
      const INSET = 8; // Increased inset padding to keep bar inside cell with margin
      const newCellHeights = {};

      // Calculate adaptive heights for each week
      for (let weekIndex = 0; weekIndex < calendarDays?.length / 7; weekIndex++) {
        const { cellHeight } = getAdaptiveHeights(weekIndex);
        newCellHeights[weekIndex] = cellHeight;
      }

      calculateEventBars?.forEach((bar) => {
        const { weekIndex, startDayIndex, endDayIndex, isMultiDay } = bar;
        if (!isMultiDay) return;

        const weekRow = weekRefs?.current?.[weekIndex];
        if (!weekRow) return;

        const startCellKey = `${weekIndex}-${startDayIndex}`;
        const endCellKey = `${weekIndex}-${endDayIndex}`;
        const startCell = cellRefs?.current?.[startCellKey];
        const endCell = cellRefs?.current?.[endCellKey];

        if (!startCell || !endCell) return;

        try {
          const weekRect = weekRow?.getBoundingClientRect();
          const startRect = startCell?.getBoundingClientRect();
          const endRect = endCell?.getBoundingClientRect();

          // Calculate left and right positions relative to week row
          const leftPx = startRect?.left - weekRect?.left;
          const rightPx = endRect?.right - weekRect?.left;
          const widthPx = rightPx - leftPx;

          // Apply inset to keep bar inside cell boundaries with proper margin
          const finalLeft = leftPx + INSET;
          const finalWidth = Math.max(widthPx - (INSET * 2), 8); // Minimum 8px width

          positions?.push({
            ...bar,
            left: finalLeft,
            width: finalWidth
          });
        } catch (error) {
          console.error('Error calculating bar position:', error);
        }
      });

      setBarPositions(positions);
      setCellHeights(newCellHeights);
    };

    // Calculate on mount and when dependencies change
    calculatePrecisePositions();

    // Recalculate on window resize
    window.addEventListener('resize', calculatePrecisePositions);
    return () => window.removeEventListener('resize', calculatePrecisePositions);
  }, [calculateEventBars, calculateEventDensity]);

  const handlePreviousMonth = () => {
    onMonthChange(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    onMonthChange(addMonths(currentMonth, 1));
  };

  const handleToday = () => {
    onMonthChange(new Date());
    onDateSelect(new Date());
  };

  const handleEventClick = (event, e) => {
    e?.stopPropagation();
    setEditingEvent(event);
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            iconName="ChevronLeft"
            onClick={handlePreviousMonth}
          />
          <Button
            variant="ghost"
            size="icon"
            iconName="ChevronRight"
            onClick={handleNextMonth}
          />
        </div>
      </div>
      {/* Calendar Grid */}
      <div className="space-y-0">
        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {dayNames?.map(day => (
            <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Weeks */}
        {Array.from({ length: calendarDays?.length / 7 })?.map((_, weekIndex) => {
          const weekDays = calendarDays?.slice(weekIndex * 7, (weekIndex + 1) * 7);
          const weekBars = barPositions?.filter(bar => bar?.weekIndex === weekIndex);
          const { barHeight, cellHeight } = getAdaptiveHeights(weekIndex);

          return (
            <div 
              key={weekIndex} 
              ref={(el) => (weekRefs.current[weekIndex] = el)}
              className="relative mb-2 overflow-hidden"
            >
              {/* Date cells */}
              <div className="grid grid-cols-7 gap-2">
                {weekDays?.map((day, dayIdx) => {
                  const singleDayEvents = getSingleDayEvents(day);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isSelected = selectedDate && isSameDay(day, selectedDate);
                  const isToday = isSameDay(day, new Date());
                  const cellKey = `${weekIndex}-${dayIdx}`;

                  return (
                    <button
                      key={dayIdx}
                      ref={(el) => (cellRefs.current[cellKey] = el)}
                      onClick={() => onDateSelect(day)}
                      className={`
                        relative p-2 rounded-lg border transition-all flex flex-col
                        ${isCurrentMonth ? 'bg-card' : 'bg-muted/30'}
                        ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}
                        ${isToday ? 'bg-primary/5' : ''}
                        hover:border-primary/50 hover:shadow-sm
                      `}
                      style={{ minHeight: `${cellHeight}px` }}
                    >
                      {/* Date Number */}
                      <span className={`
                        text-sm font-medium mb-2 text-left
                        ${isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'}
                        ${isToday ? 'text-primary font-semibold' : ''}
                      `}>
                        {format(day, 'd')}
                      </span>
                      
                      {/* Single-day events - positioned in compacted lanes per-day */}
                      <div className="relative flex-1 w-full" style={{ marginTop: '8px', paddingBottom: '8px', minHeight: '40px' }}>
                        {singleDayEvents?.map((event) => {
                          const eventColor = getEventColor(event?.id);
                          const globalLane = laneAssignments?.lanes?.[event?.id] ?? 0;
                          const dateKey = format(day, 'yyyy-MM-dd');
                          const laneMap = laneAssignments?.perDayLaneMap?.get(dateKey);
                          let displayLane = laneMap?.get(globalLane) ?? 0; // Compacted lane
                          const topOffset = displayLane * (barHeight + 4); // Lane-based positioning with compaction
                          
                          return (
                            <div
                              key={event?.id}
                              className={`
                                absolute px-2 cursor-pointer transition-all text-white text-xs font-medium
                                ${eventColor?.bg} ${eventColor?.hover}
                                ${eventColor?.needsOutline ? `ring-1 ${eventColor?.outline}` : ''}
                                rounded-md
                                ${hoveredEventId === event?.id ? 'ring-2 ring-primary/50 shadow-md' : ''}
                                truncate overflow-hidden
                              `}
                              style={{ 
                                height: `${barHeight}px`, 
                                lineHeight: `${barHeight}px`, 
                                paddingTop: 0, 
                                paddingBottom: 0,
                                top: `${topOffset}px`,
                                left: '4px',
                                right: '4px',
                                maxWidth: 'calc(100% - 8px)',
                                boxSizing: 'border-box',
                                zIndex: 15 // Above multi-day bars
                              }}
                              onClick={(e) => handleEventClick(event, e)}
                              onMouseEnter={() => setHoveredEventId(event?.id)}
                              onMouseLeave={() => setHoveredEventId(null)}
                              title={event?.title}
                            >
                              {event?.title}
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
              {/* Multi-day event bars - absolutely positioned with per-day compacted lane stacking */}
              {weekBars?.map((bar) => {
                const { event, isMultiDay, isActualStart, isActualEnd, eventId, left, width, lane, startDayIndex } = bar;
                if (!isMultiDay || left === undefined || width === undefined) return null;

                const isHovered = hoveredEventId === eventId;
                
                // CRITICAL FIX: Get compacted display lane for EACH day this bar spans
                // We need to find which day in this bar segment has the event, and use that day's lane map
                // For multi-day bars, we should use the lane assignment consistently across the span
                // But we need to check if this event actually appears in the compacted lanes for the days it spans
                const weekDays = calendarDays?.slice(weekIndex * 7, (weekIndex + 1) * 7);
                
                // Find the minimum display lane across all days this bar segment spans
                // This ensures the bar doesn't overlap with single-day events on any of those days
                let displayLane = 0;
                for (let dayIdx = startDayIndex; dayIdx <= bar?.endDayIndex; dayIdx++) {
                  const day = weekDays?.[dayIdx];
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const laneMap = laneAssignments?.perDayLaneMap?.get(dateKey);
                  const dayDisplayLane = laneMap?.get(lane) ?? 0;
                  // Use the maximum display lane to ensure the bar doesn't overlap on any day
                  if (dayDisplayLane > displayLane) {
                    displayLane = dayDisplayLane;
                  }
                }
                
                const topOffset = 32 + (displayLane * (barHeight + 4)); // Lane-based positioning with compaction
                const eventColor = getEventColor(eventId);

                // Determine corner rounding
                let roundingClass = '';
                if (isActualStart && isActualEnd) {
                  roundingClass = 'rounded-md';
                } else if (isActualStart) {
                  roundingClass = 'rounded-l-md';
                } else if (isActualEnd) {
                  roundingClass = 'rounded-r-md';
                }

                return (
                  <div
                    key={`bar-${eventId}-${weekIndex}`}
                    className={`
                      absolute px-2 cursor-pointer transition-all text-white text-xs font-medium
                      ${eventColor?.bg} ${eventColor?.hover}
                      ${eventColor?.needsOutline ? `ring-1 ${eventColor?.outline}` : ''}
                      ${roundingClass}
                      ${isHovered ? 'ring-2 ring-primary/50 shadow-md' : ''}
                      truncate overflow-hidden flex items-center
                    `}
                    style={{
                      left: `${left}px`,
                      width: `${width}px`,
                      top: `${topOffset}px`,
                      height: `${barHeight}px`,
                      lineHeight: `${barHeight}px`,
                      paddingTop: 0,
                      paddingBottom: 0,
                      maxWidth: `${width}px`,
                      boxSizing: 'border-box',
                      zIndex: 10 // Below single-day events
                    }}
                    onClick={(e) => handleEventClick(event, e)}
                    onMouseEnter={() => setHoveredEventId(eventId)}
                    onMouseLeave={() => setHoveredEventId(null)}
                    title={`${event?.title}${event?.endDate ? ` · ${format(parseISO(event?.startDate), 'MMM d')} – ${format(parseISO(event?.endDate), 'MMM d')}` : ''}`}
                  >
                    {isActualStart && event?.title}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Edit Event Modal */}
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSuccess={() => {
            setEditingEvent(null);
            // Trigger parent refresh
            window.location?.reload();
          }}
        />
      )}
    </div>
  );
};

export default MonthView;