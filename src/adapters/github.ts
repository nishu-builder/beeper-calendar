import {
  Calendar,
  CalendarEvent,
  QueueItem,
  Settings,
  Snapshot,
  Submission,
  Transport,
} from "../core/types";
import { hash, newEvent, parseEvent, sameFields, updateEvent } from "../core/ics";
import { HttpError } from "./desktop";
interface Tree {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string; mode: string; sha: string }[];
}
interface Pull {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
  merge_commit_sha?: string;
  head: { sha: string };
  base: { ref: string };
}
export class GitHubCalendar {
  private root: string;
  constructor(
    private transport: Transport,
    private settings: Settings,
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(settings.repository))
      throw new Error("Enter the private calendar data repository as owner/name.");
    this.root = "/repos/" + settings.repository;
  }
  private get<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return this.transport.request<T>("github", this.root + path, method, body);
  }
  private async optional<T>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return undefined;
      throw e;
    }
  }
  async read(path: string, ref: string): Promise<string> {
    const result = await this.get<{ encoding: string; content: string; type: string }>(
      "/contents/" + path + "?ref=" + encodeURIComponent(ref),
    );
    if (result.type !== "file" || result.encoding !== "base64")
      throw new Error("Expected a regular calendar file.");
    return new TextDecoder().decode(
      Uint8Array.from(atob(result.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
    );
  }
  async head(): Promise<string> {
    return (
      await this.get<{ object: { sha: string } }>(
        "/git/ref/heads/" + encodeURIComponent(this.settings.baseBranch),
      )
    ).object.sha;
  }
  async calendars(): Promise<Calendar[]> {
    const repo = await this.get<{ private: boolean }>("");
    if (!repo.private) throw new Error("Choose a private calendar data repository.");
    const sha = await this.head();
    const tree = await this.get<Tree>("/git/trees/" + sha + "?recursive=1");
    if (tree.truncated) throw new Error("This repository is too large to enumerate safely.");
    const paths = tree.tree.filter(
      (e) => e.mode === "100644" && /^calendars\/[0-9a-f]{64}\/calendar\.json$/.test(e.path),
    );
    if (paths.length > 50) throw new Error("Too many calendars in this repository.");
    const result: Calendar[] = [];
    for (const path of paths) {
      const c: Calendar = JSON.parse(await this.read(path.path, sha));
      if (c.version === 1 && c.id) result.push(c);
    }
    return result;
  }
  async snapshot(): Promise<Snapshot> {
    if (!this.settings.calendarId.trim()) throw new Error("Choose a calendar ID in Settings.");
    const repo = await this.get<{ private: boolean }>("");
    if (!repo.private)
      throw new Error(
        "Choose a private calendar data repository. Public calendar repositories are blocked.",
      );
    const sha = await this.head();
    const calendarHash = await hash(this.settings.calendarId);
    const calendar: Calendar = JSON.parse(
      await this.read("calendars/" + calendarHash + "/calendar.json", sha),
    );
    if (calendar.version !== 1 || calendar.id !== this.settings.calendarId)
      throw new Error("Calendar metadata does not match the selected calendar.");
    const tree = await this.get<Tree>("/git/trees/" + sha + "?recursive=1");
    if (tree.truncated) throw new Error("This repository is too large to enumerate safely.");
    const paths = tree.tree.filter(
      (e) =>
        e.type === "blob" &&
        e.mode === "100644" &&
        e.path.startsWith("events/" + calendarHash + "/") &&
        e.path.endsWith(".ics"),
    );
    if (paths.length > 300)
      throw new Error("This version supports at most 300 editable events per calendar.");
    const events: CalendarEvent[] = [];
    for (const path of paths) {
      const raw = await this.read(path.path, sha);
      try {
        events.push(parseEvent(path.path, raw, calendar.id));
      } catch {
        /* Unsupported exported event types are intentionally read-only. */
      }
    }
    return { sha, calendar, events, loadedAt: new Date().toISOString() };
  }
  async prepare(item: QueueItem): Promise<Submission> {
    const data = item.target
      ? {
          path: item.target.path,
          raw: updateEvent(item.target, item.proposal.event),
          eventId: item.target.id,
        }
      : await newEvent(item.snapshot.calendar, item.id, item.proposal.event, item.createdAt);
    return { ...data, branch: "beeper-calendar/" + item.id, baseSha: item.snapshot.sha };
  }
  async submit(item: QueueItem, persist: () => Promise<void>): Promise<void> {
    const s = item.submission!;
    if (!s) throw new Error("Persist the proposal before submission.");
    let ref = await this.optional<{ object: { sha: string } }>(
      "/git/ref/heads/" + encodeURIComponent(s.branch),
    );
    if (!ref) {
      try {
        ref = await this.get("/git/refs", "POST", {
          ref: "refs/heads/" + s.branch,
          sha: s.baseSha,
        });
      } catch (e) {
        ref = await this.optional("/git/ref/heads/" + encodeURIComponent(s.branch));
        if (!ref) throw e;
      }
    }
    if (!ref) throw new Error("Could not resolve the proposal branch.");
    if (ref.object.sha === s.baseSha) {
      const base = await this.get<{ tree: { sha: string } }>("/git/commits/" + s.baseSha);
      const blob = await this.get<{ sha: string }>("/git/blobs", "POST", {
        content: s.raw,
        encoding: "utf-8",
      });
      const tree = await this.get<{ sha: string }>("/git/trees", "POST", {
        base_tree: base.tree.sha,
        tree: [{ path: s.path, mode: "100644", type: "blob", sha: blob.sha }],
      });
      const commit = await this.get<{ sha: string }>("/git/commits", "POST", {
        message: "Review calendar proposal " + item.id,
        tree: tree.sha,
        parents: [s.baseSha],
      });
      s.headSha = commit.sha;
      await persist();
      await this.get("/git/refs/heads/" + encodeURIComponent(s.branch), "PATCH", {
        sha: commit.sha,
        force: false,
      });
    } else {
      const raw = await this.read(s.path, ref.object.sha);
      if (raw !== s.raw)
        throw new Error("The proposal branch changed. Review it in GitHub before continuing.");
      s.headSha = ref.object.sha;
      await persist();
    }
    const owner = this.settings.repository.split("/")[0];
    const existing = await this.get<Pull[]>(
      "/pulls?state=all&head=" + encodeURIComponent(owner + ":" + s.branch),
    );
    let pr = existing[0];
    if (!pr)
      pr = await this.get<Pull>("/pulls", "POST", {
        title:
          (item.proposal.action === "create" ? "Create: " : "Update: ") + item.proposal.event.title,
        head: s.branch,
        base: this.settings.baseBranch,
        draft: false,
        body:
          "Reviewed in Beeper Calendar.\n\nThis pull request changes one ordinary calendar event. Merge only after calendar validation passes. Calendar application is confirmed separately by the bridge receipt and refreshed snapshot.\n\nProposal: " +
          item.id,
      });
    s.pr = pr.number;
    s.prUrl = pr.html_url;
    await persist();
  }
  async approve(item: QueueItem): Promise<void> {
    const s = item.submission!;
    const pr = await this.get<Pull>("/pulls/" + s.pr);
    if (pr.merged) return;
    if (
      pr.state !== "open" ||
      pr.head.sha !== s.headSha ||
      pr.base.ref !== this.settings.baseBranch
    )
      throw new Error("The pull request changed or closed. Review it in GitHub.");
    const files = await this.get<{ filename: string; status: string }[]>(
      "/pulls/" + s.pr + "/files?per_page=100",
    );
    if (
      files.length !== 1 ||
      files[0].filename !== s.path ||
      !["added", "modified"].includes(files[0].status) ||
      (await this.read(s.path, pr.head.sha)) !== s.raw
    )
      throw new Error("The pull request no longer matches the reviewed calendar change.");
    const checks = await this.get<{
      total_count: number;
      check_runs: {
        name: string;
        app?: { slug: string };
        status: string;
        conclusion: string | null;
      }[];
    }>("/commits/" + pr.head.sha + "/check-runs?per_page=100");
    const statuses = await this.get<{ state: string; statuses: unknown[] }>(
      "/commits/" + pr.head.sha + "/status",
    );
    if (
      !checks.check_runs.some((c) => c.name === "validate" && c.app?.slug === "github-actions") ||
      checks.total_count > 100 ||
      checks.check_runs.some((c) => c.status !== "completed" || c.conclusion !== "success") ||
      (statuses.statuses.length > 0 && statuses.state !== "success")
    )
      throw new Error(
        "Calendar validation must pass before approval. Open the pull request to inspect pending or failed checks, then retry.",
      );
    const merged = await this.get<{ merged: boolean }>("/pulls/" + s.pr + "/merge", "PUT", {
      sha: s.headSha,
      merge_method: "squash",
    });
    if (!merged.merged)
      throw new Error(
        "GitHub did not merge the reviewed change. Inspect the pull request before retrying.",
      );
  }
  async inspect(item: QueueItem): Promise<{
    stage: "pull_request" | "awaiting_calendar" | "confirmed" | "closed";
    detail: string;
  }> {
    const s = item.submission!;
    const pr = await this.get<Pull>("/pulls/" + s.pr);
    if (!pr.merged)
      return pr.state === "closed"
        ? { stage: "closed", detail: "The pull request was closed without merging." }
        : {
            stage: "pull_request",
            detail: "Awaiting your approval and successful calendar validation.",
          };
    s.mergeSha = pr.merge_commit_sha;
    if (!s.operationId && s.mergeSha)
      s.operationId = "ics-" + (await hash(s.mergeSha + "\0" + s.path));
    const waiting = {
      stage: "awaiting_calendar" as const,
      detail:
        "Merged. Awaiting the matching bridge receipt and refreshed calendar snapshot. Check the Calendar bridge workflow if this takes longer than expected.",
    };
    if (!s.operationId) return waiting;
    const sha = await this.head();
    const receiptPath = "receipts/" + s.operationId + ".json";
    let receipt: { status: string; eventId: string; digest: string };
    try {
      receipt = JSON.parse(await this.read(receiptPath, sha));
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return waiting;
      throw e;
    }
    if (receipt.status !== "applied" || receipt.eventId !== s.eventId || !receipt.digest)
      return waiting;
    const snapshotPath =
      "calendars/" +
      (await hash(item.snapshot.calendar.id)) +
      "/events/" +
      (await hash(s.eventId)) +
      ".json";
    let snapshot: {
      version: number;
      calendarId: string;
      event: {
        id: string;
        etag: string;
        summary?: string;
        description?: string;
        location?: string;
        start: { dateTime?: string };
        end: { dateTime?: string };
        status?: string;
      };
    };
    try {
      snapshot = JSON.parse(await this.read(snapshotPath, sha));
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return waiting;
      throw e;
    }
    const e = snapshot.event;
    if (
      snapshot.version !== 1 ||
      snapshot.calendarId !== item.snapshot.calendar.id ||
      e.id !== s.eventId ||
      !e.etag ||
      e.status === "cancelled" ||
      !e.start.dateTime ||
      !e.end.dateTime
    )
      return waiting;
    if (item.target && e.etag === item.target.etag) return waiting;
    if (
      !sameFields(item.proposal.event, {
        title: e.summary || "",
        description: e.description || "",
        location: e.location || "",
        start: e.start.dateTime,
        end: e.end.dateTime,
      })
    )
      return waiting;
    return {
      stage: "confirmed",
      detail:
        "The bridge receipt reports applied and the refreshed Google Calendar snapshot matches your reviewed event.",
    };
  }
}
