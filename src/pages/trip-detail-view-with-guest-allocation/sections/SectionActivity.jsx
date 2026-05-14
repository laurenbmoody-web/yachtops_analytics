import React from 'react';
import SectionCard, { PlaceholderNote } from './_SectionCard';

export default function SectionActivity() {
  return (
    <SectionCard accent="navy" lead="The " italic="activity log.">
      <PlaceholderNote>Activity log content coming in a later phase.</PlaceholderNote>
    </SectionCard>
  );
}
