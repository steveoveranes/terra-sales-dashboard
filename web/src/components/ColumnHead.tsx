import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One column header: label + a 3-state sort button (asc -> desc -> none) + a
// filter button that opens a floating menu (rendered with fixed positioning so it
// escapes the scrolling table body). The menu content is supplied by the parent.
export default function ColumnHead({
  label,
  numeric = false,
  sortDir,
  onCycleSort,
  filterActive,
  renderMenu,
  extra,
}: {
  label: string;
  numeric?: boolean;
  sortDir: 'asc' | 'desc' | null;
  onCycleSort: () => void;
  filterActive: boolean;
  renderMenu: () => ReactNode;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScroll() {
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current!.getBoundingClientRect();
    const width = 250;
    let x = r.left;
    if (x + width > window.innerWidth - 8) x = window.innerWidth - 8 - width;
    setPos({ x: Math.max(8, x), y: r.bottom + 4 });
    setOpen(true);
  }

  return (
    <div className={'th-cell' + (numeric ? ' num' : '')}>
      {extra}
      <span className="th-label">{label}</span>
      <button
        type="button"
        className={'hdr-sort' + (sortDir ? ' active' : '')}
        title="Sort (ascending / descending / off)"
        aria-label="Sort"
        onClick={onCycleSort}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
          <path d="M4 0.5 L7.5 4.5 L0.5 4.5 Z" fill="currentColor" opacity={sortDir === 'asc' ? 1 : 0.38} />
          <path d="M4 11.5 L7.5 7.5 L0.5 7.5 Z" fill="currentColor" opacity={sortDir === 'desc' ? 1 : 0.38} />
        </svg>
      </button>
      <button
        ref={btnRef}
        type="button"
        className={'hdr-filter' + (filterActive ? ' active' : '')}
        title="Filter"
        aria-label="Filter"
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M3 5h18l-7 8v5l-4 2v-7z" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className="col-menu" ref={menuRef} style={{ left: pos.x, top: pos.y }}>
            <div className="col-menu-head">
              <span className="col-menu-title">{label}</span>
              <button type="button" className="cl-close" onClick={() => setOpen(false)} title="Close" aria-label="Close">
                ×
              </button>
            </div>
            {renderMenu()}
          </div>,
          document.body
        )}
    </div>
  );
}
