import { z } from "zod";
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),
      "Unsupported control character",
    );
export const eventFields = z
  .object({
    title: text(300).refine((v) => !!v.trim(), "Title is required"),
    description: text(8000),
    location: text(1000),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .strict();
export const proposalSchema = z
  .object({
    action: z.enum(["create", "update"]),
    event: eventFields,
    explanation: text(1200),
    questions: z.array(text(300)).max(5),
  })
  .strict();
export type EventFields = z.infer<typeof eventFields>;
export type CalendarProposal = z.infer<typeof proposalSchema>;
export function validateProposal(value: unknown): CalendarProposal {
  const proposal = proposalSchema.parse(value);
  if (new Date(proposal.event.end).getTime() <= new Date(proposal.event.start).getTime())
    throw new Error("The end must be after the start.");
  return proposal;
}
export interface Message {
  id: string;
  chatID: string;
  text: string;
  timestamp: string;
  senderName: string;
  chatTitle: string;
}
export interface Calendar {
  id: string;
  summary: string;
  timeZone: string;
  version: number;
}
export interface CalendarEvent {
  id: string;
  fields: EventFields;
  path: string;
  raw: string;
  etag: string;
  uid: string;
}
export interface Snapshot {
  sha: string;
  calendar: Calendar;
  events: CalendarEvent[];
  loadedAt: string;
}
export type Stage =
  | "review"
  | "submitting"
  | "pull_request"
  | "merging"
  | "awaiting_calendar"
  | "confirmed"
  | "closed";
export interface Submission {
  branch: string;
  path: string;
  raw: string;
  baseSha: string;
  eventId: string;
  operationId?: string;
  pr?: number;
  prUrl?: string;
  headSha?: string;
  mergeSha?: string;
}
export interface QueueItem {
  id: string;
  mode: "demo" | "live";
  settings: Settings;
  createdAt: string;
  updatedAt: string;
  source: Message;
  context: Message[];
  proposal: CalendarProposal;
  snapshot: Snapshot;
  target?: CalendarEvent;
  stage: Stage;
  submission?: Submission;
  lastError?: string;
  history: { at: string; text: string }[];
}
export interface Settings {
  mode: "demo" | "live";
  beeperUrl: string;
  ollamaUrl: string;
  model: string;
  repository: string;
  baseBranch: string;
  calendarId: string;
  timeZone: string;
}
export interface AppState {
  version: 1;
  settings: Settings;
  queue: QueueItem[];
}
export const defaults: Settings = {
  mode: "demo",
  beeperUrl: "http://localhost:23373",
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5:7b-instruct",
  repository: "",
  baseBranch: "main",
  calendarId: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};
export type Service = "beeper" | "ollama" | "github";
export interface Transport {
  request<T>(service: Service, path: string, method?: string, body?: unknown): Promise<T>;
}
export interface Store {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}
export function errorText(e: unknown): string {
  return e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : "Unexpected failure. Retry or open diagnostics.";
}
