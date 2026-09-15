import {
  CalendarEvent,
  CalendarProposal,
  Message,
  QueueItem,
  Settings,
  Snapshot,
  Submission,
} from "../core/types";
import { newEvent, parseEvent, updateEvent } from "../core/ics";
export const sampleText =
  "Let's do coffee at Juniper on September 18, 2026, from 10 to 11 AM Pacific.";
export const demoMessage: Message = {
  id: "demo-message",
  chatID: "demo-chat",
  text: sampleText,
  timestamp: "2026-09-15T17:00:00Z",
  senderName: "Alex",
  chatTitle: "Alex · Demo conversation",
};
export const demoFields = {
  title: "Coffee with Alex",
  description: "",
  location: "Juniper",
  start: "2026-09-18T10:00:00-07:00",
  end: "2026-09-18T11:00:00-07:00",
};
export class DemoBeeper {
  async search(text: string): Promise<Message[]> {
    return [{ ...demoMessage, text: text || sampleText }];
  }
  async context(source: Message): Promise<Message[]> {
    return [
      {
        ...source,
        id: "demo-before",
        text: "It will be nice to catch up. Juniper works for me.",
        senderName: "You",
      },
      source,
    ];
  }
  async focus(): Promise<void> {
    /* The UI labels this as an in-app demo source. */
  }
}
export class DemoModel {
  async propose(
    _source: Message,
    _context: Message[],
    adjustment: string,
    target?: CalendarEvent,
    currentProposal?: CalendarProposal,
  ): Promise<CalendarProposal> {
    const event = { ...(currentProposal?.event || target?.fields || demoFields) };
    if (adjustment.trim()) event.title = adjustment.trim().slice(0, 300);
    return {
      action: target ? "update" : "create",
      event,
      explanation:
        "Demo fixture: September 18, 10–11 AM Pacific. In live mode, your local model reads the selected message and context.",
      questions: [],
    };
  }
}
export class DemoCalendar {
  async snapshot(): Promise<Snapshot> {
    const calendar = {
      id: "demo-calendar",
      summary: "Personal · Demo calendar",
      version: 1,
      timeZone: "America/Los_Angeles",
    };
    const create = await newEvent(
      calendar,
      "e51a2f43-c95a-419e-b8f9-9942f4a3fc68",
      {
        ...demoFields,
        title: "Coffee with Alex",
        start: "2026-09-18T09:00:00-07:00",
        end: "2026-09-18T10:00:00-07:00",
      },
      "2026-09-15T17:00:00Z",
    );
    const raw = create.raw.replace(
      "SUMMARY:",
      'X-GCAL-EVENT-ID:demo-event\r\nX-GCAL-ETAG:"demo-version"\r\nSUMMARY:',
    );
    return {
      sha: "demo-snapshot",
      loadedAt: new Date().toISOString(),
      calendar,
      events: [parseEvent(create.path, raw, calendar.id)],
    };
  }
  async prepare(item: QueueItem): Promise<Submission> {
    const data = item.target
      ? {
          path: item.target.path,
          raw: updateEvent(item.target, item.proposal.event),
          eventId: item.target.id,
        }
      : await newEvent(item.snapshot.calendar, item.id, item.proposal.event, item.createdAt);
    return { ...data, baseSha: item.snapshot.sha, branch: "demo/" + item.id };
  }
  async submit(item: QueueItem, persist: () => Promise<void>): Promise<void> {
    item.submission!.pr = 1;
    item.submission!.headSha = "demo-head";
    await persist();
  }
  async approve(): Promise<void> {}
  async inspect(
    item: QueueItem,
  ): Promise<{ stage: "pull_request" | "awaiting_calendar" | "confirmed"; detail: string }> {
    return item.stage === "awaiting_calendar"
      ? {
          stage: "confirmed",
          detail: "Demo receipt and snapshot match. No real calendar was changed.",
        }
      : { stage: "pull_request", detail: "Demo review is ready. No real pull request was opened." };
  }
}
export const demoSettings = (settings: Settings): Settings => ({ ...settings, mode: "demo" });
