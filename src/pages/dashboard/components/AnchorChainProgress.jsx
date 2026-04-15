import React, { useEffect, useRef } from 'react';
import webmSrc from '../../../assets/anchor-chain.webm';
import mp4Src  from '../../../assets/anchor-chain.mp4';

const CLIP_DURATION = 5.80; // seconds — matches the Hera export

const AnchorChainProgress = ({ percent = 0 }) => {
  const videoRef = useRef(null);
  const safePercent = Math.max(0, Math.min(100, percent));

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const target = (safePercent / 100) * CLIP_DURATION;
    const seek = () => { try { v.currentTime = target; } catch (_) {} };
    if (v.readyState >= 1) seek();
    else v.addEventListener('loadedmetadata', seek, { once: true });
  }, [safePercent]);

  return (
    <div
      style={{ width: 100, height: 240, position: 'relative', pointerEvents: 'none' }}
      aria-label={`Onboarding ${Math.round(safePercent)}% — anchor dropping`}
      role="img"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      >
        <source src={mp4Src}  type='video/mp4; codecs="avc1"' />
        <source src={webmSrc} type="video/webm" />
      </video>
    </div>
  );
};

export default AnchorChainProgress;
