import { AppState, CalendarEvent, Message, QueueItem, Settings, Snapshot, Store, defaults, errorText, validateProposal } from "./types";
import { Beeper } from "../adapters/beeper";
import { LocalModel } from "../adapters/model";
import { GitHubCalendar } from "../adapters/github";
import { DesktopTransport } from "../adapters/desktop";
import { DemoBeeper, DemoCalendar, DemoModel } from "../adapters/demo";
import { sameFields } from "./ics";
export function services(settings: Settings) {
  if (settings.mode === "demo") return { beeper: new DemoBeeper(), model: new DemoModel(), calendar: new DemoCalendar() };
  const transport = new DesktopTransport(settings);
  return { beeper: new Beeper(transport), model: new LocalModel(transport, settings), calendar: new GitHubCalendar(transport, settings) };
}
export class Controller {
  state: AppState = { version: 1, settings: { ...defaults }, queue: [] };
  private saving: Promise<void> = Promise.resolve();
  private active = new Set<string>();
  constructor(private store: Store, private changed: () => void) {}
  async load() {
    const saved = await this.store.load();
    if (saved) {
      if (saved.version !== 1 || !saved.settings || !Array.isArray(saved.queue)) throw new Error("Saved application state uses an unsupported format.");
      this.state = saved;
    }
    this.changed();
  }
  async save() {
    const copy = structuredClone(this.state);
    const next = this.saving.catch(() => {}).then(() => this.store.save(copy));
    this.saving = next; await next; this.changed();
  }
  async settings(settings: Settings) {
    if (!settings.timeZone || !settings.model) throw new Error("Choose a local model and time zone.");
    try { new Intl.DateTimeFormat("en", { timeZone: settings.timeZone }); } catch { throw new Error("Enter a valid IANA time zone, such as America/Los_Angeles."); }
    if (settings.mode === "live" && (!settings.repository || !settings.calendarId)) throw new Error("Set the private repository and calendar ID before enabling live mode.");
    this.state.settings = settings; await this.save();
  }
  private record(item: QueueItem, text: string) {
    item.updatedAt = new Date().toISOString(); item.history.push({ at: item.updatedAt, text }); item.lastError = undefined;
  }
  async propose(source: Message, context: Message[], snapshot: Snapshot, adjustment: string, target?: CalendarEvent): Promise<QueueItem> {
    const settings = { ...this.state.settings };
    const duplicate = this.state.queue.find(q => q.mode === settings.mode && q.source.id === source.id && q.source.chatID === source.chatID && q.stage !== "closed");
    if (duplicate) throw new Error("This source message already has a proposal in your activity. Open that proposal to continue.");
    const proposal = await services(settings).model.propose(source, context, adjustment, target);
    const now = new Date().toISOString();
    const item: QueueItem = { id: crypto.randomUUID(), mode: settings.mode, settings, createdAt: now, updatedAt: now, source, context, proposal, snapshot: { ...snapshot, events: [] }, target, stage: "review", history: [{ at: now, text: "Draft created locally. Review the event details before submitting." }] };
    this.state.queue.unshift(item); await this.save(); return item;
  }
  async edit(item: QueueItem, proposal: unknown) {
    if (item.stage !== "review") throw new Error("A submitted proposal is fixed for review. Close its pull request before making a fresh proposal.");
    item.proposal = validateProposal(proposal);
    if (item.proposal.action !== (item.target ? "update" : "create")) throw new Error("The proposal action cannot change during review.");
    this.record(item, "Event details adjusted locally."); await this.save();
  }
  async revise(item: QueueItem, adjustment: string) {
    const proposal = await services(item.settings).model.propose(item.source, item.context, adjustment, item.target);
    await this.edit(item, proposal);
  }
  private async locked(item: QueueItem, action: () => Promise<void>) {
    if (this.active.has(item.id)) throw new Error("This proposal already has an operation in progress.");
    this.active.add(item.id);
    try { await action(); } catch (e) { item.lastError = errorText(e); await this.save(); throw e; } finally { this.active.delete(item.id); }
  }
  async submit(item: QueueItem) {
    return this.locked(item, async () => {
      if (!["review", "submitting"].includes(item.stage)) throw new Error("This proposal was already submitted.");
      validateProposal(item.proposal);
      if (item.proposal.questions.length) throw new Error("Resolve the open questions before submitting.");
      if (item.target && sameFields(item.target.fields, item.proposal.event)) throw new Error("The proposal does not change the existing event.");
      const calendar = services(item.settings).calendar;
      item.submission ||= await calendar.prepare(item);
      item.stage = "submitting"; this.record(item, "Submission prepared with a stable proposal identity."); await this.save();
      await calendar.submit(item, () => this.save());
      item.stage = "pull_request"; this.record(item, item.mode === "demo" ? "Demo review created. No external write occurred." : "Pull request opened. Calendar has not been changed."); await this.save();
    });
  }
  async approve(item: QueueItem) {
    return this.locked(item, async () => {
      if (!["pull_request", "merging"].includes(item.stage)) throw new Error("Open the submitted review before approving.");
      item.stage = "merging"; this.record(item, "Approval recorded. Checking the exact reviewed change and validation."); await this.save();
      await services(item.settings).calendar.approve(item);
      item.stage = "awaiting_calendar"; this.record(item, item.mode === "demo" ? "Demo merge complete. Receipt confirmation is the next step." : "Merged. Awaiting calendar confirmation."); await this.save();
    });
  }
  async inspect(item: QueueItem) {
    return this.locked(item, async () => {
      if (!item.submission?.pr || ["confirmed", "closed"].includes(item.stage)) return;
      const result = await services(item.settings).calendar.inspect(item);
      if (item.stage !== result.stage) { item.stage = result.stage; this.record(item, result.detail); } else item.lastError = undefined;
      await this.save();
    });
  }
  async remove(item: QueueItem) {
    if (!["review", "confirmed", "closed"].includes(item.stage)) throw new Error("Keep this record until the pull request is closed or the calendar is confirmed.");
    this.state.queue = this.state.queue.filter(q => q.id !== item.id); await this.save();
  }
}
