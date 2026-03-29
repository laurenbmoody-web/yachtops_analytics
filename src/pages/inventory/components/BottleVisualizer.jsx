import { useState, useRef, useEffect } from 'react';

// Exact bottle SVG paths extracted from the design asset
const BOTTLE_PATH = `
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
`;

// The wave calculation constant: viewBox height is 712, fill height ≈ 647px
const FILL_CONSTANT = 6.47;

/**
 * BottleVisualizer
 *
 * @param {number}   value     – fill level 0–1 (e.g. 0.64 = 64%)
 * @param {function} onChange  – called with new 0–1 value while dragging
 * @param {number}   size      – rendered width in px (height scales proportionally, default 200)
 */
const BottleVisualizer = ({ value = 0, onChange, size = 200 }) => {
  // Work in 0-100 internally to match the wave math from the design asset
  const fillLevel = Math.max(0, Math.min(100, (value ?? 0) * 100));

  const [isDragging, setIsDragging] = useState(false);
  const [waveAmplitude, setWaveAmplitude] = useState(0);
  const [waveOffset, setWaveOffset] = useState(0);
  const containerRef = useRef(null);
  const animationRef = useRef(null);

  const updateFillFromClientY = (clientY) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const bottleTop = rect.top + (rect.height * (80 / 520));   // proportional to viewBox
    const bottleBottom = rect.bottom - (rect.height * (32 / 520));
    const bottleHeight = bottleBottom - bottleTop;
    const relativeY = clientY - bottleTop;
    const pct = Math.max(0, Math.min(100, ((bottleHeight - relativeY) / bottleHeight) * 100));
    onChange?.(pct / 100);
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setWaveAmplitude(15);
    updateFillFromClientY(e.clientY);
  };

  // Touch support
  const handleTouchStart = (e) => {
    setIsDragging(true);
    setWaveAmplitude(15);
    updateFillFromClientY(e.touches[0].clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e) => { updateFillFromClientY(e.clientY); setWaveAmplitude(15); };
    const onMouseUp = () => setIsDragging(false);
    const onTouchMove = (e) => { updateFillFromClientY(e.touches[0].clientY); setWaveAmplitude(15); };
    const onTouchEnd = () => setIsDragging(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDragging, onChange]);

  // Wave animation loop — advances offset, settles amplitude when not dragging
  useEffect(() => {
    const animate = () => {
      setWaveOffset((prev) => (prev + 0.08) % (Math.PI * 2));
      if (!isDragging) {
        setWaveAmplitude((prev) => Math.max(0, prev - 0.3));
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isDragging]);

  // Build the animated wave path — fills from waveY down to the bottom of the viewBox
  const generateWavePath = (y) => {
    const points = [];
    const width = 550;
    const segments = 20;
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * width;
      const waveY = y - Math.sin(waveOffset + (i / segments) * Math.PI * 4) * waveAmplitude;
      points.push(`${i === 0 ? 'M' : 'L'} ${x},${waveY}`);
    }
    points.push(`L ${width},712`, `L 0,712`, 'Z');
    return points.join(' ');
  };

  const waveY = 712 - fillLevel * FILL_CONSTANT;
  const pct = Math.round(fillLevel);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
      <svg
        ref={containerRef}
        width={size}
        height={size * (520 / 400)}
        viewBox="0 0 550 712"
        style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <defs>
          <clipPath id="bottleClipViz">
            <path d={BOTTLE_PATH} />
          </clipPath>
          <linearGradient id="wineGradientViz" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#8B1538', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: '#5A0E28', stopOpacity: 1 }} />
          </linearGradient>
        </defs>

        {/* Liquid fill — clipped to bottle interior */}
        <g clipPath="url(#bottleClipViz)">
          <path d={generateWavePath(waveY)} fill="url(#wineGradientViz)" />
        </g>

        {/* Bottle outline */}
        <path
          fill="none"
          stroke="#1E293B"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
          d={BOTTLE_PATH}
        />
      </svg>

      <div style={{ marginTop: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: fillLevel > 0 ? '#1E3A5F' : '#94A3B8', lineHeight: 1, letterSpacing: '-0.5px' }}>
          {pct}%
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 3 }}>
          {fillLevel === 0 ? 'Empty — drag to set' : fillLevel >= 100 ? 'Full bottle' : 'Drag to adjust'}
        </div>
      </div>
    </div>
  );
};

export default BottleVisualizer;
