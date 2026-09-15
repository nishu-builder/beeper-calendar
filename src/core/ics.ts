import { Calendar, CalendarEvent, EventFields, validateProposal } from "./types";
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const esc = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function unesc(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    let ch = value[i];
    if (ch === "\\") {
      ch = value[++i];
      if (!ch || !"\\;,nN".includes(ch)) throw new Error("Invalid calendar text.");
      if (ch === "n" || ch === "N") ch = "\n";
    } else if (ch === ";" || ch === ",") throw new Error("Unescaped calendar text.");
    result += ch;
  }
  return result;
}
function fold(line: string): string {
  let part = "";
  const out: string[] = [];
  for (const ch of line) {
    if (new TextEncoder().encode(part + ch).length > 75) {
      out.push(part);
      part = " ";
    }
    part += ch;
  }
  out.push(part);
  return out.join("\r\n");
}
const stamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const date = (value: string) => {
  if (!/^\d{8}T\d{6}Z$/.test(value))
    throw new Error("Only ordinary timed events are editable in this version.");
  return value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
};
const fixed = ["UID", "DTSTAMP", "X-GCAL-CALENDAR-ID", "X-GCAL-EVENT-ID", "X-GCAL-ETAG"];
function properties(raw: string): Map<string, string> {
  if (raw.length > 1_048_576 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw))
    throw new Error("Unsupported calendar file.");
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter(Boolean);
  if (
    lines.slice(0, 4).join("\n") !==
      "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//gcal-git-bridge//EN\nBEGIN:VEVENT" ||
    lines.slice(-2).join("\n") !== "END:VEVENT\nEND:VCALENDAR"
  )
    throw new Error("Unsupported calendar structure.");
  const result = new Map<string, string>();
  for (const line of lines.slice(4, -2)) {
    const i = line.indexOf(":");
    const key = line.slice(0, i);
    if (
      i < 0 ||
      result.has(key) ||
      ![...fixed, "SUMMARY", "DESCRIPTION", "LOCATION", "DTSTART", "DTEND"].includes(key)
    )
      throw new Error("Unsupported calendar property; all-day and recurring events are read-only.");
    result.set(key, line.slice(i + 1));
  }
  for (const key of [...fixed, "SUMMARY", "DESCRIPTION", "LOCATION", "DTSTART", "DTEND"])
    if (!result.has(key)) throw new Error("Incomplete exported event.");
  return result;
}
export function parseEvent(path: string, raw: string, expectedCalendar: string): CalendarEvent {
  const p = properties(raw);
  const get = (key: string) => unesc(p.get(key)!);
  if (get("X-GCAL-CALENDAR-ID") !== expectedCalendar)
    throw new Error("Calendar identity mismatch.");
  const fields = {
    title: get("SUMMARY"),
    description: get("DESCRIPTION"),
    location: get("LOCATION"),
    start: date(get("DTSTART")),
    end: date(get("DTEND")),
  };
  validateProposal({ action: "update", event: fields, explanation: "", questions: [] });
  if (!/^"[^"\r\n]+"$/.test(get("X-GCAL-ETAG"))) throw new Error("Invalid exported ETag.");
  return {
    id: get("X-GCAL-EVENT-ID"),
    uid: get("UID"),
    etag: get("X-GCAL-ETAG"),
    fields,
    path,
    raw,
  };
}
export function updateEvent(before: CalendarEvent, fields: EventFields): string {
  const p = properties(before.raw);
  p.set("SUMMARY", esc(fields.title));
  p.set("DESCRIPTION", esc(fields.description));
  p.set("LOCATION", esc(fields.location));
  p.set("DTSTART", stamp(fields.start));
  p.set("DTEND", stamp(fields.end));
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//gcal-git-bridge//EN",
      "BEGIN:VEVENT",
      ...[...p].map(([key, value]) => key + ":" + value),
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}
export async function newEvent(calendar: Calendar, id: string, fields: EventFields, now: string) {
  const uid = id + "@gcal-git-bridge";
  const operationId = "ics-create-" + (await hash(calendar.id + "\0" + uid));
  const eventId = "b" + (await hash(calendar.id + "\0" + operationId));
  const path = "events/" + (await hash(calendar.id)) + "/" + (await hash(eventId)) + ".ics";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//gcal-git-bridge//EN",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + stamp(now),
    "X-GCAL-CALENDAR-ID:" + esc(calendar.id),
    "SUMMARY:" + esc(fields.title),
    "DESCRIPTION:" + esc(fields.description),
    "LOCATION:" + esc(fields.location),
    "DTSTART:" + stamp(fields.start),
    "DTEND:" + stamp(fields.end),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { path, raw: lines.map(fold).join("\r\n") + "\r\n", eventId, operationId };
}
export function sameFields(a: EventFields, b: EventFields): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.location === b.location &&
    new Date(a.start).getTime() === new Date(b.start).getTime() &&
    new Date(a.end).getTime() === new Date(b.end).getTime()
  );
}
