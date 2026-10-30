// Sending reminders for the plan from this phone, with no internet, once the student turns them on.
// They are inexact on purpose (Android may deliver them a little late to save battery). The next
// 120 days are kept scheduled, so a student who does not open the app for months still hears from it;
// the list is rebuilt whenever the app opens or a step changes
import { formatDay, formatMonth, monthEnd, partsFromDay } from "../../app/dates.js";
import { LocalNotifications, readData, writeData } from "../../app/native.js";
import { openSheet } from "../../app/sheet.js";
import { dateWords, esc, lowerFirst } from "./words.js";

const SETTINGS_KEY = "plan.reminders";
const CHANNEL = "plan";
const WINDOW_DAYS = 120;
const DEFAULTS = { on: false, asked: false, week: true, deadline: true, monthly: false, time: "09:00" };

let settings = { ...DEFAULTS };
let lastSync = { result: null, code: null, today: null };
let onOpenStep = () => { };

export function remindersAvailable() {
  return Boolean(LocalNotifications);
}

export function remindersOn() {
  return settings.on;
}

export function remindersAsked() {
  return settings.asked;
}

function cleanSettings(saved) {
  const clean = { ...DEFAULTS };
  if (saved && typeof saved === "object") {
    for (const key of ["on", "asked", "week", "deadline", "monthly"]) {
      if (typeof saved[key] === "boolean") {
        clean[key] = saved[key];
      }
    }
    if (typeof saved.time === "string" && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(saved.time)) {
      clean.time = saved.time;
    }
  }
  return clean;
}

// Giving each reminder a stable whole number, so the same reminder always replaces itself
function idFor(text) {
  let hash = 5381;
  for (const char of text) {
    hash = ((hash * 33) ^ char.codePointAt(0)) >>> 0;
  }
  return (hash % 2000000000) + 1;
}

// Reading the phone's local clock time on a calendar day
function at(day, time) {
  const { year, month, day: date } = partsFromDay(day);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, date, hours, minutes, 0, 0);
}

function timeWords(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  const part = hours < 12 ? "in the morning" : hours < 18 ? "in the afternoon" : "in the evening";
  return `${twelve}:${String(minutes).padStart(2, "0")} ${part}`;
}

// Listing every reminder the plan needs in the next 120 days, by the student's choices
export function remindersFor(result, code, today, now, choice = settings) {
  if (!result || result.status !== "ok") {
    return [];
  }
  const list = [];
  const last = today + WINDOW_DAYS;
  const add = (day, title, body, stepId, kind) => {
    const when = at(day, choice.time);
    if (day >= today && day <= last && when.getTime() > now) {
      list.push({ id: idFor(`${code}|${stepId ?? "month"}|${kind}|${day}`), title, body, at: when, stepId });
    }
  };
  for (const step of result.steps) {
    if (step.done || step.undated || !step.date) {
      continue;
    }
    const due = dateWords(step.date, today);
    if (choice.week && step.kind !== "wait" && step.kind !== "event") {
      add(step.date.day - 7, `${step.title} by ${due}`, "One week to go. Tap to see the step.", step.id, "week");
    }
    if (choice.deadline && step.hard && step.date.precision === "day") {
      add(step.date.day - 1, `${step.title} by tomorrow, ${formatDay(step.date.day, { year: false })}`, "Tomorrow is the last day. Tap to see the step.", step.id, "deadline");
    }
  }
  if (choice.monthly) {
    for (let first = monthEnd(today) + 1; first <= last; first = monthEnd(first) + 1) {
      const end = monthEnd(first);
      const coming = result.steps.filter((step) => !step.done && !step.undated && step.date && step.date.day >= first && step.date.day <= end);
      const body = coming.length === 0
        ? "No steps are due this month. Tap to see your plan."
        : `${coming.length === 1 ? "One step" : `${coming.length} steps`}, starting with ${lowerFirst(coming[0].title)}. Tap to see your plan.`;
      add(first, `What is coming in ${formatMonth(first, { year: false })}`, body, coming[0]?.id ?? null, "month");
    }
  }
  return list.sort((a, b) => a.at - b.at);
}

// Remembering the plan now, so the panel's Save uses it even before the delayed update has run
export function rememberPlan(result, code, today) {
  lastSync = { result, code, today };
}

// Replacing every scheduled reminder with the current plan's
export async function syncReminders(result, code, today) {
  lastSync = { result, code, today };
  if (!LocalNotifications) {
    return;
  }
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((item) => ({ id: item.id })) });
    }
    if (!settings.on) {
      return;
    }
    const list = remindersFor(result, code, today, Date.now());
    if (list.length === 0) {
      return;
    }
    await LocalNotifications.schedule({
      notifications: list.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        channelId: CHANNEL,
        schedule: { at: item.at, allowWhileIdle: true },
        // Staying inexact on purpose, since Pathway never asks for the exact-alarm permission
        isExactNotification: false,
        extra: { country: code, stepId: item.stepId },
      })),
    });
  } catch (error) {
    console.warn("Could not schedule reminders", error);
  }
}

// Recording that reminders were offered, so the offer after the first plan is made only once
export async function markAsked() {
  if (!settings.asked) {
    settings = { ...settings, asked: true };
    await writeData(SETTINGS_KEY, settings);
  }
}

