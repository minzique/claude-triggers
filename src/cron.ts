/**
 * Cron expression parser and utilities.
 * Extracted from Claude Code v2.1.81 Kairos scheduler.
 *
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 */

// ─── Cron field ranges ───

const FIELD_RANGES: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 },  // minute
  { min: 0, max: 23 },  // hour
  { min: 1, max: 31 },  // day of month
  { min: 1, max: 12 },  // month
  { min: 0, max: 6 },   // day of week (0=Sunday)
];

// ─── Parser ───

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseField(field: string, range: { min: number; max: number }): number[] | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let base = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;

    if (step < 1) return null;

    let start: number;
    let end: number;

    if (base === "*") {
      start = range.min;
      end = range.max;
    } else {
      const rangeMatch = base.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        start = parseInt(rangeMatch[1], 10);
        end = parseInt(rangeMatch[2], 10);
      } else {
        const num = parseInt(base, 10);
        if (isNaN(num) || num < range.min || num > range.max) return null;
        if (stepMatch) {
          start = num;
          end = range.max;
        } else {
          values.add(num);
          continue;
        }
      }
    }

    if (start < range.min || end > range.max || start > end) return null;
    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
}

/**
 * Parse a 5-field cron expression. Returns null if invalid.
 */
export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const fields: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const parsed = parseField(parts[i], FIELD_RANGES[i]);
    if (!parsed) return null;
    fields.push(parsed);
  }

  return {
    minute: fields[0],
    hour: fields[1],
    dayOfMonth: fields[2],
    month: fields[3],
    dayOfWeek: fields[4],
  };
}

/**
 * Get the next matching date after `after`.
 * Scans minute-by-minute up to ~1 year (527040 minutes).
 */
export function nextCronDate(fields: CronFields, after: Date): Date | null {
  const minute = new Set(fields.minute);
  const hour = new Set(fields.hour);
  const dom = new Set(fields.dayOfMonth);
  const month = new Set(fields.month);
  const dow = new Set(fields.dayOfWeek);

  const allDom = fields.dayOfMonth.length === 31;
  const allDow = fields.dayOfWeek.length === 7;

  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const MAX_ITERATIONS = 527040; // ~1 year of minutes
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const m = cursor.getMonth() + 1;
    if (!month.has(m)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    const d = cursor.getDate();
    const w = cursor.getDay();
    const dayMatch = allDom && allDow
      ? true
      : allDom
        ? dow.has(w)
        : allDow
          ? dom.has(d)
          : dom.has(d) || dow.has(w);

    if (!dayMatch) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }

    if (!hour.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!minute.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1);
      continue;
    }

    return cursor;
  }

  return null;
}

/**
 * Validate a cron expression. Returns error message or null if valid.
 */
export function validateCron(expression: string): string | null {
  const fields = parseCron(expression);
  if (!fields) return `Invalid cron expression '${expression}'. Expected 5 fields: M H DoM Mon DoW.`;

  const next = nextCronDate(fields, new Date());
  if (!next) return `Cron expression '${expression}' does not match any date in the next year.`;

  // Check minimum 1-hour interval (trigger API constraint)
  const second = nextCronDate(fields, next);
  if (second) {
    const intervalMs = second.getTime() - next.getTime();
    if (intervalMs < 3600_000) {
      return `Minimum trigger interval is 1 hour. '${expression}' fires every ${Math.round(intervalMs / 60_000)} minutes.`;
    }
  }

  return null;
}

/**
 * Convert a cron expression to a human-readable description.
 */
export function describeCron(expression: string, options?: { utc?: boolean }): string {
  const utc = options?.utc ?? false;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hr, dom, mon, dow] = parts;

  // Every N minutes
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(everyMin[1], 10);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }

  // Every N hours at minute M
  if (min.match(/^\d+$/) && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
    const m = parseInt(min, 10);
    if (m === 0) return "Every hour, on the hour";
    return `Every hour at :${m.toString().padStart(2, "0")}`;
  }

  const everyHr = hr.match(/^\*\/(\d+)$/);
  if (min.match(/^\d+$/) && everyHr && dom === "*" && mon === "*" && dow === "*") {
    const n = parseInt(everyHr[1], 10);
    const m = parseInt(min, 10);
    return `Every ${n} hours at :${m.toString().padStart(2, "0")}`;
  }

  // Specific time daily
  if (min.match(/^\d+$/) && hr.match(/^\d+$/) && dom === "*" && mon === "*") {
    const h = parseInt(hr, 10);
    const m = parseInt(min, 10);
    const time = formatTime(h, m, utc);
    if (dow === "*") return `Daily at ${time}`;
    return `${describeDow(dow)} at ${time}`;
  }

  // Monthly
  if (min.match(/^\d+$/) && hr.match(/^\d+$/) && dom.match(/^\d+$/) && mon === "*" && dow === "*") {
    const h = parseInt(hr, 10);
    const m = parseInt(min, 10);
    const d = parseInt(dom, 10);
    return `Monthly on the ${ordinal(d)} at ${formatTime(h, m, utc)}`;
  }

  return expression;
}

function formatTime(h: number, m: number, utc: boolean): string {
  const suffix = utc ? " UTC" : "";
  if (h === 0) return `12:${m.toString().padStart(2, "0")}am${suffix}`;
  if (h < 12) return `${h}:${m.toString().padStart(2, "0")}am${suffix}`;
  if (h === 12) return `12:${m.toString().padStart(2, "0")}pm${suffix}`;
  return `${h - 12}:${m.toString().padStart(2, "0")}pm${suffix}`;
}

function describeDow(dow: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (dow === "1-5") return "Weekdays";
  if (dow === "0,6") return "Weekends";
  return dow
    .split(",")
    .map((d) => days[parseInt(d, 10)] ?? d)
    .join(", ");
}

function ordinal(n: number): string {
  if (n > 3 && n < 21) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/**
 * Parse an interval shorthand (5m, 2h, 1d) into a cron expression.
 * Used by /loop-style commands.
 */
export function intervalToCron(interval: string): string | null {
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) return null;

  let n = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      n = Math.max(1, Math.ceil(n / 60));
    // fallthrough to minutes
    case "m":
      if (n <= 59) return `*/${n} * * * *`;
      // Round to hours
      const hours = Math.round(n / 60);
      if (hours > 0 && 24 % hours === 0) return `0 */${hours} * * *`;
      return `0 */${hours} * * *`;
    case "h":
      if (n <= 23) return `0 */${n} * * *`;
      return `0 0 */${Math.round(n / 24)} * *`;
    case "d":
      return `0 0 */${n} * *`;
    default:
      return null;
  }
}
