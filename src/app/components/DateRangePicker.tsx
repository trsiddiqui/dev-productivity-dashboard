'use client';

import { format, parseISO } from 'date-fns';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';

interface Props {
  from: string;
  to: string;
  disabled?: boolean;
  onChange: (value: { from: string; to: string }) => void;
  helperText?: string;
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function formatRangeLabel(range: DateRange | undefined): string {
  if (!range?.from && !range?.to) return 'Select date range';
  if (range?.from && !range?.to) return `${format(range.from, 'MMM d, yyyy')} -> Pick end date`;
  if (range?.from && range?.to) return `${format(range.from, 'MMM d, yyyy')} -> ${format(range.to, 'MMM d, yyyy')}`;
  return 'Select date range';
}

export function DateRangePicker({ from, to, disabled = false, onChange, helperText }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const committedRange = useMemo<DateRange | undefined>(() => ({
    from: parseDate(from),
    to: parseDate(to),
  }), [from, to]);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(committedRange);
  const [month, setMonth] = useState<Date>(committedRange?.from ?? new Date());

  useEffect(() => {
    setDraftRange(committedRange);
    setMonth(committedRange?.from ?? new Date());
  }, [committedRange]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setDraftRange(committedRange);
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setDraftRange(committedRange);
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [committedRange, isOpen]);

  function handleSelect(_: DateRange | undefined, triggerDate: Date): void {
    if (!draftRange?.from || draftRange.to) {
      setDraftRange({ from: triggerDate, to: undefined });
      setMonth(triggerDate);
      return;
    }

    const nextRange = triggerDate < draftRange.from
      ? { from: triggerDate, to: draftRange.from }
      : { from: draftRange.from, to: triggerDate };

    setDraftRange(nextRange);
    if (nextRange.from && nextRange.to) {
      onChange({
        from: format(nextRange.from, 'yyyy-MM-dd'),
        to: format(nextRange.to, 'yyyy-MM-dd'),
      });
      setIsOpen(false);
    }
  }

  return (
    <div ref={rootRef}>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Date range</label>
      <div style={{ position: 'relative' }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (disabled) return;
            setDraftRange(undefined);
            setMonth(committedRange?.from ?? new Date());
            setIsOpen((current) => !current);
          }}
          disabled={disabled}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--panel-br)',
            background: 'var(--card-bg)',
            color: 'var(--card-fg)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.7 : 1,
          }}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <CalendarDays size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {formatRangeLabel(isOpen ? draftRange : committedRange)}
            </span>
          </span>
          <ChevronDown size={16} style={{ flexShrink: 0, opacity: 0.8 }} />
        </button>

        {isOpen ? (
          <div
            role="dialog"
            aria-label="Choose date range"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              zIndex: 20,
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-br)',
              borderRadius: 14,
              padding: 14,
              boxShadow: '0 22px 44px rgba(15,23,42,0.34)',
              width: 'min(100%, 720px)',
              minWidth: 300,
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 10 }}>
              Pick a start date, then an end date.
            </div>
            <DayPicker
              animate
              mode="range"
              selected={draftRange}
              onSelect={handleSelect}
              month={month}
              onMonthChange={setMonth}
              numberOfMonths={1}
              className="dashboard-date-range-picker"
            />
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--panel-muted)' }}>
              {formatRangeLabel(draftRange)}
            </div>
          </div>
        ) : null}
      </div>
      {helperText ? (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--panel-muted)' }}>{helperText}</div>
      ) : null}
    </div>
  );
}
