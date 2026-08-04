import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';

// A "⋯" overflow menu for less-frequent toolbar actions (manage wardrobes,
// archived, export) so the main bar stays uncluttered. Each item:
// { node, label, onClick, active?, danger?, show? }.
const ToolMenu = ({ items = [] }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const shown = items.filter((i) => i && i.show !== false);
  if (!shown.length) return null;
  const anyActive = shown.some((i) => i.active);

  return (
    <div className="ow-toolmenu" ref={ref}>
      <button type="button" className={`ow-btn ghost ow-iconbtn${anyActive ? ' on' : ''}`} title="More" aria-label="More actions" onClick={() => setOpen((o) => !o)}>
        <Icon name="MoreHorizontal" size={18} />
      </button>
      {open && (
        <div className="ow-toolmenu-pop">
          {shown.map((it, i) => (
            <button type="button" key={i} className={`ow-toolmenu-item${it.active ? ' on' : ''}${it.danger ? ' danger' : ''}`} onClick={() => { setOpen(false); it.onClick?.(); }}>
              {it.node}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolMenu;
