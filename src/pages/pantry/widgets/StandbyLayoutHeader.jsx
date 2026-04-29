// Re-export shim — this widget was renamed to EditorialPageShell in
// Sprint 9c.1 and relocated to src/components/editorial/.
//
// Left here as a back-compat alias for any references the rename grep
// missed (dynamic imports, string-based references, etc.). Slated for
// deletion in a follow-up cleanup commit once the codebase is confirmed
// to no longer reference this path.
export { default } from '../../../components/editorial/EditorialPageShell';
