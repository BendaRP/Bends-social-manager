import { TZDate } from "@date-fns/tz";
import { getEnv } from "./env";

/**
 * Timezone handling.
 *
 * Every timestamp in the database is UTC. Everything a human sees, and every
 * "what hour performs best" question, is expressed in the audience timezone
 * (Asia/Jerusalem by default).
 *
 * Israel observes daylight saving time, so the UTC offset moves between +02:00
 * and +03:00 during the year. A fixed offset would drift a scheduled 09:00 post
 * to 08:00 for half the year, so conversions go through the IANA zone.
 */

export function audienceTimezone(): string {
  return getEnv().AUDIENCE_TIMEZONE;
}

/** Converts a UTC instant into the audience's wall-clock time. */
export function toAudienceTime(utc: Date, timezone = audienceTimezone()): TZDate {
  return new TZDate(utc, timezone);
}

/**
 * Turns a wall-clock time in the audience's timezone into a UTC instant.
 * This is what the scheduler stores when the user picks "Tuesday 19:30".
 */
export function fromAudienceTime(
  parts: {
    year: number;
    month: number; // 1-12
    day: number;
    hour: number;
    minute: number;
  },
  timezone = audienceTimezone(),
): Date {
  const local = new TZDate(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
    timezone,
  );
  return new Date(local.getTime());
}

/** Parses a `datetime-local` input value ("2026-08-21T19:30") as audience time. */
export function parseLocalInput(value: string, timezone = audienceTimezone()): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) throw new Error(`Unrecognised datetime-local value: "${value}"`);
  const [, y, mo, d, h, mi] = match as unknown as [string, string, string, string, string, string];
  return fromAudienceTime(
    {
      year: Number(y),
      month: Number(mo),
      day: Number(d),
      hour: Number(h),
      minute: Number(mi),
    },
    timezone,
  );
}

export interface LocalTimeParts {
  hour: number;
  minute: number;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  dayOfMonth: number;
  month: number; // 1-12
  year: number;
  isWeekend: boolean;
}

/**
 * Breaks a UTC instant into the local calendar fields the recommendation engine
 * groups by.
 *
 * Note the weekend definition: in Israel the weekend is Friday and Saturday.
 * Treating Saturday/Sunday as the weekend — the default assumption baked into
 * most scheduling tools — would put Friday in the "weekday" bucket and Sunday,
 * a normal working day here, in the "weekend" one. Both buckets would then be
 * wrong, and every weekday-vs-weekend comparison built on them would be too.
 */
export function localParts(utc: Date, timezone = audienceTimezone()): LocalTimeParts {
  const local = toAudienceTime(utc, timezone);
  const dayOfWeek = local.getDay();
  return {
    hour: local.getHours(),
    minute: local.getMinutes(),
    dayOfWeek,
    dayOfMonth: local.getDate(),
    month: local.getMonth() + 1,
    year: local.getFullYear(),
    isWeekend: dayOfWeek === 5 || dayOfWeek === 6, // Friday, Saturday
  };
}

/** Midnight local time, as a UTC instant — the anchor for daily metric rows. */
export function localDateOnly(utc: Date, timezone = audienceTimezone()): Date {
  const p = localParts(utc, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.dayOfMonth));
}

const HEBREW_DAY_NAMES = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

export function dayNameHe(dayOfWeek: number): string {
  return HEBREW_DAY_NAMES[dayOfWeek] ?? "";
}

/** Formats a UTC instant for display, in the audience timezone. */
export function formatAudience(
  utc: Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  timezone = audienceTimezone(),
): string {
  return new Intl.DateTimeFormat("he-IL", { ...options, timeZone: timezone }).format(utc);
}
