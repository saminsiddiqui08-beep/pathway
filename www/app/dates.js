// Counting calendar days as whole numbers from 1 January 1970, so arithmetic never meets time zones
// or daylight saving. Dates are never parsed from strings by Date, which reads them inconsistently
const MS_PER_DAY = 86400000;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NBSP = "\u00A0";

// Counting a month as 31 days when planning, so month-long waits are never short
const DAYS_PER_MONTH = 31;

// Working Sunday to Thursday in Bangladesh, and Monday to Friday abroad
const WORKING_DAYS = new Set([0, 1, 2, 3, 4]);
const BUSINESS_DAYS = new Set([1, 2, 3, 4, 5]);

export function dayFromParts(year, month, day) {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function partsFromDay(dayNumber) {
  const date = new Date(dayNumber * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
}

export function daysInMonth(year, month) {
  return dayFromParts(year, month + 1, 1) - dayFromParts(year, month, 1);
}

// Reading "YYYY-MM-DD" or "YYYY-MM"; a month-only value covers its first to its last day
export function readDate(text) {
  const match = /^([0-9]{4})-([0-9]{2})(?:-([0-9]{2}))?$/.exec(text ?? "");
  if (!match) {
    throw new Error(`Not a date: ${text}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || month < 1 || month > 12) {
    throw new Error(`Not a date: ${text}`);
  }
  if (match[3] === undefined) {
    return { first: dayFromParts(year, month, 1), last: dayFromParts(year, month, daysInMonth(year, month)), precision: "month" };
  }
  const day = Number(match[3]);
  const dayNumber = dayFromParts(year, month, day);
  if (partsFromDay(dayNumber).day !== day) {
    throw new Error(`Not a date: ${text}`);
  }
  return { first: dayNumber, last: dayNumber, precision: "day" };
}

export function readDay(text) {
  const read = readDate(text);
  if (read.precision !== "day") {
    throw new Error(`Not a single day: ${text}`);
  }
  return read.first;
}

export function isoDay(dayNumber) {
  const { year, month, day } = partsFromDay(dayNumber);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoMonth(dayNumber) {
  return isoDay(dayNumber).slice(0, 7);
}

export function addYears(dayNumber, years) {
  const { year, month, day } = partsFromDay(dayNumber);
  return dayFromParts(year + years, month, Math.min(day, daysInMonth(year + years, month)));
}

export function addMonths(dayNumber, months) {
  const { year, month, day } = partsFromDay(dayNumber);
  const target = dayFromParts(year, month + months, 1);
  const { year: targetYear, month: targetMonth } = partsFromDay(target);
  return dayFromParts(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

// Counting whole working days, never the starting day itself
function stepOverDays(dayNumber, count, open, direction) {
  let current = dayNumber;
  let counted = 0;
  while (counted < count) {
    current += direction;
    if (open.has(partsFromDay(current).weekday)) {
      counted += 1;
    }
  }
  return current;
}

// Moving a date forward (direction 1) or back (direction -1) by a duration from the facts.
// Fractions round up, because a wait of 2.5 months is never shorter than 78 days
export function shift(dayNumber, amount, unit, direction = 1) {
  const count = Math.ceil(amount);
  switch (unit) {
    case "days":
      return dayNumber + direction * count;
    case "weeks":
      return dayNumber + direction * Math.ceil(amount * 7);
    case "months":
      return dayNumber + direction * Math.ceil(amount * DAYS_PER_MONTH);
    // Counting calendar months for a rule stated that way, such as "within 3 months of the start",
    // where 31-day months would run past the real last day
    case "calendarMonths":
      return addMonths(dayNumber, direction * count);
    case "years":
      return addYears(dayNumber, direction * count);
    case "workingDays":
      return stepOverDays(dayNumber, count, WORKING_DAYS, direction);
    case "businessDays":
      return stepOverDays(dayNumber, count, BUSINESS_DAYS, direction);
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

// Reading the phone's own calendar day, which is what "today" means to the student
export function today(now = new Date()) {
  return dayFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function zoneParts(epochMs, zone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(new Date(epochMs));
  const read = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

function zoneOffsetMs(epochMs, zone) {
  const parts = zoneParts(epochMs, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - Math.floor(epochMs / 60000) * 60000;
}

// Finding the instant a wall-clock time in a named zone happens, checked twice for daylight saving
export function zonedInstant(dayNumber, time, zone) {
  const [hour, minute] = time.split(":").map(Number);
  const { year, month, day } = partsFromDay(dayNumber);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - zoneOffsetMs(wall, zone);
  instant = wall - zoneOffsetMs(instant, zone);
  return instant;
}

// Reading an instant as a calendar day and clock time in a named zone
export function inZone(epochMs, zone) {
  const parts = zoneParts(epochMs, zone);
  return {
    day: dayFromParts(parts.year, parts.month, parts.day),
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

export function monthName(month) {
  return MONTH_NAMES[month - 1];
}

// Writing "7 January 2027" with a no-break space, so the day and month never split across lines
export function formatDay(dayNumber, { year = true } = {}) {
  const parts = partsFromDay(dayNumber);
  const text = `${parts.day}${NBSP}${MONTH_NAMES[parts.month - 1]}`;
  return year ? `${text} ${parts.year}` : text;
}

export function formatMonth(dayNumber, { year = true } = {}) {
  const parts = partsFromDay(dayNumber);
  return year ? `${MONTH_NAMES[parts.month - 1]} ${parts.year}` : MONTH_NAMES[parts.month - 1];
}

// Turning a deadline's day and time in its own zone into Dhaka's day and time
export function toDhaka(dayNumber, time, zone) {
  return inZone(zonedInstant(dayNumber, time, zone), "Asia/Dhaka");
}

// Writing "9:59 a.m." and "11:59 p.m.", the way people in Bangladesh read clock times
export function formatTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, "0")}${NBSP}${hours < 12 ? "a.m." : "p.m."}`;
}

// Counting whole calendar months from one day to another, for "11 months until studies begin"
export function monthsBetween(from, to) {
  const a = partsFromDay(from);
  const b = partsFromDay(to);
  const months = (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0);
  return Math.max(0, months);
}

export function monthStart(dayNumber) {
  const { year, month } = partsFromDay(dayNumber);
  return dayFromParts(year, month, 1);
}

export function monthEnd(dayNumber) {
  const { year, month } = partsFromDay(dayNumber);
  return dayFromParts(year, month, daysInMonth(year, month));
}
