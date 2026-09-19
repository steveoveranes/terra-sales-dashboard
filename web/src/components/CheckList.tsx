import { useState } from 'react';

// Inline checkbox filter. "All" checked = compact (panel hidden). Uncheck "All"
// to open a floating panel and pick specific values; a small × hides the panel
// again while keeping the selection. Click the label to reopen it. The panel is
// absolutely positioned so opening/closing never shifts the neighbouring filters.
export default function CheckList({
  label,
  options,
  selected,
  onChange,
  columns = 3,
  rememberedSubset,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  columns?: number;
  rememberedSubset?: string[];
}) {
  const [open, setOpen] = useState(false);
  const allSelected = options.length > 0 && selected.length === options.length;

  function toggle(opt: string) {
    if (selected.includes(opt)) onChange(selected.filter((o) => o !== opt));
    else onChange([...selected, opt]);
  }
  function toggleAll() {
    if (allSelected) {
      // turning "All" off → restore the last remembered subset (if any) and open
      const remembered = (rememberedSubset || []).filter((o) => options.includes(o));
      onChange(remembered.length ? remembered : []);
      setOpen(true);
    } else {
      onChange([...options]);
      setOpen(false);
    }
  }

  // The panel stays open as long as `open` is true — even when everything is
  // selected — so the all/none quick buttons don't close it under the user.
  const showPanel = open;

  return (
    <div className="cl">
      <div className="cl-head">
        <button
          type="button"
          className="cl-label-btn"
          onClick={() => !allSelected && setOpen((o) => !o)}
          disabled={allSelected}
          title={allSelected ? undefined : open ? 'Hide' : 'Show selection'}
        >
          <span className="cl-label">{label}</span>
          {!allSelected && <span className="cl-caret">{open ? '▴' : '▾'}</span>}
        </button>
        <label className="cl-all">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} /> All
        </label>
        <button
          type="button"
          className="cl-none-btn"
          onClick={() => {
            onChange([]);
            setOpen(true);
          }}
          title="Deselect everything"
        >
          None
        </button>
        {!allSelected && !open && <span className="cl-selcount">{selected.length}</span>}
      </div>
      {showPanel && (
        <div className="cl-panel">
          <div className="cl-panel-head">
            <div className="cl-bulk">
              <button type="button" className="cl-bulk-btn" onClick={() => onChange([...options])} title="Select all">
                all
              </button>
              <span className="cl-bulk-sep">·</span>
              <button type="button" className="cl-bulk-btn" onClick={() => onChange([])} title="Select none">
                none
              </button>
            </div>
            <button type="button" className="cl-close" onClick={() => setOpen(false)} title="Hide" aria-label="Hide">
              ×
            </button>
          </div>
          <div className="cl-grid" style={{ gridTemplateColumns: `repeat(${columns}, max-content)` }}>
            {options.map((opt) => (
              <label key={opt} className="cl-opt">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
                {opt}
              </label>
            ))}
            {options.length === 0 && <span className="subtle" style={{ fontSize: 12 }}>—</span>}
          </div>
        </div>
      )}
    </div>
  );
}