function preview(result, today) {
  const step = result?.steps?.find((item) => item.id === result.current && item.date);
  if (!step) {
    return { title: "Submit your applications by 1 January", body: "One week to go. Tap to see the step." };
  }
  return { title: `${step.title} by ${dateWords(step.date, today)}`, body: "One week to go. Tap to see the step." };
}

function toggle(key, label) {
  return `<label class="switch-row">
    <span>${esc(label)}</span>
    <input class="switch-input" type="checkbox" role="switch" data-reminder="${key}"${settings[key] ? " checked" : ""}>
    <span class="switch" aria-hidden="true"></span>
  </label>`;
}

export function showReminders(result, today, message = "") {
  const shown = preview(result, today);
  document.getElementById("reminders-body").innerHTML = `
    <p class="reading">Pathway can remind you before each step, so nothing slips. Reminders come from this phone and work without internet.</p>
    <div class="reminder-preview">
      <p class="note">A reminder will look like this</p>
      <p class="reminder-title">${esc(shown.title)}</p>
      <p class="reminder-body">${esc(shown.body)}</p>
    </div>
    <fieldset class="switches"><legend class="visually-hidden">When to remind you</legend>
      ${toggle("week", "A week before each step")}
      ${toggle("deadline", "The day before a hard deadline")}
      ${toggle("monthly", "What is coming, each month")}
    </fieldset>
    <label class="time-row"><span>Time <span class="note">${esc(timeWords(settings.time))}</span></span>
      <input type="time" id="reminder-time" value="${esc(settings.time)}" aria-label="Reminder time"></label>
    ${message ? `<p class="field-error" role="alert">${esc(message)}</p>` : ""}
    <p class="note">${settings.on ? "Android may deliver a reminder a little late to save battery." : "Android will ask whether Pathway may send notifications. You can turn reminders off at any time."}</p>
    ${settings.on
      ? `<button class="button-primary" type="button" data-reminders="save">Save</button>
         <button class="button-secondary" type="button" data-reminders="off">Turn off reminders</button>`
      : `<button class="button-primary" type="button" data-reminders="on">Turn on reminders</button>
         <button class="text-button is-centred" type="button" data-reminders="later">Not now</button>`}`;
  openSheet("reminders-sheet");
}

function readPanel() {
  const panel = document.getElementById("reminders-body");
  const choice = { ...settings };
  for (const input of panel.querySelectorAll("[data-reminder]")) {
    choice[input.dataset.reminder] = input.checked;
  }
  const time = panel.querySelector("#reminder-time")?.value;
  if (/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time ?? "")) {
    choice.time = time;
  }
  return choice;
}

async function save(next) {
  settings = cleanSettings(next);
  await writeData(SETTINGS_KEY, settings);
  if (lastSync.result) {
    await syncReminders(lastSync.result, lastSync.code, lastSync.today);
  }
}

// Answering a button in the panel. Returns the text to show again in the panel, or null to close it
export async function reminderAction(action) {
  const choice = readPanel();
  if (action === "later") {
    await save({ ...choice, on: false, asked: true });
    return null;
  }
  if (action === "off") {
    await save({ ...choice, on: false, asked: true });
    return null;
  }
  if (action === "save") {
    await save({ ...choice, on: true, asked: true });
    return null;
  }
  if (action === "on") {
    if (!LocalNotifications) {
      return "Reminders work in the Android app only.";
    }
    let display = "denied";
    try {
      display = (await LocalNotifications.requestPermissions()).display;
    } catch (error) {
      console.warn("Could not ask for notifications", error);
    }
    if (display !== "granted") {
      await save({ ...choice, on: false, asked: true });
      return "Android did not allow notifications, so reminders stay off. You can allow them for Pathway in your phone's settings, then try again.";
    }
    try {
      await LocalNotifications.createChannel({ id: CHANNEL, name: "Plan reminders", description: "Reminders before each step of your plan", importance: 3, visibility: 1 });
    } catch (error) {
      console.warn("Could not create the reminders channel", error);
    }
    await save({ ...choice, on: true, asked: true });
    return null;
  }
  return "";
}

// Showing reminders as off if the student switched notifications off in Android's settings
async function checkStillAllowed() {
  if (!LocalNotifications || !settings.on) {
    return;
  }
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") {
      settings = { ...settings, on: false };
      await writeData(SETTINGS_KEY, settings);
    }
  } catch (error) {
    console.warn("Could not check notifications", error);
  }
}

// Checking again, when the app comes back or the panel opens. Returns true when reminders turned off
export async function recheckReminders() {
  const before = settings.on;
  await checkStillAllowed();
  return before !== settings.on;
}

export async function initReminders(openStep) {
  onOpenStep = openStep;
  settings = cleanSettings(await readData(SETTINGS_KEY));
  await checkStillAllowed();
  if (!LocalNotifications) {
    return;
  }
  // Opening the plan at a reminder's step when it is tapped, even when the app had been closed. On
  // the phone, addListener answers with a plain { remove } object, not a promise, so it is awaited
  // inside try: that works with either answer, and a failure never stops the Plan tab
  try {
    await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const extra = action?.notification?.extra ?? {};
      if (typeof extra.country === "string") {
        onOpenStep(extra.country, typeof extra.stepId === "string" ? extra.stepId : null);
      }
    });
  } catch (error) {
    console.warn("Could not listen for reminder taps", error);
  }
}
