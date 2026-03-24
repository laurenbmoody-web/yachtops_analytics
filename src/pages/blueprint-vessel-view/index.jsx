import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';

const BlueprintVesselView = () => {
  const navigate = useNavigate();
  const [zoomLevel, setZoomLevel] = useState(1.5);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedZone, setSelectedZone] = useState(null);
  const [hoveredZone, setHoveredZone] = useState(null);
  const canvasRef = useRef(null);

  const zones = [
    {
      id: 'interior',
      name: 'Interior / Accommodation',
      position: { x: 35, y: 20, width: 30, height: 25 },
      inventoryCount: 45,
      jobsCount: 3,
      description: 'Guest cabins, lounges, and living spaces'
    },
    {
      id: 'galley',
      name: 'Galley / Service Areas',
      position: { x: 15, y: 45, width: 25, height: 20 },
      inventoryCount: 52,
      jobsCount: 2,
      description: 'Kitchen, pantry, and service areas'
    },
    {
      id: 'engineering',
      name: 'Engineering / Technical',
      position: { x: 50, y: 65, width: 35, height: 25 },
      inventoryCount: 18,
      jobsCount: 4,
      description: 'Engine room, technical systems, and machinery'
    }
  ];

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.3, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.3, 0.8));
  };

  const handleResetView = () => {
    setZoomLevel(1.5);
    setPanPosition({ x: 0, y: 0 });
    setSelectedZone(null);
  };

  const handleMouseDown = (e) => {
    if (e?.target === canvasRef?.current || e?.target?.closest('.blueprint-image')) {
      setIsDragging(true);
      setDragStart({
        x: e?.clientX - panPosition?.x,
        y: e?.clientY - panPosition?.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setPanPosition({
        x: e?.clientX - dragStart?.x,
        y: e?.clientY - dragStart?.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart]);

  const handleZoneClick = (zone) => {
    setSelectedZone(zone?.id === selectedZone ? null : zone?.id);
  };

  const handleViewInventory = (zone) => {
    navigate(`/inventory?location=${zone?.name}`);
  };

  const handleViewJobs = (zone) => {
    navigate(`/team-jobs-management?location=${zone?.name}`);
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-foreground mb-2">Blueprint / Vessel View</h1>
            <p className="text-sm text-muted-foreground">Visual navigation of the vessel - click zones to filter inventory and jobs by location</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" iconName="Download">
              Export Blueprint
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-4 gap-5">
          {/* Zone Info Sidebar */}
          <div className="space-y-5">
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <h3 className="text-base font-semibold text-foreground mb-4">Vessel Zones</h3>
              <div className="space-y-3">
                {zones?.map((zone) => (
                  <div
                    key={zone?.id}
                    onClick={() => handleZoneClick(zone)}
                    className={`p-3 rounded-lg border transition-smooth cursor-pointer ${
                      selectedZone === zone?.id
                        ? 'border-primary bg-primary/10' :'border-border hover:border-primary/50 hover:bg-muted/30'
                    }`}
                  >
                    <div className="font-medium text-sm text-foreground mb-1">{zone?.name}</div>
                    <div className="text-xs text-muted-foreground mb-2">{zone?.description}</div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        <Icon name="Package" size={12} className="text-primary" />
                        <span className="text-foreground">{zone?.inventoryCount} items</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Icon name="ListTodo" size={12} className="text-warning" />
                        <span className="text-foreground">{zone?.jobsCount} jobs</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected Zone Actions */}
            {selectedZone && (
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <h3 className="text-base font-semibold text-foreground mb-4">Zone Actions</h3>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth
                    iconName="Package"
                    onClick={() => handleViewInventory(zones?.find(z => z?.id === selectedZone))}
                  >
                    View Inventory
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth
                    iconName="ListTodo"
                    onClick={() => handleViewJobs(zones?.find(z => z?.id === selectedZone))}
                  >
                    View Jobs
                  </Button>
                </div>
              </div>
            )}

            {/* Controls Info */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <h3 className="text-base font-semibold text-foreground mb-3">Controls</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Icon name="MousePointer" size={14} />
                  <span>Click zones to select</span>
                </div>
                <div className="flex items-center gap-2">
                  <Icon name="Move" size={14} />
                  <span>Drag to pan</span>
                </div>
                <div className="flex items-center gap-2">
                  <Icon name="ZoomIn" size={14} />
                  <span>Use controls to zoom</span>
                </div>
              </div>
            </div>
          </div>

          {/* Blueprint Canvas */}
          <div className="col-span-3">
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden relative" style={{ height: '700px' }}>
              {/* Zoom Controls */}
              <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
                <button
                  onClick={handleZoomIn}
                  className="w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center hover:bg-muted transition-smooth shadow-md"
                  title="Zoom In"
                >
                  <Icon name="ZoomIn" size={20} className="text-foreground" />
                </button>
                <button
                  onClick={handleZoomOut}
                  className="w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center hover:bg-muted transition-smooth shadow-md"
                  title="Zoom Out"
                >
                  <Icon name="ZoomOut" size={20} className="text-foreground" />
                </button>
                <button
                  onClick={handleResetView}
                  className="w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center hover:bg-muted transition-smooth shadow-md"
                  title="Reset View"
                >
                  <Icon name="Maximize2" size={20} className="text-foreground" />
                </button>
              </div>

              {/* Canvas */}
              <div
                ref={canvasRef}
                className="w-full h-full overflow-hidden relative"
                onMouseDown={handleMouseDown}
                style={{
                  cursor: isDragging ? 'grabbing' : 'grab'
                }}
              >
                <div
                  style={{
                    transform: `scale(${zoomLevel}) translate(${panPosition?.x / zoomLevel}px, ${panPosition?.y / zoomLevel}px)`,
                    transformOrigin: 'center center',
                    transition: isDragging ? 'none' : 'transform 0.25s ease-out',
                    width: '100%',
                    height: '100%',
                    position: 'relative'
                  }}
                >
                  {/* Blueprint Image */}
                  <div className="absolute inset-0 flex items-center justify-center blueprint-image">
                    <Image
                      src="/assets/images/yacht_blueprint-1767558683418.png"
                      alt="Holographic yacht blueprint with technical wireframe overlay"
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* Interactive Zones */}
                  {zones?.map((zone) => (
                    <div
                      key={zone?.id}
                      className="absolute cursor-pointer transition-all duration-200"
                      style={{
                        left: `${zone?.position?.x}%`,
                        top: `${zone?.position?.y}%`,
                        width: `${zone?.position?.width}%`,
                        height: `${zone?.position?.height}%`,
                        backgroundColor:
                          selectedZone === zone?.id
                            ? 'rgba(59, 130, 246, 0.25)'
                            : hoveredZone === zone?.id
                            ? 'rgba(59, 130, 246, 0.15)'
                            : 'transparent',
                        border:
                          selectedZone === zone?.id || hoveredZone === zone?.id
                            ? '2px solid rgba(59, 130, 246, 0.5)'
                            : '1px solid transparent',
                        boxShadow:
                          selectedZone === zone?.id || hoveredZone === zone?.id
                            ? '0 0 20px rgba(59, 130, 246, 0.4), inset 0 0 20px rgba(59, 130, 246, 0.2)'
                            : 'none'
                      }}
                      onMouseEnter={() => setHoveredZone(zone?.id)}
                      onMouseLeave={() => setHoveredZone(null)}
                      onClick={(e) => {
                        e?.stopPropagation();
                        handleZoneClick(zone);
                      }}
                    >
                      {(hoveredZone === zone?.id || selectedZone === zone?.id) && (
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-card/95 rounded-lg p-3 shadow-lg border border-primary/30 pointer-events-none">
                          <div className="text-sm font-semibold text-foreground whitespace-nowrap">{zone?.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {zone?.inventoryCount} items • {zone?.jobsCount} jobs
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div className="absolute bottom-4 left-4 bg-card/95 rounded-lg px-4 py-3 shadow-md border border-border">
                <div className="text-xs font-semibold text-foreground mb-2">Interactive Zones</div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded border-2 border-primary/50 bg-primary/15" />
                    <span>Hover to preview</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded border-2 border-primary bg-primary/25" />
                    <span>Click to select</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default BlueprintVesselView;