import { useEffect, useRef, useState } from 'react';

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const allSelected = options.length > 0 && selected.length === options.length;
  const summary =
    selected.length === 0 ? 'None' : allSelected ? 'All' : `${selected.length} of ${options.length}`;

  function toggle(opt: string) {
    if (selected.includes(opt)) onChange(selected.filter((o) => o !== opt));
    else onChange([...selected, opt]);
  }
  function toggleAll() {
    onChange(allSelected ? [] : [...options]);
  }

  return (
    <div className="ms" ref={ref}>
      <span className="ms-label">{label}</span>
      <button type="button" className="ms-btn" onClick={() => setOpen((o) => !o)}>
        <span className="ms-summary">{summary}</span>
        <span className="ms-caret">▾</span>
      </button>
      {open && (
        <div className="ms-panel">
          <div className="ms-allrow">
            <label className="ms-opt ms-all">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} /> All
            </label>
            <button type="button" className="ms-none-btn" onClick={() => onChange([])} title="Deselect everything">
              None
            </button>
          </div>
          <div className="ms-divider" />
          <div className="ms-scroll">
            {options.map((opt) => (
              <label key={opt} className="ms-opt">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} /> {opt}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
