# Acceptance cases and roadmap

## v0.1 acceptance cases

Automated fixture coverage:

- [x] Explicit source search returns provenance and filters hidden/deleted messages.
- [x] Bounded context follows only opaque API cursors.
- [x] Local model output rejects unknown fields, unsupported actions and invalid times.
- [x] Prompt-like source text remains data, with no model execution tools.
- [x] ICS creation uses bridge-compatible stable identities and escaped/folded UTF-8.
- [x] Updates preserve identity and ETag; unsupported event properties remain read-only.
- [x] Local intent persists before a submission write.
- [x] A lost PR response resumes the same branch and event instead of duplicating it.
- [x] A submitted draft cannot be silently edited.
- [x] Approval blocks pending/failed checks and a changed reviewed head.
- [x] Merge alone remains pending.
- [x] Missing or unrelated receipts and mismatched snapshots cannot confirm an event.
- [x] App restart retains a pending proposal and its original settings.
- [x] Browser demo covers source → edit → review → approve → restart → confirm.
- [x] Browser preview cannot use live credentials.
- [x] Native boundary rejects remote model hosts and Beeper message writes.
- [x] Native OAuth checks local URLs, callback state and bounded request parsing.

Manual release checks to repeat on a target Mac:

- Open the packaged app, hide/reopen through the menu bar, and quit.
- Copy a synthetic Beeper message and invoke Command–Shift–K.
- Connect Beeper through its local OAuth consent screen.
- Save GitHub access, discover a private calendar, and run read-only diagnostics.
- Run a local structured model proposal with an explicit date and zone.
- Verify an ambiguous request leaves review questions.
- Inspect the activity and diagnostics without exposing message contents or tokens.
- With separate explicit authorization, use a dedicated calendar to validate create/update → approval → actual receipt and snapshot. Never perform this automatically against production calendars.

## Next work

1. Configurable shortcut and a persistent native shortcut availability indicator.
2. Calendar paging/cache for larger snapshot repositories.
3. A richer event editor with time-zone-aware controls and DST disambiguation.
4. User-controlled history retention and encrypted local history.
5. Optional selected-chat suggestions, with explicit chat scope, a local cursor and a review queue. This must not silently expand into account-wide monitoring.
6. Experimental Beeper WebSocket support only after schema stability and reconnection behavior are covered.
7. Additional bridge operations (all-day, recurrence, guests or deletion) only when the bridge exposes a reviewed, validated contract.
8. Signed and notarized distribution with a verified update channel.

Automatic chat watching and message sending are intentionally not implemented as inactive buttons or simulated live success.
