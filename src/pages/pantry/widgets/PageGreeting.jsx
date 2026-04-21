import React from 'react';

// v1: always STANDBY. Meal preset pages will pass activeService.
export default function PageGreeting({ activeService = null, firstName = null, subtitle = null }) {
  const greetingWord = activeService
    ? activeService.toUpperCase()
    : 'STANDBY';

  const defaultSubtitle = `${firstName ? `Morning, ${firstName}. ` : ''}Here's what's on across the boat right now.`;

  return (
    <>
      <h1 className="p-greeting">
        {greetingWord}<span className="p-greeting-punctuation">,</span>{' '}
        <em>Interior</em><span className="p-greeting-punctuation">.</span>
      </h1>
      <p style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        color: 'var(--ink-muted)',
        margin: '0 0 0',
        fontWeight: 400,
      }}>
        {subtitle ?? defaultSubtitle}
      </p>
    </>
  );
}
