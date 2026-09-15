# Security and privacy

Report a vulnerability privately using GitHub’s private vulnerability reporting feature for this repository. Do not include real messages, calendar snapshots or credentials in a public issue.

## Trust boundaries

- Only explicit capture reads the clipboard. There is no background clipboard polling or selected-message interception.
- Message bodies and calendar fields are untrusted data. They are sent to the local model in a separate JSON data message, never treated as application instructions.
- The model has no execution tools and cannot call GitHub, send messages, run commands or choose arbitrary calendar identities. Its output is parsed and validated against a strict allowlist schema.
- Beeper and Ollama endpoints must be loopback HTTP addresses. Native networking disables redirects and proxy inheritance. Credentials never go to model requests.
- GitHub requests are limited to the HTTPS repository API. The live calendar adapter requires a private data repository.
- The frontend cannot access a shell. Native GitHub CLI sign-in invokes a fixed `gh auth token --hostname github.com` command and saves its result directly to the keychain. No prompt text reaches command arguments.
- External links can open only GitHub or Google Calendar over HTTPS. Message HTML is rendered as text. No remote page is loaded into the application webview.
- Beeper networking permits reads and the app-focus endpoint; message writes are blocked natively. OAuth requests the permissions needed to read context and focus Beeper, but the broader write grant does not expose message-send operations in this app.
- Secrets are held by the operating-system credential store. HTTP error bodies are not surfaced because they can contain credentials or personal data.

## Approval boundaries

Preparing a draft has no remote write effect. Submitting creates a GitHub branch and pull request containing the reviewed event fields. The original message and context are not copied into the PR body.

Approval rechecks the exact PR head, base branch, single changed file, expected ICS bytes and the successful trusted GitHub Actions `validate` check. GitHub branch protection remains in force. The bridge performs its own base-version, schema and Google ETag checks.

A model explanation, a successful HTTP response, a merged PR or an unrelated receipt cannot mark a calendar change confirmed. Confirmation requires the expected operation receipt with `status: applied` and matching event ID, plus a refreshed same-calendar snapshot matching every proposed field. An update must also have a changed ETag.

## Local data

The durable state file stores the queue, original settings, selected message, bounded context, event proposal, pinned base and evidence. It is written through an atomic rename with restricted filesystem permissions. The state file is not encrypted; use the host’s normal disk encryption and account protections.

Diagnostics do not log or include access tokens, copied text or model prompts. Application state is never intentionally uploaded for diagnostics. Clearing a local completed record does not erase data from GitHub or Google Calendar.

There is no telemetry or cloud inference fallback.

## Limits

The app is not an isolation boundary against a compromised local user account, malicious trusted repository maintainer, compromised operating system or tampered bridge runner. Repository validators and the bridge deployment remain trusted components. Keep the bridge version and workflow files pinned and review their permissions.

The model can misunderstand dates, daylight-saving changes or conversational intent. The event card and direct editor exist so the user can check every field before approval. Ambiguous model outputs must be resolved before submission.
