import { describe, expect, it } from "vitest";
import { GitHubCalendar } from "../src/adapters/github";
import { HttpError } from "../src/adapters/desktop";
import { DemoCalendar, demoFields, demoMessage } from "../src/adapters/demo";
import { defaults, type QueueItem, type Service, type Transport } from "../src/core/types";
import { hash } from "../src/core/ics";
class FakeGitHub implements Transport {
  requests: { path: string; method: string; body: any }[] = [];
  branch?: string;
  raw = "";
  merged = false;
  pullExists = false;
  losePrResponse = false;
  receipt?: unknown;
  snapshot?: unknown;
  check = "success";
  head = "proposal-head";
  file = "";
  async request<T>(service: Service, url: string, method = "GET", body?: any): Promise<T> {
    expect(service).toBe("github");
    const path = url.replace("/repos/example/private-calendar", "");
    this.requests.push({ path, method, body });
    let value: any;
    if (path === "") value = { private: true };
    else if (path === "/git/ref/heads/main") value = { object: { sha: "current-main" } };
    else if (path.startsWith("/git/ref/heads/")) {
      if (!this.branch) throw new HttpError(404, "github");
      value = { object: { sha: this.branch } };
    } else if (path === "/git/refs" && method === "POST") {
      this.branch = body.sha;
      value = { object: { sha: this.branch } };
    } else if (path.startsWith("/git/commits/")) value = { tree: { sha: "base-tree" } };
    else if (path === "/git/blobs") {
      this.raw = body.content;
      value = { sha: "blob" };
    } else if (path === "/git/trees") {
      this.file = body.tree[0].path;
      value = { sha: "new-tree" };
    } else if (path === "/git/commits") value = { sha: "proposal-head" };
    else if (path.startsWith("/git/refs/heads/") && method === "PATCH") {
      this.branch = body.sha;
      value = {};
    } else if (path.startsWith("/pulls?")) value = this.pullExists ? [this.pull()] : [];
    else if (path === "/pulls" && method === "POST") {
      this.pullExists = true;
      if (this.losePrResponse) {
        this.losePrResponse = false;
        throw new Error("connection dropped after PR creation");
      }
      value = this.pull();
    } else if (path === "/pulls/7") value = this.pull();
    else if (path === "/pulls/7/files?per_page=100")
      value = [{ filename: this.file, status: "added" }];
    else if (path.includes("/check-runs"))
      value = {
        total_count: 1,
        check_runs: [
          {
            name: "validate",
            app: { slug: "github-actions" },
            status: this.check === "pending" ? "in_progress" : "completed",
            conclusion: this.check === "pending" ? null : this.check,
          },
        ],
      };
    else if (path.endsWith("/status")) value = { state: "pending", statuses: [] };
    else if (path === "/pulls/7/merge" && method === "PUT") {
      this.merged = true;
      value = { merged: true };
    } else if (path.startsWith("/contents/")) {
      const name = path.slice("/contents/".length).split("?")[0];
      let raw: string;
      if (name.startsWith("receipts/")) {
        if (!this.receipt) throw new HttpError(404, "github");
        raw = JSON.stringify(this.receipt);
      } else if (name.startsWith("calendars/")) {
        if (!this.snapshot) throw new HttpError(404, "github");
        raw = JSON.stringify(this.snapshot);
      } else raw = this.raw;
      value = {
        type: "file",
        encoding: "base64",
        content: btoa(unescape(encodeURIComponent(raw))),
      };
    } else throw new Error("Unexpected fake GitHub request " + method + " " + path);
    return value as T;
  }
  pull() {
    return {
      number: 7,
      html_url: "https://github.com/example/private-calendar/pull/7",
      state: this.merged ? "closed" : "open",
      merged: this.merged,
      merge_commit_sha: this.merged ? "merge-commit" : undefined,
      head: { sha: this.head },
      base: { ref: "main" },
    };
  }
}
async function setup() {
  const transport = new FakeGitHub();
  const settings = {
    ...defaults,
    mode: "live" as const,
    repository: "example/private-calendar",
    calendarId: "demo-calendar",
  };
  const adapter = new GitHubCalendar(transport, settings);
  const snapshot = await new DemoCalendar().snapshot();
  snapshot.sha = "base-sha";
  const item: QueueItem = {
    id: "12a717a2-bae8-4dcb-bc34-c4c402792584",
    mode: "live",
    settings,
    createdAt: "2026-09-15T12:00:00Z",
    updatedAt: "2026-09-15T12:00:00Z",
    source: demoMessage,
    context: [],
    proposal: { action: "create", event: demoFields, explanation: "", questions: [] },
    snapshot,
    stage: "submitting",
    history: [],
  };
  item.submission = await adapter.prepare(item);
  return { transport, adapter, item };
}
describe("reviewed calendar transaction", () => {
  it("recovers from a lost PR response without creating a duplicate event or PR", async () => {
    const { transport, adapter, item } = await setup();
    transport.losePrResponse = true;
    await expect(adapter.submit(item, async () => {})).rejects.toThrow("connection dropped");
    await adapter.submit(item, async () => {});
    expect(item.submission!.pr).toBe(7);
    expect(
      transport.requests.filter((r) => r.path === "/pulls" && r.method === "POST"),
    ).toHaveLength(1);
    expect(transport.requests.filter((r) => r.path === "/git/blobs")).toHaveLength(1);
    expect(transport.requests.some((r) => r.method === "PUT")).toBe(false);
  });
  it("rejects approval while checks are pending or failed, or the reviewed head changed", async () => {
    const { transport, adapter, item } = await setup();
    await adapter.submit(item, async () => {});
    transport.check = "pending";
    await expect(adapter.approve(item)).rejects.toThrow("validation");
    transport.check = "failure";
    await expect(adapter.approve(item)).rejects.toThrow("validation");
    transport.check = "success";
    transport.head = "other-head";
    await expect(adapter.approve(item)).rejects.toThrow("changed");
    expect(transport.merged).toBe(false);
  });
  it("never treats a merge or unrelated receipt as calendar confirmation", async () => {
    const { transport, adapter, item } = await setup();
    await adapter.submit(item, async () => {});
    await adapter.approve(item);
    expect((await adapter.inspect(item)).stage).toBe("awaiting_calendar");
    transport.receipt = { status: "applied", digest: "hash", eventId: "some-other-event" };
    expect((await adapter.inspect(item)).stage).toBe("awaiting_calendar");
    transport.receipt = { status: "applied", digest: "hash", eventId: item.submission!.eventId };
    expect((await adapter.inspect(item)).stage).toBe("awaiting_calendar");
    transport.snapshot = {
      version: 1,
      calendarId: item.snapshot.calendar.id,
      event: {
        id: item.submission!.eventId,
        etag: '"new-version"',
        summary: demoFields.title,
        description: demoFields.description,
        location: demoFields.location,
        start: { dateTime: demoFields.start },
        end: { dateTime: demoFields.end },
      },
    };
    expect((await adapter.inspect(item)).stage).toBe("confirmed");
    (transport.snapshot as any).event.location = "Wrong location";
    expect((await adapter.inspect(item)).stage).toBe("awaiting_calendar");
  });
  it("correlates update receipts to the first-parent merge commit and preserves ETag", async () => {
    const { adapter, item } = await setup();
    item.target = item.snapshot.events[0];
    item.proposal.action = "update";
    item.submission = await adapter.prepare(item);
    expect(item.submission.raw).toContain('X-GCAL-ETAG:"demo-version"');
    await adapter.submit(item, async () => {});
    await adapter.approve(item);
    await adapter.inspect(item);
    expect(item.submission.operationId).toBe(
      "ics-" + (await hash("merge-commit\0" + item.submission.path)),
    );
  });
});
