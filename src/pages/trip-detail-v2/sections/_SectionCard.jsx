import React from 'react';

/**
 * Shared scaffold for a trip-detail-v2 section card.
 *
 * - Wraps content in `.p-card` with the top-border accent (`navy`, `accent`,
 *   `brass`) — these classes already exist in pantry.css under the
 *   `.editorial-page` token scope.
 * - Renders an editorial section headline in DM Serif Display where
 *   `lead` is the plain leading text and `italic` is the italic terracotta
 *   tail. The italic span includes the trailing period — readers see it as
 *   one italic phrase ending the line.
 * - Adds vertical rhythm between sections.
 */
export default function SectionCard({ accent = 'navy', lead = '', italic = '', children }) {
  const accentClass =
    accent === 'accent' ? 'top-accent' :
    accent === 'brass'  ? 'top-brass'  :
                          'top-navy';

  return (
    <section className={`p-card ${accentClass}`} style={{ marginBottom: 20 }}>
      <h2 className="p-card-headline">
        {lead}
        <em>{italic}</em>
      </h2>
      <div style={{ marginTop: 14 }}>
        {children}
      </div>
    </section>
  );
}

export function PlaceholderNote({ children }) {
  return (
    <p style={{
      fontFamily: 'var(--font-sans)',
      fontStyle: 'italic',
      fontSize: 12,
      color: 'var(--ink-muted)',
      margin: 0,
    }}>
      {children}
    </p>
  );
}
