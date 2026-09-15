# Beeper Calendar

A Mac-first desktop app that turns a copied Beeper message into a calendar proposal. It uses a local model, shows the source and event details, and waits for your approval before requesting a calendar change.

Built with Tauri, React and TypeScript. No separate application daemon is required.

## What it does

1. Copy a message in Beeper and press **Command–Shift–K**, or choose **Use copied message** from the menu bar.
2. Select the matching message. Review the sender, date and nearby context.
3. Choose a new event or an existing ordinary timed event to update.
4. Let your local Ollama model draft the title, time, location and description. Edit the fields or refine the draft in plain language.
5. Open a calendar review. The app creates one pull request in your **private** calendar data repository.
6. Approve the exact change after the bridge’s validation passes.
7. Wait for the matching bridge receipt **and** refreshed calendar snapshot. A merged pull request is shown as **Awaiting calendar confirmation**, never as confirmed.

The app does not send Beeper messages. It does not add a native Beeper context menu or assume access to the currently selected message. The supported entry point is explicit clipboard capture.

## Try the demo

The app opens in a clearly labeled demo workspace. Click **Try the sample conversation** to walk through source selection, editing, review, approval and a separate confirmation step. Demo data is synthetic; no Beeper, model or GitHub service is called. In demo mode, a text refinement replaces the event title so the result is reproducible.

For a browser preview:

```sh
npm ci
npm run dev
```

Browser mode supports the demo only. Live credentials and connections are available exclusively in the desktop build.

## Run the desktop app

Requirements:

- macOS 12.3 or later; Apple Silicon is recommended for local inference.
- Node.js 22+, a current stable Rust toolchain and Xcode command-line tools.
- [Beeper Desktop](https://www.beeper.com/download) with its Desktop API enabled.
- [Ollama](https://ollama.com/download) and an installed model with structured JSON support.
- An existing [gcal-git-bridge](https://github.com/nishu-builder/gcal-git-bridge) installation with its GitHub ICS adapter and an independent private data repository.

```sh
npm ci
npm run tauri dev
```

For a production application bundle and disk image:

```sh
npm run tauri build
```

Build outputs are under `src-tauri/target/release/bundle/`. GitHub Actions also produces a macOS build artifact. Development and CI artifacts are unsigned unless a distributor configures Apple signing and notarization; they are not represented as notarized releases.

Closing the window keeps the app in the menu bar. Choose **Quit** there to stop it. If the default shortcut is occupied, use the menu-bar capture action.

## Connect your services

Open **Settings**:

1. **Beeper:** enable the Desktop API in Beeper’s settings, keep its loopback address (normally `http://localhost:23373`), and click **Connect Beeper**. Complete the local consent flow. The app uses OAuth with PKCE and stores access in the system keychain.
2. **Local model:** start Ollama and install a model, for example `ollama pull qwen2.5:7b-instruct`. Set the matching installed model name. Model requests are accepted only at a loopback HTTP address; there is no cloud fallback or model tool execution. The model inventory must report downloaded GGUF weights; cloud-backed entries are rejected before any prompt is sent.
3. **GitHub:** use an existing `gh auth login` session with **Use GitHub CLI sign-in**, or save a fine-grained repository token. The credential is kept in the native keychain. Token permissions: **Contents: read/write**, **Pull requests: read/write**, **Checks: read**, and **Commit statuses: read** for the private calendar data repository.
4. Enter that data repository and its base branch. Click **Find calendars**, then select the intended calendar. Set your IANA time zone.
5. Click **Check connections**. “Access saved” means a credential exists; only the connection check establishes whether it currently works.
6. Select **Live** and save settings.

The bridge must already export editable ICS files and have its trusted `validate` GitHub Actions job and applying runner installed. Follow the bridge’s [GitHub adapter setup](https://github.com/nishu-builder/gcal-git-bridge/blob/main/contrib/github/README.md). The app cannot provision Google OAuth or the bridge runner for you. Use a dedicated test calendar to validate an installation before production use.

Approval uses the bridge’s configured notification policy; the desktop app does not override that policy. Updating an event with existing guests can therefore result in notifications according to the bridge configuration.

## Supported scope

Create or update the title, description, location, start and end of one ordinary timed event. Existing ICS identity, timestamp and Google ETag are preserved. The bridge independently checks the original event version before applying a change.

All-day edits, recurrence, attendee changes, deletion, automatic chat watching and message sending are outside v0.1. Unsupported exported event types are omitted from the update picker. A calendar can contain at most 300 editable ICS events in this version; message context is bounded to 11 messages from at most four API pages. Older messages may have only their selected text available.

Snapshots are pinned to a Git commit before review. Stale Google versions and changed pull-request content are blocked instead of silently overwritten. Submitted proposals retain their original repository and settings even if you change the defaults later.

## Status and recovery

| Status                         | Meaning                                                | Next step                                                        |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Ready to review                | Local draft only                                       | Check the fields and resolve questions                           |
| Submission pending             | Stable intent saved; a network result may be uncertain | Resume submission; the same branch and event identity are reused |
| Awaiting approval              | A review exists; no calendar confirmation              | Review the PR, wait for validation, then approve                 |
| Approval pending               | Approval was saved; a merge result may be uncertain    | Retry approval or check status                                   |
| Awaiting calendar confirmation | Merged; matching receipt/snapshot not yet verified     | Check status or inspect the bridge workflow                      |
| Confirmed                      | Receipt reports applied and the snapshot matches       | No further action                                                |
| Closed                         | PR closed without merge                                | Start a fresh proposal if still needed                           |

The app checks pending live calendar confirmations every 30 seconds while running. **Check status** also refreshes a review merged or closed outside the app. Delayed or failed bridge runs remain pending; the pull-request link is available for investigation. Changes in Google after application can prevent the latest snapshot from matching the proposal; inspect the evidence instead of treating that as automatic success.

Local state is saved atomically before external mutations. A dropped connection after PR creation can be resumed without inventing a new event ID. Do not remove active records or reset the bridge journal to bypass a conflict. For a stale merged change, follow the bridge’s operator recovery instructions and create a fresh reviewed proposal after reconciliation.

On macOS, local history is in `~/Library/Application Support/com.nishubuilder.beepercalendar/state.json`. It includes message excerpts and event details, and is protected by file permissions, not application-level encryption. If it becomes unreadable, preserve it before recovery. Local removal of a completed record does not delete the event or GitHub history.

## Development and verification

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run build
cd src-tauri
cargo test --locked
cargo clippy --locked -- -D warnings
```

Unit/integration fixtures cover strict proposal validation, prompt-data isolation, ICS escaping and stable identities, source provenance, interrupted submissions, changed reviews, failed validation, and receipt/snapshot correlation. Browser tests exercise the complete synthetic review/approval/confirmation flow and restart recovery. Live calendar mutation tests are intentionally not part of CI.

See [architecture](docs/ARCHITECTURE.md), [acceptance cases and roadmap](docs/ROADMAP.md), [security](SECURITY.md) and [contributing](CONTRIBUTING.md). This project is independent of Beeper, Google and Ollama.
