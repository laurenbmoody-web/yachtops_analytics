import React from 'react';

/**
 * EditorialHeadline — display serif headline with the canonical
 * `WORD, *qualifier*.` pattern.
 *
 *   <EditorialHeadline title="Charter" qualifier="Bridge" subtitle="..." />
 *
 *   →   CHARTER, *Bridge*.
 *       Subtitle in muted navy below.
 *
 * `title` is uppercased automatically. `qualifier` is the italic terracotta
 * qualifier. Both are required pieces of the editorial pattern — if you
 * find yourself wanting to skip one, you probably want a different
 * component.
 *
 * Defaults to `STANDBY`/`Interior` for backwards compatibility with the
 * original Pantry PageGreeting consumers (StandbyPage and the various
 * stub pages that pass only `title` and rely on the old default).
 */
export default function EditorialHeadline({
  title = null,
  qualifier = 'Interior',
  subtitle = null,
  firstName = null,
}) {
  const headlineWord = title
    ? String(title).toUpperCase()
    : 'STANDBY';

  const defaultSubtitle = `${firstName ? `Morning, ${firstName}. ` : ''}Here's what's on across the boat right now.`;
  const subtitleText = subtitle ?? defaultSubtitle;

  return (
    <>
      <h1 className="p-greeting">
        {headlineWord}<span className="p-greeting-punctuation">,</span>{' '}
        <em>{qualifier}</em><span className="p-greeting-punctuation">.</span>
      </h1>
      {subtitleText && (
        <p style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--ink-muted)',
          margin: '0 0 0',
          fontWeight: 400,
        }}>
          {subtitleText}
        </p>
      )}
    </>
  );
}
