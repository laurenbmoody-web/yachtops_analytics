// Branded placeholder for a scan without a poster frame yet — the dotted
// splat motif (terracotta + soft blue), so a "scanned but no still" card reads
// as a scan rather than an empty box. Real posters backfill on map view.
import React from 'react';

export default function ScanMotif({ className = '' }) {
  return (
    <svg className={`scan-motif ${className}`} viewBox="0 0 80 50" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <g fill="#C65A1A">
        <circle cx="30" cy="16" r="2" opacity="0.7" /><circle cx="44" cy="23" r="1.7" opacity="0.5" />
        <circle cx="36" cy="31" r="1.8" opacity="0.55" /><circle cx="53" cy="16" r="1.4" opacity="0.4" />
        <circle cx="50" cy="33" r="1.5" opacity="0.45" /><circle cx="24" cy="26" r="1.3" opacity="0.35" />
      </g>
      <g fill="#8FA0C6">
        <circle cx="40" cy="12" r="1.1" opacity="0.4" /><circle cx="58" cy="26" r="1" opacity="0.3" />
        <circle cx="28" cy="37" r="1" opacity="0.28" />
      </g>
    </svg>
  );
}
