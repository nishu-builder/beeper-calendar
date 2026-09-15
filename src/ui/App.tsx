import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Controller, services } from "../core/controller";
import { CalendarProposal, Message, QueueItem, Settings, Snapshot, errorText } from "../core/types";
import { DesktopTransport, desktopStore, native } from "../adapters/desktop";
import { sampleText } from "../adapters/demo";
import { GitHubCalendar } from "../adapters/github";
const labels: Record<QueueItem["stage"], string> = {
  review: "Ready to review",
  submitting: "Submission pending",
  pull_request: "Awaiting approval",
  merging: "Approval pending",
  awaiting_calendar: "Awaiting calendar confirmation",
  confirmed: "Confirmed",
  closed: "Closed",
};
const fmt = (value: string, zone?: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  }).format(new Date(value));
function Mark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect x="3" y="6" width="34" height="30" rx="8" fill="currentColor" />
      <path
        d="M12 3v9m16-9v9M11 19h18m-16 7 4 4 10-10"
        fill="none"
        stroke="var(--lime)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function App() {
  const [, render] = useReducer((n) => n + 1, 0);
  const controller = useRef(new Controller(desktopStore, () => render())).current;
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState("");
  const [view, setView] = useState<"compose" | "activity" | "settings">("compose");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [candidates, setCandidates] = useState<Message[]>([]);
  const [source, setSource] = useState<Message>();
  const [context, setContext] = useState<Message[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [targetId, setTargetId] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [selected, setSelected] = useState<string>();
  const item = controller.state.queue.find((q) => q.id === selected);
  const mode = controller.state.settings.mode;
  const perform = useCallback(async (name: string, action: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(name);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }, []);
  useEffect(() => {
    controller
      .load()
      .then(() => setReady(true))
      .catch((e) => setFatal(errorText(e)));
  }, [controller]);
  const capture = useCallback(
    () =>
      perform("Reading copied message", async () => {
        setCopied(await native.clipboard());
        setSource(undefined);
        setCandidates([]);
        setSelected(undefined);
        setView("compose");
      }),
    [perform],
  );
  useEffect(() => {
    if (!native.isDesktop) return;
    const listeners = [
      listen("capture-message", () => void capture()),
      listen<string>("shortcut-unavailable", (e) => setNotice(e.payload)),
    ];
    return () => {
      for (const listener of listeners) void listener.then((unlisten) => unlisten());
    };
  }, [capture]);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      if (busy) return;
      const pending = controller.state.queue
        .filter((q) => q.mode === "live" && q.stage === "awaiting_calendar")
        .slice(0, 3);
      void (async () => {
        for (const q of pending) {
          try {
            await controller.inspect(q);
          } catch {
            /* Persisted on the item for inspection. */
          }
        }
      })();
    }, 30_000);
    return () => clearInterval(timer);
  }, [busy, controller, ready]);
  async function search(text = copied) {
    await perform("Finding the source message", async () => {
      setSelected(undefined);
      setSource(undefined);
      setSnapshot(undefined);
      setCandidates(await services(controller.state.settings).beeper.search(text));
    });
  }
  async function choose(message: Message) {
    await perform("Loading conversation and calendar", async () => {
      const adapters = services(controller.state.settings);
      const nearby = await adapters.beeper.context(message);
      const calendar = await adapters.calendar.snapshot();
      setSource(message);
      setContext(nearby);
      setSnapshot(calendar);
      setTargetId("");
    });
  }
  function fresh() {
    setSelected(undefined);
    setSource(undefined);
    setCandidates([]);
    setSnapshot(undefined);
    setCopied("");
    setAdjustment("");
    setError("");
    setNotice("");
    setView("compose");
  }
  if (fatal)
    return (
      <main className="fatal">
        <h1>We couldn’t open your saved activity.</h1>
        <p role="alert">{fatal}</p>
        <p>
          Your stored proposals have been preserved. See the recovery guide in the repository before
          changing application data.
        </p>
      </main>
    );
  if (!ready)
    return (
      <main className="fatal">
        <Mark />
        <p>Opening Beeper Calendar…</p>
      </main>
    );
  return (
    <div className="app">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("compose");
          }}
        >
          <span className="brand-mark">
            <Mark />
          </span>
          <span>
            Beeper Calendar<small>Message → calendar proposal</small>
          </span>
        </a>
        <nav aria-label="Main">
          <button
            aria-current={view === "compose" ? "page" : undefined}
            onClick={() => setView("compose")}
          >
            Compose
          </button>
          <button
            aria-current={view === "activity" ? "page" : undefined}
            onClick={() => setView("activity")}
          >
            Activity <span className="count">{controller.state.queue.length}</span>
          </button>
          <button
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </nav>
        <span className={"mode " + mode}>
          <span />
          {mode === "demo" ? "Demo mode" : "Local model"}
        </span>
      </header>
      {mode === "demo" && (
        <div className="demo-banner">
          DEMO WORKSPACE{" "}
          <span>
            Sample conversations and simulated calendar changes. Nothing is sent or published.
          </span>
        </div>
      )}
      <main>
        {busy && (
          <div role="status" className="notice loading">
            <span className="spinner" />
            {busy}…
          </div>
        )}
        {error && (
          <div role="alert" className="notice error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {view === "settings" ? (
          <SettingsPanel
            settings={controller.state.settings}
            disabled={!!busy}
            run={perform}
            onSave={async (s) => {
              await controller.settings(s);
              fresh();
              setView("settings");
              setNotice("Settings saved. New proposals will use these connections.");
            }}
          />
        ) : view === "activity" ? (
          <>
            <div className="page-title">
              <div>
                <p className="eyebrow">CALENDAR ACTIVITY</p>
                <h1>Calendar activity</h1>
                <p>Review what was proposed, approved and confirmed.</p>
              </div>
              <button className="primary" onClick={fresh}>
                New proposal
              </button>
            </div>
            {!controller.state.queue.length ? (
              <div className="empty">
                <h2>No proposals yet.</h2>
                <p>Your first reviewed proposal will appear in this space.</p>
                <button onClick={fresh}>Create a proposal</button>
              </div>
            ) : (
              <div className="activity-list">
                {controller.state.queue.map((q) => (
                  <button
                    key={q.id}
                    className="activity-row"
                    onClick={() => {
                      setSelected(q.id);
                      setView("compose");
                    }}
                  >
                    <span className="date-tile">
                      <strong>{new Date(q.proposal.event.start).getDate()}</strong>
                      <small>
                        {new Date(q.proposal.event.start).toLocaleDateString("en", {
                          month: "short",
                        })}
                      </small>
                    </span>
                    <span>
                      <strong>{q.proposal.event.title}</strong>
                      <small>
                        {q.source.chatTitle} · {q.mode === "demo" ? "Demo" : "Live"} ·{" "}
                        {q.proposal.action}
                      </small>
                    </span>
                    <span className={"stage " + q.stage}>{labels[q.stage]}</span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="page-title">
              <div>
                <p className="eyebrow">FROM CONVERSATION TO CALENDAR</p>
                <h1>Create a calendar proposal.</h1>
                <p>Bring a message. Make a plan. Check every detail.</p>
              </div>
              <div className="shortcut">
                <kbd>⌘</kbd>
                <kbd>⇧</kbd>
                <kbd>K</kbd>
                <span>Use copied message</span>
              </div>
            </div>
            <div className="workspace">
              <section className="panel source-panel">
                <div className="panel-heading">
                  <span className="step">01</span>
                  <h2>The conversation</h2>
                  {item && (
                    <button className="quiet" onClick={fresh}>
                      Start fresh
                    </button>
                  )}
                </div>
                {item ? (
                  <SourceView
                    source={item.source}
                    context={item.context}
                    onOpen={() =>
                      void perform("Opening source", async () => {
                        if (item.mode === "demo")
                          setNotice("This is the demo conversation shown below.");
                        else await services(item.settings).beeper.focus(item.source);
                      })
                    }
                  />
                ) : (
                  <>
                    <p className="muted">
                      Copy a message in Beeper, then use the shortcut or paste it here.
                    </p>
                    <label className="sr-only" htmlFor="copied-message">
                      Copied message
                    </label>
                    <textarea
                      id="copied-message"
                      className="message-input"
                      rows={4}
                      maxLength={16000}
                      placeholder="“Let’s grab coffee on Friday at 10…”"
                      value={copied}
                      onChange={(e) => setCopied(e.target.value)}
                    />
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={!!busy || !copied.trim()}
                        onClick={() => void search()}
                      >
                        Find in Beeper <span aria-hidden="true">→</span>
                      </button>
                      <button disabled={!!busy} onClick={() => void capture()}>
                        Paste clipboard
                      </button>
                    </div>
                    {mode === "demo" && (
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => {
                          setCopied(sampleText);
                          void search(sampleText);
                        }}
                      >
                        Try the sample conversation
                      </button>
                    )}
                    {candidates.length > 0 && !source && (
                      <div className="candidates">
                        <p className="eyebrow">CHOOSE THE SOURCE</p>
                        {candidates.map((m) => (
                          <button
                            className="candidate"
                            key={m.chatID + m.id}
                            onClick={() => void choose(m)}
                            disabled={!!busy}
                          >
                            <strong>{m.chatTitle}</strong>
                            <span>{m.text}</span>
                            <small>
                              {m.senderName} · {fmt(m.timestamp)}
                            </small>
                          </button>
                        ))}
                        <p className="hint">
                          Check the sender and date, especially when several messages match.
                        </p>
                      </div>
                    )}
                    {candidates.length === 0 && copied && !busy && (
                      <p className="hint">
                        Search uses the first 18 words. You can shorten the text to find the
                        original message.
                      </p>
                    )}
                    {source && (
                      <>
                        <SourceView
                          source={source}
                          context={context}
                          onOpen={() =>
                            void perform("Opening source", async () => {
                              if (mode === "demo") setNotice("This is a sample conversation.");
                              else await services(controller.state.settings).beeper.focus(source);
                            })
                          }
                        />
                        <label className="field">
                          Calendar action
                          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                            <option value="">Create a new event</option>
                            {snapshot?.events.map((e) => (
                              <option key={e.id} value={e.id}>
                                Update: {e.fields.title} ·{" "}
                                {fmt(e.fields.start, snapshot.calendar.timeZone)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          Anything to add?
                          <textarea
                            value={adjustment}
                            onChange={(e) => setAdjustment(e.target.value)}
                            maxLength={2000}
                            placeholder="For example: use September 18, 10–11 AM Pacific."
                            rows={2}
                          />
                        </label>
                        <p className="hint">
                          {snapshot?.calendar.summary} · {snapshot?.calendar.timeZone}
                          <br />
                          {snapshot?.events.length} ordinary timed events available to update. Other
                          event types remain read-only.
                        </p>
                        <button
                          className="primary full"
                          disabled={!!busy || !snapshot}
                          onClick={() =>
                            void perform(
                              mode === "demo"
                                ? "Preparing demo proposal"
                                : "Asking your local model",
                              async () => {
                                const q = await controller.propose(
                                  source,
                                  context,
                                  snapshot!,
                                  adjustment,
                                  snapshot!.events.find((e) => e.id === targetId),
                                );
                                setSelected(q.id);
                              },
                            )
                          }
                        >
                          Prepare proposal <span aria-hidden="true">→</span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </section>
              <section className="panel proposal-panel">
                <div className="panel-heading">
                  <span className="step">02</span>
                  <h2>The plan</h2>
                  {item && <span className={"stage " + item.stage}>{labels[item.stage]}</span>}
                </div>
                {item ? (
                  <ProposalView
                    key={item.id}
                    item={item}
                    busy={!!busy}
                    run={perform}
                    controller={controller}
                    onRemove={() => {
                      setSelected(undefined);
                      fresh();
                    }}
                  />
                ) : (
                  <div className="proposal-empty">
                    <div className="calendar-art">
                      <span>FRIDAY</span>
                      <strong>18</strong>
                      <div className="art-pill">Review your event</div>
                    </div>
                    <h3>Review before making changes.</h3>
                    <p>
                      Your local model turns the selected conversation into a proposal. You review
                      and approve every calendar change.
                    </p>
                    <ol className="small-steps">
                      <li>Find the right message</li>
                      <li>Review the event details</li>
                      <li>Approve, then confirm</li>
                    </ol>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <footer>
        <span>
          Beeper Calendar <small>v0.1</small>
        </span>
        <span>
          {mode === "demo"
            ? "Demo data stays in this workspace."
            : "Inference stays on this Mac. Reviewed calendar edits go to your private repository."}
        </span>
        <button onClick={() => setView("settings")}>Connection settings</button>
      </footer>
    </div>
  );
}
function SourceView({
  source,
  context,
  onOpen,
}: {
  source: Message;
  context: Message[];
  onOpen: () => void;
}) {
  return (
    <div className="source-view">
      <div className="source-title">
        <div className="avatar">{source.senderName.slice(0, 1)}</div>
        <div>
          <strong>{source.chatTitle}</strong>
          <small>
            {source.senderName} · {fmt(source.timestamp)}
          </small>
        </div>
        <button className="quiet" onClick={onOpen}>
          Open source ↗
        </button>
      </div>
      <blockquote>{source.text}</blockquote>
      <details>
        <summary>
          Nearby context <span>{context.length} messages</span>
        </summary>
        {context.map((m) => (
          <div className={"context-message " + (m.id === source.id ? "chosen" : "")} key={m.id}>
            <small>
              {m.senderName} · {fmt(m.timestamp)}
            </small>
            <p>{m.text}</p>
          </div>
        ))}
        {context.length === 1 && (
          <p className="hint">
            The source is older than the bounded context window. Only the selected message will be
            used.
          </p>
        )}
      </details>
    </div>
  );
}
function ProposalView({
  item,
  busy,
  run,
  controller,
  onRemove,
}: {
  item: QueueItem;
  busy: boolean;
  run: (name: string, action: () => Promise<void>) => Promise<void>;
  controller: Controller;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<CalendarProposal>(structuredClone(item.proposal));
  const [adjust, setAdjust] = useState("");
  const [edit, setEdit] = useState(false);
  const review = item.stage === "review";
  const zone = item.settings.timeZone;
  useEffect(() => {
    setDraft(structuredClone(item.proposal));
  }, [item.proposal]);
  const field = (key: keyof CalendarProposal["event"], value: string) =>
    setDraft((d) => ({ ...d, event: { ...d.event, [key]: value } }));
  return (
    <>
      <div className="event-card">
        <p className="eyebrow">
          {item.proposal.action === "create" ? "NEW EVENT" : "PROPOSED CHANGE"}{" "}
          <span>{item.snapshot.calendar.summary}</span>
        </p>
        <h3>{item.proposal.event.title}</h3>
        <p className="event-time">
          {fmt(item.proposal.event.start, zone)}
          <br />
          <span>to {fmt(item.proposal.event.end, zone)}</span>
        </p>
        {item.proposal.event.location && (
          <p className="event-location">{item.proposal.event.location}</p>
        )}
        {item.proposal.event.description && (
          <p className="event-description">{item.proposal.event.description}</p>
        )}
      </div>
      {item.target && (
        <details className="before" open>
          <summary>Before this change</summary>
          <strong>{item.target.fields.title}</strong>
          <p>
            {fmt(item.target.fields.start, zone)} — {fmt(item.target.fields.end, zone)}
          </p>
          <p>{item.target.fields.location || "No location"}</p>
          <p>{item.target.fields.description || "No description"}</p>
        </details>
      )}
      <p className="reason">{item.proposal.explanation}</p>
      {item.proposal.questions.length > 0 && (
        <div className="questions">
          <strong>A few details need your attention.</strong>
          <ul>
            {item.proposal.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <p>
            Adjust the proposal with an answer, or edit the fields and mark the questions resolved.
          </p>
        </div>
      )}
      {item.lastError && (
        <p className="notice error" role="alert">
          {item.lastError}
        </p>
      )}
      {review && (
        <>
          <div className="button-row">
            <button disabled={busy} onClick={() => setEdit(!edit)}>
              {edit ? "Close editor" : "Edit details"}
            </button>
            <span className="hint">Times shown in {zone}</span>
          </div>
          {edit && (
            <form
              className="editor"
              onSubmit={(e) => {
                e.preventDefault();
                void run("Saving your edits", async () => {
                  await controller.edit(item, draft);
                  setEdit(false);
                });
              }}
            >
              <label className="field">
                Title
                <input
                  required
                  maxLength={300}
                  value={draft.event.title}
                  onChange={(e) => field("title", e.target.value)}
                />
              </label>
              <label className="field">
                Start · include UTC offset
                <input
                  required
                  value={draft.event.start}
                  onChange={(e) => field("start", e.target.value)}
                  placeholder="2026-09-18T10:00:00-07:00"
                />
              </label>
              <label className="field">
                End · include UTC offset
                <input
                  required
                  value={draft.event.end}
                  onChange={(e) => field("end", e.target.value)}
                />
              </label>
              <label className="field">
                Location
                <input
                  maxLength={1000}
                  value={draft.event.location}
                  onChange={(e) => field("location", e.target.value)}
                />
              </label>
              <label className="field">
                Description
                <textarea
                  maxLength={8000}
                  rows={3}
                  value={draft.event.description}
                  onChange={(e) => field("description", e.target.value)}
                />
              </label>
              {draft.questions.length > 0 && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) setDraft((d) => ({ ...d, questions: [] }));
                    }}
                  />
                  I have answered the open questions in these event details.
                </label>
              )}
              <button className="primary" disabled={busy}>
                Save details
              </button>
            </form>
          )}
          <label className="field adjust">
            Refine the proposal
            <textarea
              rows={2}
              maxLength={2000}
              placeholder={
                item.mode === "demo"
                  ? "In demo mode, this replaces the event title."
                  : "Make it half an hour later, or add more detail…"
              }
              value={adjust}
              onChange={(e) => setAdjust(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !adjust.trim()}
            onClick={() =>
              void run("Refining the proposal", async () => {
                await controller.revise(item, adjust);
                setAdjust("");
              })
            }
          >
            Apply adjustment
          </button>
          <div className="approval">
            <p>
              Next: open a review in your private calendar repository. Your calendar changes only
              after you approve that review.
            </p>
            <button
              className="primary full"
              disabled={busy || !!item.proposal.questions.length || edit}
              onClick={() => void run("Opening calendar review", () => controller.submit(item))}
            >
              {item.mode === "demo" ? "Create demo review" : "Open calendar review"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      )}
      {item.stage === "submitting" && (
        <button
          className="primary full"
          disabled={busy}
          onClick={() => void run("Resuming the same submission", () => controller.submit(item))}
        >
          Resume submission
        </button>
      )}
      {["pull_request", "merging"].includes(item.stage) && (
        <div className="approval">
          <p>
            Approval merges this exact reviewed event after validation. The bridge will then apply
            it to Google Calendar using its configured notification policy.
          </p>
          <button
            className="primary full"
            disabled={busy}
            onClick={() => void run("Approving the reviewed event", () => controller.approve(item))}
          >
            {item.mode === "demo" ? "Approve demo change" : "Approve calendar change"}
          </button>
        </div>
      )}
      {item.stage === "awaiting_calendar" && (
        <div className="awaiting">
          <strong>Approved. Waiting for your calendar.</strong>
          <p>
            The bridge runs after merge and on its schedule. This can take several minutes. A merge
            alone does not confirm an event.
          </p>
        </div>
      )}
      {item.stage === "confirmed" && (
        <div className="confirmed-message">
          <strong>
            {item.mode === "demo" ? "Demo flow complete." : "Confirmed in the calendar snapshot."}
          </strong>
          <p>
            {item.mode === "demo"
              ? "You’ve walked through review, approval and receipt confirmation. Open Settings to connect your real services."
              : "The matching receipt reports applied, and the refreshed snapshot agrees with the event you reviewed."}
          </p>
        </div>
      )}
      <div className="button-row">
        {item.submission?.prUrl && (
          <button
            disabled={busy}
            onClick={() =>
              void run("Opening GitHub", async () => {
                await native.openLink(item.submission!.prUrl!);
              })
            }
          >
            Open pull request ↗
          </button>
        )}
        {item.submission?.pr && !["confirmed", "closed"].includes(item.stage) && (
          <button
            disabled={busy}
            onClick={() =>
              void run("Checking receipt and snapshot", () => controller.inspect(item))
            }
          >
            Check status
          </button>
        )}
        {["review", "confirmed", "closed"].includes(item.stage) && (
          <button
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run("Removing local proposal", async () => {
                await controller.remove(item);
                onRemove();
              })
            }
          >
            {review ? "Discard draft" : "Remove local record"}
          </button>
        )}
      </div>
      <details className="history">
        <summary>
          Activity &amp; evidence <span>{item.history.length} steps</span>
        </summary>
        <ol>
          {item.history.map((h, i) => (
            <li key={i}>
              <small>{fmt(h.at)}</small>
              <p>{h.text}</p>
            </li>
          ))}
        </ol>
        {item.submission && (
          <div className="evidence">
            <p>Proposal: {item.id}</p>
            <p>Base: {item.submission.baseSha}</p>
            {item.submission.mergeSha && <p>Merge: {item.submission.mergeSha}</p>}
            {item.submission.operationId && <p>Receipt: {item.submission.operationId}</p>}
          </div>
        )}
      </details>
    </>
  );
}
function SettingsPanel({
  settings,
  disabled,
  run,
  onSave,
}: {
  settings: Settings;
  disabled: boolean;
  run: (name: string, action: () => Promise<void>) => Promise<void>;
  onSave: (s: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [githubToken, setGithubToken] = useState("");
  const [credentials, setCredentials] = useState({ beeper: false, github: false });
  const [diagnostics, setDiagnostics] = useState<{ name: string; ok: boolean; detail: string }[]>(
    [],
  );
  const [calendars, setCalendars] = useState<{ id: string; summary: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const change = (key: keyof Settings, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const refresh = async () => setCredentials(await native.credentials());
  useEffect(() => {
    void refresh();
  }, []);
  async function diagnose() {
    const transport = new DesktopTransport(draft);
    const results: typeof diagnostics = [];
    for (const [name, check] of [
      ["Beeper", () => transport.request("beeper", "/v1/info")],
      [
        "Local model",
        async () => {
          const result = await transport.request<{ models: { name: string }[] }>(
            "ollama",
            "/api/tags",
          );
          setModels(result.models.map((m) => m.name));
          if (!result.models.some((m) => m.name === draft.model))
            throw new Error(
              "The selected model is not installed in Ollama. Choose an installed model below.",
            );
        },
      ],
      [
        "Calendar bridge",
        async () => {
          const snap = await new GitHubCalendar(transport, draft).snapshot();
          return snap;
        },
      ],
    ] as [string, () => Promise<unknown>][]) {
      try {
        await check();
        results.push({ name, ok: true, detail: "Connected and readable" });
      } catch (e) {
        results.push({ name, ok: false, detail: errorText(e) });
      }
      setDiagnostics([...results]);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">DESKTOP SETTINGS</p>
          <h1>Connections and settings.</h1>
          <p>Connect Beeper, an installed local model and your private calendar bridge.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>Connections</h2>
          <p className="muted">
            Credentials are stored in your system keychain. Message context is processed locally.
          </p>
          <div className="connection">
            <h3>
              <span className="step">1</span>Beeper Desktop{" "}
              <span className={"connection-state " + (credentials.beeper ? "ok" : "")}>
                {credentials.beeper ? "Access saved" : "Not connected"}
              </span>
            </h3>
            <label className="field">
              Local API address
              <input
                value={draft.beeperUrl}
                onChange={(e) => change("beeperUrl", e.target.value)}
              />
            </label>
            <p className="hint">
              Enable Desktop API in Beeper → Settings → Developers / Integrations. Connecting opens
              Beeper’s local authorization page.
            </p>
            <button
              disabled={disabled || !native.isDesktop}
              onClick={() =>
                void run("Connecting to Beeper", async () => {
                  await native.connectBeeper(draft.beeperUrl);
                  await refresh();
                })
              }
            >
              Connect Beeper
            </button>
            {credentials.beeper && (
              <button
                className="quiet"
                disabled={disabled}
                onClick={() =>
                  void run("Disconnecting Beeper", async () => {
                    await native.saveSecret("beeper", "");
                    await refresh();
                  })
                }
              >
                Disconnect
              </button>
            )}
          </div>
          <div className="connection">
            <h3>
              <span className="step">2</span>Local model
            </h3>
            <label className="field">
              Ollama address
              <input
                value={draft.ollamaUrl}
                onChange={(e) => change("ollamaUrl", e.target.value)}
              />
            </label>
            <label className="field">
              Installed model
              <input
                list="installed-models"
                value={draft.model}
                onChange={(e) => change("model", e.target.value)}
              />
              <datalist id="installed-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <p className="hint">
              Install Ollama and a model that supports structured JSON, such as qwen2.5:7b-instruct.
              There is no cloud fallback.
            </p>
          </div>
          <div className="connection">
            <h3>
              <span className="step">3</span>GitHub calendar bridge{" "}
              <span className={"connection-state " + (credentials.github ? "ok" : "")}>
                {credentials.github ? "Access saved" : "Not connected"}
              </span>
            </h3>
            <p className="hint">
              Use an existing GitHub CLI sign-in, or a fine-grained token for your private data
              repository: Contents and Pull requests read/write; Checks and Commit statuses read.
            </p>
            <button
              disabled={disabled || !native.isDesktop}
              onClick={() =>
                void run("Connecting GitHub", async () => {
                  await invoke("connect_github_cli");
                  await refresh();
                })
              }
            >
              Use GitHub CLI sign-in
            </button>
            <details>
              <summary>Use a repository token instead</summary>
              <label className="field">
                GitHub token
                <input
                  type="password"
                  autoComplete="off"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="Stored only in your keychain"
                />
              </label>
              <button
                disabled={disabled || !githubToken || !native.isDesktop}
                onClick={() =>
                  void run("Saving GitHub credential", async () => {
                    await native.saveSecret("github", githubToken);
                    setGithubToken("");
                    await refresh();
                  })
                }
              >
                Save GitHub token
              </button>
            </details>
            {credentials.github && (
              <button
                className="quiet"
                disabled={disabled}
                onClick={() =>
                  void run("Disconnecting GitHub", async () => {
                    await native.saveSecret("github", "");
                    await refresh();
                  })
                }
              >
                Disconnect GitHub
              </button>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Your workspace</h2>
          <label className="field">
            Calendar data repository
            <input
              value={draft.repository}
              onChange={(e) => change("repository", e.target.value)}
              placeholder="owner/private-calendar-data"
            />
          </label>
          <label className="field">
            Base branch
            <input
              value={draft.baseBranch}
              onChange={(e) => change("baseBranch", e.target.value)}
            />
          </label>
          <button
            disabled={disabled || !native.isDesktop}
            onClick={() =>
              void run("Finding calendars", async () => {
                const adapter = new GitHubCalendar(new DesktopTransport(draft), draft);
                setCalendars(await adapter.calendars());
              })
            }
          >
            Find calendars
          </button>
          <label className="field">
            Calendar ID
            {calendars.length ? (
              <select
                value={draft.calendarId}
                onChange={(e) => change("calendarId", e.target.value)}
              >
                <option value="">Choose a calendar</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.calendarId}
                onChange={(e) => change("calendarId", e.target.value)}
                placeholder="Actual calendar ID from the bridge"
              />
            )}
          </label>
          <label className="field">
            Time zone
            <input
              value={draft.timeZone}
              onChange={(e) => change("timeZone", e.target.value)}
              placeholder="America/Los_Angeles"
            />
          </label>
          <label className="field">
            Workspace mode
            <select value={draft.mode} onChange={(e) => change("mode", e.target.value)}>
              <option value="demo">Demo · sample data only</option>
              <option value="live" disabled={!native.isDesktop}>
                Live · connected services
              </option>
            </select>
          </label>
          {!native.isDesktop && (
            <p className="notice">
              This browser preview supports demo mode. Run the desktop app to use live connections.
            </p>
          )}
          <button
            className="primary full"
            disabled={disabled}
            onClick={() => void run("Saving settings", () => onSave(draft))}
          >
            Save settings
          </button>
          <div className="diagnostics">
            <h3>Connection check</h3>
            <p className="hint">
              Checks access without creating pull requests or changing calendars. Results contain no
              message text or credentials.
            </p>
            <button
              disabled={disabled || !native.isDesktop}
              onClick={() => void run("Checking your connections", diagnose)}
            >
              Check connections
            </button>
            {diagnostics.map((d) => (
              <div className={"diagnostic " + (d.ok ? "ok" : "failed")} key={d.name}>
                <strong>{d.name}</strong>
                <span>{d.detail}</span>
              </div>
            ))}
          </div>
          <div className="privacy-note">
            <h3>Privacy and approval</h3>
            <p>
              The app reads your clipboard only when you ask. It keeps reviewed proposals and a
              limited conversation excerpt on this device. It does not send Beeper messages. Only
              reviewed event details are published to your private calendar repository.
            </p>
            <p>
              The calendar bridge’s configured notification policy applies after approval. Automatic
              chat watching, recurring events, all-day edits and guest changes are outside this
              version.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
