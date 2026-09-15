# Development guidance

- Keep source, model inference, calendar execution, and UI behind typed interfaces. Models propose event fields; application code owns identities, credentials, validation, and writes.
- Preserve the distinction between local draft, submitted review, merged review, and confirmed calendar change. A merge or successful HTTP request alone is not calendar confirmation.
- Keep credentials out of JavaScript responses, diagnostics, fixtures, and Git. Use synthetic conversations for committed tests and screenshots.
- Never weaken bridge validation or invent fresh operation IDs to bypass a conflict or retry uncertainty.
- Test live writes only on a dedicated test calendar within the user's authorized scope. Message capture never authorizes sending a reply to someone.
- Update `docs/ROADMAP.md` when scope changes. Record live release verification separately from fixture test results.
- Run the relevant TypeScript tests and checks; native changes also need Rust tests and lint. Verify a packaged Mac app before claiming native behavior works.
- Use plain action labels and specific error states. Avoid slogans and connection labels based only on the presence of a credential.
