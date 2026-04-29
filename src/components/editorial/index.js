// Cargo's editorial design language — shared page shell + primitives.
//
// Migrated from src/pages/pantry/widgets in Sprint 9c.1. The Pantry-side
// names (StandbyLayoutHeader, ContextBar, PageGreeting) live on as
// re-export shims for now and will be removed in a follow-up cleanup
// commit once we've verified nothing depends on the old paths.

export { default as EditorialPageShell } from './EditorialPageShell';
export { default as EditorialMetaStrip } from './EditorialMetaStrip';
export { default as EditorialHeadline } from './EditorialHeadline';
export { default as EditorialTabNav } from './EditorialTabNav';
