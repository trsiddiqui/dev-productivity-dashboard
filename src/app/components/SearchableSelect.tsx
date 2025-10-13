'use client';

import React, {JSX, useEffect, useId, useMemo, useRef, useState} from 'react';

export interface Option {
  value: string;
  label: string;
  iconUrl?: string;
  subtitle?: string;
}

interface SearchableSelectProps {
  items: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyHint?: string;
}

export function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = 'Search…',
  disabled = false,
  emptyHint = 'No matches',
}: SearchableSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState<string>('');
  const [highlight, setHighlight] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const id = useId();

  const selected = useMemo(
    () => items.find(i => i.value === value) ?? null,
    [items, value]
  );

  // Keep input displaying the selected label when closed
  useEffect(() => {
    if (!open) setInputValue(selected?.label ?? '');
  }, [open, selected]);

  // Click outside to close
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
      [i.label, i.subtitle, i.value]
        .filter(Boolean)
        .some(s => (s as string).toLowerCase().includes(q))
    );
  }, [items, inputValue]);

  function selectIndex(idx: number) {
    const opt = filtered[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      setHighlight(0);
      e.preventDefault();
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      setHighlight(h => Math.min((h < 0 ? -1 : h) + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlight(h => Math.max(h - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (highlight >= 0) selectIndex(highlight);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        id={`searchable-${id}`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`list-${id}`}
        aria-autocomplete="list"
        disabled={disabled}
        value={open ? inputValue : (selected?.label ?? '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setHighlight(0); }}
        onChange={e => { setInputValue(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #ddd',
          background: disabled ? 'grey' : 'black'
        }}
      />

      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 6,
            background: 'white',
            border: '1px solid #e5e5e5',
            borderRadius: 10,
            boxShadow: '0 8px 18px rgba(0,0,0,0.08)',
            maxHeight: 280,
            overflow: 'auto'
          }}
        >
          <ul id={`list-${id}`} ref={listRef} role="listbox" aria-labelledby={`searchable-${id}`} style={{ listStyle: 'none', margin: 0, padding: 6 }}>
            {filtered.length === 0 && (
              <li style={{ padding: '10px 12px', color: '#666' }}>{emptyHint}</li>
            )}
            {filtered.map((opt, idx) => {
              const active = idx === highlight;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={active}
                  data-index={idx}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => { e.preventDefault(); selectIndex(idx); }}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: active ? 'grey' : 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  {opt.iconUrl ? (
                    <img src={opt.iconUrl} alt="" width={20} height={20} style={{ borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#e5e7eb' }} />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14, color: '#111' }}>{opt.label}</span>
                    {opt.subtitle && <span style={{ fontSize: 12, color: '#6b7280' }}>{opt.subtitle}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
