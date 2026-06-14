"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";
import {
  combineDateTimeValue,
  currentIstDate,
  currentIstTime,
  formatDateValue,
  formatTimeValue,
  splitDateTimeValue,
} from "@/lib/app-date-time";
import { cn } from "@/lib/utils";

type CommonProps = {
  label: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

function PickerDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ui-surface-elevated max-h-[min(92dvh,680px)] w-full overflow-y-auto rounded-t-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-sm sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-xl border">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function monthValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})/);
  const fallback = currentIstDate().split("-").map(Number);
  return new Date(match ? Number(match[1]) : fallback[0], match ? Number(match[2]) - 1 : fallback[1] - 1, 1);
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function AppDatePicker({
  label,
  value,
  onChange,
  disabled,
  required,
  min,
  max,
  className,
}: CommonProps & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthValue(value));
  const today = currentIstDate();
  useEffect(() => {
    if (open) setMonth(monthValue(value || today));
  }, [open, today, value]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first);
      date.setDate(index - first.getDay() + 1);
      return { value: dateValue(date), day: date.getDate(), muted: date.getMonth() !== month.getMonth() };
    });
  }, [month]);

  return (
    <div className={className}>
      <label id={`${id}-label`} className="mb-1 block text-sm font-semibold">{label}{required ? " *" : ""}</label>
      <button
        type="button"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="ui-control flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm"
      >
        <span>{formatDateValue(value)}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
      </button>
      {open && (
        <PickerDialog title={label} onClose={() => setOpen(false)}>
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-xl border">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="font-bold">{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
            <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-xl border">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-7 text-center text-xs font-bold text-[var(--foreground-muted)]">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const blocked = Boolean((min && cell.value < min) || (max && cell.value > max));
              return (
                <button
                  key={cell.value}
                  type="button"
                  disabled={blocked}
                  aria-current={cell.value === today ? "date" : undefined}
                  aria-pressed={cell.value === value}
                  onClick={() => {
                    onChange(cell.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex aspect-square min-h-10 items-center justify-center rounded-lg border border-transparent text-sm font-semibold",
                    cell.muted && "text-[var(--foreground-muted)]",
                    cell.value === today && "border-[var(--selected-border)]",
                    cell.value === value && "ui-control-selected",
                    !blocked && cell.value !== value && "hover:bg-[var(--surface-hover)]",
                    blocked && "cursor-not-allowed opacity-35",
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
          {!required && value && (
            <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="mt-3 min-h-11 w-full rounded-lg text-sm font-semibold text-red-600">
              Clear date
            </button>
          )}
        </PickerDialog>
      )}
    </div>
  );
}

export function AppTimePicker({
  label,
  value,
  onChange,
  disabled,
  required,
  minuteStep = 5,
  className,
}: CommonProps & {
  value: string;
  onChange: (value: string) => void;
  minuteStep?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const initial = splitDateTimeValue(`2000-01-01T${value || currentIstTime()}`).time;
  const [hour, setHour] = useState(Number(initial.split(":")[0]) || 0);
  const [minute, setMinute] = useState(Number(initial.split(":")[1]) || 0);

  useEffect(() => {
    if (!open) return;
    const selected = value || currentIstTime();
    setHour(Number(selected.split(":")[0]) || 0);
    setMinute(Number(selected.split(":")[1]) || 0);
    setMode("hour");
  }, [open, value]);

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const options = mode === "hour"
    ? Array.from({ length: 12 }, (_, index) => index + 1)
    : Array.from({ length: Math.ceil(60 / minuteStep) }, (_, index) => index * minuteStep);

  return (
    <div className={className}>
      <label id={`${id}-label`} className="mb-1 block text-sm font-semibold">{label}{required ? " *" : ""}</label>
      <button type="button" aria-labelledby={`${id}-label`} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)} className="ui-control flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm">
        <span>{formatTimeValue(value)}</span>
        <Clock3 className="h-4 w-4 shrink-0 text-[var(--foreground-muted)]" />
      </button>
      {open && (
        <PickerDialog title={label} onClose={() => setOpen(false)}>
          <div className="flex items-center justify-center gap-2 text-3xl font-bold">
            <button type="button" onClick={() => setMode("hour")} className={cn("rounded-lg px-3 py-2", mode === "hour" && "ui-control-selected")}>{displayHour}</button>
            <span>:</span>
            <button type="button" onClick={() => setMode("minute")} className={cn("rounded-lg px-3 py-2", mode === "minute" && "ui-control-selected")}>{String(minute).padStart(2, "0")}</button>
          </div>
          <div className="relative mx-auto mt-4 h-64 w-64 rounded-full border bg-[var(--surface-muted)]">
            <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600" />
            {options.map((option, index) => {
              const selected = mode === "hour" ? option === displayHour : option === minute;
              const angle = (index / options.length) * Math.PI * 2 - Math.PI / 2;
              const left = 50 + Math.cos(angle) * 39;
              const top = 50 + Math.sin(angle) * 39;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (mode === "hour") {
                      setHour((period === "PM" ? 12 : 0) + (option % 12));
                      setMode("minute");
                    } else {
                      setMinute(option);
                    }
                  }}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  className={cn("absolute inline-flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold hover:bg-[var(--surface-hover)]", selected && "ui-control-selected")}
                >
                  {String(option).padStart(mode === "minute" ? 2 : 1, "0")}
                </button>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["AM", "PM"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setHour((item === "PM" ? 12 : 0) + (hour % 12))}
                className={cn("ui-control min-h-11 rounded-lg border font-bold", period === item && "ui-control-selected")}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOpen(false)} className="ui-control min-h-11 rounded-lg border font-semibold">Cancel</button>
            <button
              type="button"
              onClick={() => {
                onChange(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
                setOpen(false);
              }}
              className="min-h-11 rounded-lg bg-brand-600 px-4 font-bold text-white"
            >
              Confirm
            </button>
          </div>
        </PickerDialog>
      )}
    </div>
  );
}

export function AppDateTimePicker({
  label,
  value,
  onChange,
  disabled,
  required,
  minDate,
  maxDate,
  minuteStep,
  className,
}: CommonProps & {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
  minuteStep?: number;
}) {
  const selected = splitDateTimeValue(value);
  const updateDate = (date: string) => onChange(date ? combineDateTimeValue(date, selected.time || currentIstTime()) : "");
  const updateTime = (time: string) => onChange(combineDateTimeValue(selected.date || currentIstDate(), time));
  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <AppDatePicker label={`${label} date`} value={selected.date} onChange={updateDate} required={required} min={minDate} max={maxDate} disabled={disabled} />
        <AppTimePicker label={`${label} time`} value={selected.time} onChange={updateTime} required={required} minuteStep={minuteStep} disabled={disabled} />
      </div>
    </fieldset>
  );
}

// All new date/time inputs must use the shared app date/time picker components.
