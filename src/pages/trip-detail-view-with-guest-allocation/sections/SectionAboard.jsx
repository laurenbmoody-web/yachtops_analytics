import React from 'react';
import SectionCard, { PlaceholderNote } from './_SectionCard';

export default function SectionAboard() {
  return (
    <SectionCard accent="navy" lead="Aboard for " italic="this trip.">
      <PlaceholderNote>Guest manifest content coming in a later phase.</PlaceholderNote>
    </SectionCard>
  );
}
