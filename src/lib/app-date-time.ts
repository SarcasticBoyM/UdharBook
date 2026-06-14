export const APP_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function istNowParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

export function currentIstDate(now = new Date()) {
  const value = istNowParts(now);
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

export function currentIstTime(now = new Date()) {
  const value = istNowParts(now);
  return `${pad(value.hour)}:${pad(value.minute)}`;
}

export function currentIstDateTime(now = new Date()) {
  return `${currentIstDate(now)}T${currentIstTime(now)}`;
}

export function splitDateTimeValue(value?: string | null) {
  const normalized = value?.trim() ?? "";
  const [date = "", time = ""] = normalized.split("T");
  return { date, time: time.slice(0, 5) };
}

export function combineDateTimeValue(date: string, time: string) {
  if (!date || !time) return "";
  return `${date}T${time.slice(0, 5)}`;
}

export function istDateTimeToIso(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

export function isoToIstDateTime(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = istNowParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export type ReminderPreset = {
  id: "in-1-hour" | "in-2-hours" | "today-5-pm" | "tomorrow-10-am" | "tomorrow-5-pm";
  label: string;
  value: string;
  disabled: boolean;
};

export function reminderPresets(now = new Date()): ReminderPreset[] {
  const nowParts = istNowParts(now);
  const fromInstant = (date: Date) => isoToIstDateTime(date);
  const atIst = (dayOffset: number, hour: number) => {
    const base = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + dayOffset, hour, 0);
    return new Date(base - IST_OFFSET_MINUTES * 60_000);
  };
  const todayFive = atIst(0, 17);
  return [
    { id: "in-1-hour", label: "In 1 hour", value: fromInstant(new Date(now.getTime() + 60 * 60_000)), disabled: false },
    { id: "in-2-hours", label: "In 2 hours", value: fromInstant(new Date(now.getTime() + 120 * 60_000)), disabled: false },
    { id: "today-5-pm", label: "Today 5 PM", value: fromInstant(todayFive), disabled: todayFive.getTime() <= now.getTime() },
    { id: "tomorrow-10-am", label: "Tomorrow 10 AM", value: fromInstant(atIst(1, 10)), disabled: false },
    { id: "tomorrow-5-pm", label: "Tomorrow 5 PM", value: fromInstant(atIst(1, 17)), disabled: false },
  ];
}

export function formatDateValue(value?: string | null) {
  if (!value) return "Select date";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "Select date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export function formatTimeValue(value?: string | null) {
  if (!value) return "Select time";
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "Select time";
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${pad(minute)} ${suffix}`;
}
