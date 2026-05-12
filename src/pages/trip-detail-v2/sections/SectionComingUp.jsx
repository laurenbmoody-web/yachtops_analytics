import React from 'react';
import SectionCard, { PlaceholderNote } from './_SectionCard';

export default function SectionComingUp() {
  return (
    <SectionCard accent="accent" lead="What's coming " italic="up.">
      <PlaceholderNote>Coming up content coming in a later phase.</PlaceholderNote>
    </SectionCard>
  );
}
