# v0.1 release verification

Verified on September 15, 2026 on an Apple Silicon Mac with macOS 26.6.2, Beeper Desktop 4.3.113 and Ollama 0.19.0 using the locally installed `qwen2.5:7b-instruct` model.

## Native integration

- Packaged application launches, hides/reopens, and quits.
- Command–Shift–U captures the clipboard into the composer.
- Beeper OAuth with PKCE completes in the native app.
- GitHub CLI access is imported into Keychain without exposing the token to the UI.
- Beeper message lookup, bounded context, private calendar discovery and connection checks succeed.
- The local model produces a validated event proposal with the explicit requested date and time zone.
- A create rehearsal on a dedicated test calendar completed through the app: private pull request, trusted validation, explicit approval, merge, matching applied receipt, and matching refreshed Google Calendar snapshot. The app remained pending until that last check.
- The test event had no attendees, and the bridge was configured to send no notifications. No Beeper messages were sent.

## Automated verification

- 17 TypeScript core/adapter tests, two browser end-to-end tests, TypeScript checking and production frontend build.
- Five Rust tests and Clippy with warnings denied.
- Dependency audit reported no known vulnerabilities at verification time.
- CI repeats frontend checks, browser tests, native tests and macOS packaging. Live calendar mutations are not run by CI.

Fixture coverage and the live checks above are distinct. All-day events, recurrence, guests, deletion and automatic watching are outside this release. Distribution builds are not Developer ID signed or notarized; minimum-version compatibility is declared as macOS 12.3, but this rehearsal used the OS version above.
