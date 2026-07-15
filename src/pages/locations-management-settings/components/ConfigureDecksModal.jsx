import React, { useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import { createDeck, updateDeck, archiveDeck } from '../utils/locationsHierarchyStorage';

// Configure the vessel's decks — the top tier of the location tree. Lists the
// decks with rename / archive, plus an "Add deck". Zones and spaces are managed
// inline on the gallery under each deck; this modal is just the deck list.
const INK = '#1C1B3A';
const TERRA = '#C65A1A';
const MUTED = '#6B7280';
const HAIR = '#F0F1F5';
const FIELD = '#FAFAF8';

export default function ConfigureDecksModal({ decks = [], onChanged, onClose }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(null); // deck id
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await onChanged?.(); return true; }
    catch (err) { setError(err?.message || 'Something went wrong.'); return false; }
    finally { setBusy(false); }
  };

  const addDeck = async () => {
    const v = newName.trim();
    if (!v) return;
    if (await run(() => createDeck(v))) { setNewName(''); setAdding(false); }
  };
  const saveRename = async () => {
    const v = renameName.trim();
    if (!v || !renameId) return;
    if (await run(() => updateDeck(renameId, v))) { setRenameId(null); setRenameName(''); }
  };
  const doArchive = async (id) => {
    if (await run(() => archiveDeck(id))) setConfirmArchive(null);
  };

  const iconBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 999, background: 'none', border: 0, color: MUTED, cursor: 'pointer' };
  const linkBtn = { background: 'none', border: 0, padding: 0, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
  const field = { flex: 1, fontSize: 13.5, color: INK, background: '#fff', border: '1px solid #E8E6DF', borderRadius: 8, padding: '8px 10px', outline: 'none' };
  const primary = { fontSize: 12.5, fontWeight: 600, color: '#fff', background: TERRA, border: 0, borderRadius: 8, padding: '8px 14px', cursor: 'pointer' };
  const ghost = { fontSize: 12.5, fontWeight: 500, color: MUTED, background: '#F0F1F5', border: 0, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' };

  return (
    <ModalShell
      onClose={onClose}
      panelClassName="w-full max-w-md flex flex-col"
      panelStyle={{ maxHeight: '80vh', background: '#fff', borderRadius: 16, border: '1px solid #ECEAE3', boxShadow: '0 24px 60px -16px rgba(28,27,58,0.32)', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #ECEAE3', flexShrink: 0 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: INK, margin: 0 }}>Configure decks</h3>
        <button onClick={onClose} style={iconBtn} aria-label="Close">×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 4px' }}>
        {decks.length === 0 && !adding && (
          <p style={{ padding: '22px 12px', textAlign: 'center', fontSize: 13, color: MUTED, margin: 0 }}>No decks yet — add your first below.</p>
        )}

        {decks.map((deck) => (
          <div key={deck.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', borderBottom: `1px solid ${HAIR}` }}>
            {renameId === deck.id ? (
              <>
                <input
                  autoFocus value={renameName} onChange={(e) => setRenameName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenameId(null); }}
                  style={field}
                />
                <button onClick={saveRename} disabled={busy} style={primary}>Save</button>
                <button onClick={() => setRenameId(null)} disabled={busy} style={ghost}>Cancel</button>
              </>
            ) : confirmArchive === deck.id ? (
              <>
                <span style={{ flex: 1, fontSize: 13.5, color: INK }}>Archive <strong>{deck.name}</strong> and everything in it?</span>
                <button onClick={() => doArchive(deck.id)} disabled={busy} style={{ ...primary, background: '#A32D2D' }}>Archive</button>
                <button onClick={() => setConfirmArchive(null)} disabled={busy} style={ghost}>Keep</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.name}</span>
                <button onClick={() => { setRenameId(deck.id); setRenameName(deck.name); }} style={{ ...linkBtn, color: TERRA }}>Rename</button>
                <button onClick={() => setConfirmArchive(deck.id)} style={{ ...linkBtn, color: '#A32D2D' }}>Archive</button>
              </>
            )}
          </div>
        ))}

        {adding ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 10px' }}>
            <input
              autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addDeck(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
              placeholder="Deck name — e.g. Bridge Deck" style={field}
            />
            <button onClick={addDeck} disabled={busy} style={primary}>{busy ? 'Adding…' : 'Add'}</button>
            <button onClick={() => { setAdding(false); setNewName(''); }} disabled={busy} style={ghost}>Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 6px 4px', width: 'calc(100% - 12px)', fontSize: 13.5, fontWeight: 600, color: TERRA, background: FIELD, border: `1px dashed ${TERRA}55`, borderRadius: 12, padding: '12px', cursor: 'pointer' }}
          >
            ＋ Add deck
          </button>
        )}

        {error && <p style={{ padding: '4px 12px 10px', margin: 0, fontSize: 12, color: '#B91C1C' }}>{error}</p>}
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid #ECEAE3', flexShrink: 0 }}>
        <button onClick={onClose} style={{ width: '100%', ...ghost, background: 'none', color: MUTED, padding: '8px 0' }}>Done</button>
      </div>
    </ModalShell>
  );
}
