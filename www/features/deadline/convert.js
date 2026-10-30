// Turning a deadline's day and clock time in one place into the same moment on the student's own
// clock, with the clock changes near it found and explained. Nothing here touches the screen, so the
// checks run the same code in Node
import { inZone, partsFromDay } from "../../app/dates.js";

const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
// Looking this many days either side of a deadline for a clock change worth mentioning
const CHANGE_WINDOW_DAYS = 7;
// Narrowing a clock change down to the minute, which this many halvings of a week always reach
const SEARCH_STEPS = 24;

function minutesOf(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Reading a zone's distance from UTC at one instant, in minutes, through the phone's own zone data
export function offsetMinutes(epochMs, zone) {
  const local = inZone(epochMs, zone);
  const wall = local.day * MS_PER_DAY + minutesOf(local.time) * MS_PER_MINUTE;
  return Math.round((wall - Math.floor(epochMs / MS_PER_MINUTE) * MS_PER_MINUTE) / MS_PER_MINUTE);
}

// Finding when a wall-clock time happens. A time that happens twice, when clocks go back, takes the
// first; a time that never happens, when clocks go forward, moves on by the size of the jump
export function instantOf(day, time, zone) {
  const wall = day * MS_PER_DAY + minutesOf(time) * MS_PER_MINUTE;
  const offsets = new Set([offsetMinutes(wall - MS_PER_DAY, zone), offsetMinutes(wall + MS_PER_DAY, zone), offsetMinutes(wall, zone)]);
  const matches = [...offsets]
    .map((offset) => wall - offset * MS_PER_MINUTE)
    .filter((instant) => {
      const back = inZone(instant, zone);
      return back.day === day && back.time === time;
    })
    .sort((a, b) => a - b);
  if (matches.length > 0) {
    return { instant: matches[0], repeated: matches.length > 1, skipped: false };
  }
  const before = offsetMinutes(wall - MS_PER_DAY, zone);
  return { instant: wall - before * MS_PER_MINUTE, repeated: false, skipped: true };
}

// Finding the instant a zone's distance from UTC changes between two instants, to the minute
function changeBetween(from, to, zone) {
  let low = from;
  let high = to;
  const start = offsetMinutes(low, zone);
  for (let step = 0; step < SEARCH_STEPS && high - low > MS_PER_MINUTE; step += 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (offsetMinutes(middle, zone) === start) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return high;
}

// Looking for a clock change in the week either side of a deadline, which is when students most
// often get the time wrong
function nearbyChange(instant, zone) {
  const window = CHANGE_WINDOW_DAYS * MS_PER_DAY;
  for (const [from, to] of [[instant - window, instant], [instant, instant + window]]) {
    const before = offsetMinutes(from, zone);
    const after = offsetMinutes(to, zone);
    if (before !== after) {
      const at = changeBetween(from, to, zone);
      return { day: inZone(at, zone).day, minutes: after - before, before: to === instant };
    }
  }
  return null;
}

// Converting one deadline. day is a day number, time "HH:MM", zone where the deadline is set and home
// the student's own zone. Returns both clocks, how far apart they are, and anything worth saying
export function convert({ day, time, zone, home }) {
  const found = instantOf(day, time, zone);
  const there = inZone(found.instant, zone);
  const here = inZone(found.instant, home);
  const zoneOffset = offsetMinutes(found.instant, zone);
  const homeOffset = offsetMinutes(found.instant, home);
  return {
    instant: found.instant,
    there,
    here,
    zoneOffset,
    homeOffset,
    apart: homeOffset - zoneOffset,
    dayShift: here.day - there.day,
    repeated: found.repeated,
    skipped: found.skipped,
    change: nearbyChange(found.instant, zone),
  };
}

// Writing a distance from UTC as people say it: "6 hours ahead of UTC", "5 hours behind UTC"
export function offsetWords(minutes) {
  if (minutes === 0) {
    return "the same as UTC";
  }
  const hours = Math.abs(minutes) / 60;
  const amount = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, "");
  return `${amount} ${hours === 1 ? "hour" : "hours"} ${minutes > 0 ? "ahead of" : "behind"} UTC`;
}

// Writing how far apart two clocks are: "11 hours", "30 minutes", "5 hours 30 minutes"
export function gapWords(minutes) {
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }
  if (rest > 0) {
    parts.push(`${rest} minutes`);
  }
  return parts.length > 0 ? parts.join(" ") : "no time";
}

// Naming the weekday of a day number
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function weekday(day) {
  return WEEKDAYS[partsFromDay(day).weekday];
}

// Reading the phone's own time zone, falling back to Dhaka when the phone does not say
export function phoneZone(fallback) {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}
