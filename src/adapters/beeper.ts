import { Message, Transport } from "../core/types";
interface ApiMessage {
  id: string;
  chatID: string;
  text?: string;
  timestamp: string;
  senderName?: string;
  isDeleted?: boolean;
  isHidden?: boolean;
}
interface Page {
  items: ApiMessage[];
  chats?: Record<string, { title: string }>;
  hasMore: boolean;
  oldestCursor?: string;
}
const normalize = (m: ApiMessage, title: string): Message => ({
  id: m.id,
  chatID: m.chatID,
  text: (m.text || "").slice(0, 8000),
  timestamp: m.timestamp,
  senderName: m.senderName || "Participant",
  chatTitle: title,
});
export class Beeper {
  constructor(private transport: Transport) {}
  async search(text: string): Promise<Message[]> {
    const words = text.trim().split(/\s+/).slice(0, 18).join(" ");
    if (!words) throw new Error("Copy or paste a Beeper message first.");
    const page = await this.transport.request<Page>(
      "beeper",
      "/v1/messages/search?" +
        new URLSearchParams({ query: words, limit: "20", excludeLowPriority: "false" }),
    );
    return page.items
      .filter((m) => m.text && !m.isDeleted && !m.isHidden)
      .map((m) => normalize(m, page.chats?.[m.chatID]?.title || "Beeper conversation"));
  }
  async context(source: Message): Promise<Message[]> {
    // The API does not promise a cursor derived from a message ID or sortKey.
    // Walk at most four opaque pages, and disclose when older context is unavailable.
    let cursor: string | undefined;
    const found = new Map<string, Message>();
    for (let i = 0; i < 4; i++) {
      const page: Page = await this.transport.request<Page>(
        "beeper",
        "/v1/chats/" +
          encodeURIComponent(source.chatID) +
          "/messages" +
          (cursor ? "?" + new URLSearchParams({ cursor, direction: "before" }) : ""),
      );
      for (const m of page.items)
        if (m.text && !m.isDeleted && !m.isHidden) found.set(m.id, normalize(m, source.chatTitle));
      if (found.has(source.id) || !page.hasMore || !page.oldestCursor) break;
      cursor = page.oldestCursor;
    }
    if (!found.has(source.id)) return [source];
    const messages = [...found.values()].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
    );
    const index = messages.findIndex((m) => m.id === source.id);
    return messages.slice(Math.max(0, index - 5), index + 6);
  }
  async focus(source: Message): Promise<void> {
    const response = await this.transport.request<{ success: boolean }>(
      "beeper",
      "/v1/focus",
      "POST",
      { chatID: source.chatID, messageID: source.id },
    );
    if (!response.success) throw new Error("Beeper could not open that message.");
  }
}
