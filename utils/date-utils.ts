import { DateTime } from "luxon";

function toUtcDateTime(value: Date): DateTime {
  return DateTime.fromJSDate(value, { zone: "utc" });
}

export function parseIsoUtc(value: string, label?: string): Date {
  const dateTime = DateTime.fromISO(value, { zone: "utc" });
  if (!dateTime.isValid) {
    throw new Error(
      `Invalid date${label ? ` for ${label}` : ""}: ${value}${
        dateTime.invalidReason ? ` (${dateTime.invalidReason})` : ""
      }`
    );
  }

  return dateTime.toJSDate();
}

export function toIsoUtc(value: Date): string {
  const iso = toUtcDateTime(value).toISO({
    suppressMilliseconds: false,
    includeOffset: true,
  });
  if (!iso) {
    throw new Error("Unable to serialize date to ISO.");
  }
  return iso;
}

export function addMinutesUtc(value: Date, minutes: number): Date {
  return toUtcDateTime(value).plus({ minutes }).toJSDate();
}

export function addHoursUtc(value: Date, hours: number): Date {
  return toUtcDateTime(value).plus({ hours }).toJSDate();
}

export function addDaysUtc(value: Date, days: number): Date {
  return toUtcDateTime(value).plus({ days }).toJSDate();
}

export function startOfUtcDay(value: Date): Date {
  return toUtcDateTime(value).startOf("day").toJSDate();
}

export function utcDayOfWeekSundayZero(value: Date): number {
  const weekday = toUtcDateTime(value).weekday; // 1=Mon ... 7=Sun
  return weekday % 7; // 0=Sun ... 6=Sat
}

export function toMillis(value: Date): number {
  return toUtcDateTime(value).toMillis();
}

export function isBefore(left: Date, right: Date): boolean {
  return toMillis(left) < toMillis(right);
}

export function isAfter(left: Date, right: Date): boolean {
  return toMillis(left) > toMillis(right);
}

export function isSameOrAfter(left: Date, right: Date): boolean {
  return toMillis(left) >= toMillis(right);
}

export function maxDate(left: Date, right: Date): Date {
  return isAfter(left, right) ? left : right;
}

export function minDate(left: Date, right: Date): Date {
  return isBefore(left, right) ? left : right;
}

export function diffMinutesFloor(start: Date, end: Date): number {
  const delta = toMillis(end) - toMillis(start);
  return Math.floor(delta / 60000);
}
