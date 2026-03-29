import { useState, useRef, useEffect } from 'react';

export default function App() {
  const [fillLevel, setFillLevel] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [waveAmplitude, setWaveAmplitude] = useState(0);
  const [waveOffset, setWaveOffset] = useState(0);
  const containerRef = useRef<SVGSVGElement>(null);
  const animationRef = useRef<number | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setWaveAmplitude(15);
    updateFillLevel(e.clientY);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      updateFillLevel(e.clientY);
      setWaveAmplitude(15);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const updateFillLevel = (clientY: number) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const bottleTop = rect.top + 80;
      const bottleBottom = rect.bottom - 32;
      const bottleHeight = bottleBottom - bottleTop;

      const relativeY = clientY - bottleTop;
      const percentage = Math.max(0, Math.min(100, ((bottleHeight - relativeY) / bottleHeight) * 100));

      setFillLevel(percentage);
    }
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  // Wave animation loop
  useEffect(() => {
    const animate = () => {
      setWaveOffset((prev) => (prev + 0.08) % (Math.PI * 2));

      // Gradually reduce wave amplitude when not dragging
      if (!isDragging) {
        setWaveAmplitude((prev) => Math.max(0, prev - 0.3));
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isDragging]);

  // Generate wave path
  const generateWavePath = (y: number) => {
    const points: string[] = [];
    const width = 550;
    const segments = 20;

    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * width;
      const waveY = y - Math.sin(waveOffset + (i / segments) * Math.PI * 4) * waveAmplitude;
      points.push(`${i === 0 ? 'M' : 'L'} ${x},${waveY}`);
    }

    // Complete the path to fill the liquid area
    points.push(`L ${width},712`);
    points.push(`L 0,712`);
    points.push('Z');

    return points.join(' ');
  };

  return (
    <div className="size-full flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <svg
          ref={containerRef}
          width="400"
          height="520"
          viewBox="0 0 550 712"
          className="cursor-pointer select-none"
          onMouseDown={handleMouseDown}
        >
          <defs>
            {/* Clip path matching the bottle interior - using exact path */}
            <clipPath id="bottleClip">
              <path d="
                M256.500000,33.500000
                C254.177948,34.689217 251.450577,34.996887 249.481888,36.982040
                C247.114868,39.368866 245.222580,41.896118 245.486679,45.500977
                C245.571686,46.661415 246.003860,48.357655 245.420990,48.917789
                C240.346329,53.794483 243.140793,59.944759 242.552521,65.505554
                C242.229202,68.561691 241.955978,71.777351 244.981262,74.025215
                C246.169785,74.908302 245.465149,76.347290 245.466431,77.500038
                C245.507294,113.999992 245.905502,150.506622 245.309860,186.996902
                C245.054688,202.629364 240.861374,217.256454 229.134369,229.132690
                C220.392365,237.985962 211.659348,247.081482 205.980667,258.490387
                C199.857635,270.791992 196.412613,283.596161 196.428284,297.500092
                C196.555832,410.666595 196.446152,523.833374 196.547760,636.999939
                C196.566910,658.331665 208.733322,671.133301 226.513275,676.455688
                C236.260849,679.373657 246.294662,680.236145 256.490814,680.701416
                C266.664978,681.165649 276.873840,682.098511 286.987793,681.337585
                C300.370789,680.330872 313.949615,680.826111 327.020294,676.562195
                C343.389740,671.221985 353.303253,660.209229 356.297821,643.463867
                C357.129974,638.810730 357.448120,633.829956 357.450989,629.000000
                C357.515015,521.666687 357.625519,414.333069 357.379974,307.000275
                C357.337616,288.487122 355.002655,270.236450 344.578796,253.949585
                C338.308380,244.152344 330.163055,236.051300 322.466492,227.530258
                C315.445801,219.757477 311.263397,210.793762 309.443512,200.509995
                C307.887299,191.716095 307.446808,182.901108 307.468964,173.999924
                C307.548248,142.166794 307.489014,110.333321 307.534637,78.500053
                C307.536774,77.011375 307.074799,75.505875 307.966675,73.980515
                C311.603912,67.760124 311.614624,55.807190 307.948883,50.032459
                C307.262726,48.951607 307.570435,47.994488 307.527344,46.998817
                C307.148041,38.229153 302.319794,33.525887 293.500000,33.506649
                C281.333374,33.480118 269.166656,33.500000 257.000000,33.500000
              " />
            </clipPath>

            {/* Gradient for wine */}
            <linearGradient id="wineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: '#8B1538', stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: '#5A0E28', stopOpacity: 1 }} />
            </linearGradient>
          </defs>

          {/* Liquid fill */}
          <g clipPath="url(#bottleClip)">
            <path
              d={generateWavePath(712 - (fillLevel * 6.47))}
              fill="url(#wineGradient)"
            />
          </g>

          {/* Bottle outline - exact path from your SVG */}
          <path
            fill="none"
            stroke="#000000"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
            d="
              M256.500000,33.500000
              C254.177948,34.689217 251.450577,34.996887 249.481888,36.982040
              C247.114868,39.368866 245.222580,41.896118 245.486679,45.500977
              C245.571686,46.661415 246.003860,48.357655 245.420990,48.917789
              C240.346329,53.794483 243.140793,59.944759 242.552521,65.505554
              C242.229202,68.561691 241.955978,71.777351 244.981262,74.025215
              C246.169785,74.908302 245.465149,76.347290 245.466431,77.500038
              C245.507294,113.999992 245.905502,150.506622 245.309860,186.996902
              C245.054688,202.629364 240.861374,217.256454 229.134369,229.132690
              C220.392365,237.985962 211.659348,247.081482 205.980667,258.490387
              C199.857635,270.791992 196.412613,283.596161 196.428284,297.500092
              C196.555832,410.666595 196.446152,523.833374 196.547760,636.999939
              C196.566910,658.331665 208.733322,671.133301 226.513275,676.455688
              C236.260849,679.373657 246.294662,680.236145 256.490814,680.701416
              C266.664978,681.165649 276.873840,682.098511 286.987793,681.337585
              C300.370789,680.330872 313.949615,680.826111 327.020294,676.562195
              C343.389740,671.221985 353.303253,660.209229 356.297821,643.463867
              C357.129974,638.810730 357.448120,633.829956 357.450989,629.000000
              C357.515015,521.666687 357.625519,414.333069 357.379974,307.000275
              C357.337616,288.487122 355.002655,270.236450 344.578796,253.949585
              C338.308380,244.152344 330.163055,236.051300 322.466492,227.530258
              C315.445801,219.757477 311.263397,210.793762 309.443512,200.509995
              C307.887299,191.716095 307.446808,182.901108 307.468964,173.999924
              C307.548248,142.166794 307.489014,110.333321 307.534637,78.500053
              C307.536774,77.011375 307.074799,75.505875 307.966675,73.980515
              C311.603912,67.760124 311.614624,55.807190 307.948883,50.032459
              C307.262726,48.951607 307.570435,47.994488 307.527344,46.998817
              C307.148041,38.229153 302.319794,33.525887 293.500000,33.506649
              C281.333374,33.480118 269.166656,33.500000 257.000000,33.500000
            "
          />
        </svg>

        <div className="text-center text-sm text-slate-600">
          Click and drag to fill: {Math.round(fillLevel)}%
        </div>
      </div>
    </div>
  );
}
