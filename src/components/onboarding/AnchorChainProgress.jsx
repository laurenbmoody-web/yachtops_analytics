import React from 'react';
import anchorChainSvg from '../../assets/anchor-chain.svg?raw';

/**
 * AnchorChainProgress — pure SVG, no video.
 *
 * Drives #Rig's vertical drop from `percent`. A secondary #Rig-inner
 * wrapper handles a continuous gentle pendulum wobble so the chain looks
 * physically alive as it drops. Pivot is at top-center (where the chain
 * anchors to the "ceiling").
 *
 * SVG ships at src/assets/anchor-chain.svg. The ?raw Vite suffix imports
 * file contents as a string.
 */
const MAX_DROP = 140; // viewBox units — tune to taste

function prepare(raw) {
  const styleBlock = `<style>
    svg { width: 100%; height: 100%; display: block; }
    #Rig {
      transform: translateY(var(--cg-drop, 0));
      transition: transform 1400ms cubic-bezier(0.22, 1.2, 0.36, 1);
      transform-origin: 50% 0%;
      transform-box: view-box;
    }
    #Rig path {
      transform-box: fill-box;
      transform-origin: center;
      animation: cg-link-sway 2.6s ease-in-out infinite;
    }
    #Rig #Vector_10 { animation-delay: 0ms; }
    #Rig #Vector_7 { animation-delay: 60ms; }
    #Rig #Vector_3 { animation-delay: 120ms; }
    #Rig #Vector_5 { animation-delay: 180ms; }
    #Rig #Vector_6 { animation-delay: 240ms; }
    #Rig #Vector_4 { animation-delay: 300ms; }
    #Rig #Vector_2 { animation-delay: 360ms; }
    #Rig #Vector_8 { animation-delay: 420ms; }
    #Rig #Vector_9 { animation-delay: 480ms; }
    #Rig #Vector { animation: cg-anchor-sway 2.6s ease-in-out infinite; animation-delay: 540ms; transform-origin: center top; }
    @keyframes cg-link-sway { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
    @keyframes cg-anchor-sway { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
  </style>`;
  const stripped = raw.replace(/<svg[^>]*>/, '<svg viewBox="0 0 309 988" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMin meet">');
  return stripped.replace(/<svg([^>]*)>/, `<svg$1>${styleBlock}`);
}

const PREPARED = prepare(anchorChainSvg);

const AnchorChainProgress = ({ percent = 0, width = 100, height = 240 }) => {
  const p = Math.max(0, Math.min(100, percent));
  const drop = (p / 100) * MAX_DROP;

  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: 'none',
        ['--cg-drop']: `${drop}px`,
      }}
      role="img"
      aria-label={`Onboarding ${Math.round(p)}% — anchor dropping`}
      dangerouslySetInnerHTML={{ __html: PREPARED }}
    />
  );
};

export default AnchorChainProgress;
