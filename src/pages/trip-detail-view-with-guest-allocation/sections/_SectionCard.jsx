import React from 'react';

/**
 * Shared scaffold for a trip detail section card.
 *
 * Renders a `.p-card` with a top-border accent (navy / accent / brass /
 * archived-grey), plus an optional editorial header block: caps meta
 * line + DM Serif title (with italic terracotta tail) + actions slot.
 *
 * Two title APIs:
 *   - lead/italic: simple split, terracotta italic tail (Phase 1 pattern)
 *   - titleNode: pass full JSX (used when the italic span is in the
 *     middle, e.g. "Nothing left to do." or "What's coming up.")
 */
export default function SectionCard({
  accent = 'navy',
  meta,
  lead,
  italic,
  titleNode,
  actions,
  children,
  style,
}) {
  const accentClass =
    accent === 'accent'   ? 'top-accent'   :
    accent === 'brass'    ? 'top-brass'    :
    accent === 'archived' ? 'top-archived' :
                            'top-navy';

  const hasHeader = meta || lead || italic || titleNode || actions;

  return (
    <section className={`p-card ${accentClass}`} style={{ marginBottom: 20, ...style }}>
      {hasHeader && (
        <div className="v2-card-head">
          <div>
            {meta && <div className="v2-card-meta">{meta}</div>}
            {(lead || italic || titleNode) && (
              <h2 className="v2-card-title">
                {titleNode ?? (<>{lead}<em>{italic}</em></>)}
              </h2>
            )}
          </div>
          {actions && <div className="v2-card-actions">{actions}</div>}
        </div>
      )}
      {children}
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
