import React from 'react';
import SectionCard, { PlaceholderNote } from './_SectionCard';

export default function SectionRoute() {
  return (
    <SectionCard accent="navy" lead="The " italic="route.">
      <PlaceholderNote>Route content coming in a later phase.</PlaceholderNote>
    </SectionCard>
  );
}
