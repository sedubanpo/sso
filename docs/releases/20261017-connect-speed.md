# Hub connection latency — 2026-10-17

- Prepare the memory-only Firebase SDK concurrently with broker readiness, before login submission. Share in-flight initialization and retry failed preparation.
- Resolve operator eligibility once per session response, eliminating the second sequential Auth user / alias lookup. No cross-request authorization cache.
- Cache allowed CORS preflight for 600 seconds. Authenticated responses remain no-store; every actual request retains origin, revocation, profile and app grant checks.
- Reuse date/time formatters rather than recreating two Intl objects every second.

Validation: 54 tests passed, including preflight origin rejection, initialization concurrency/failure recovery, and authorization recheck. Syntax checks passed. Isolated Chrome fixture verified teacher login, LMS and timetable handshake, and immediate return to the same LMS frame (same nonce). Live user credentials were not read or used. No claim of measured live per-app improvement percentage; app-specific data/bootstrap latency remains outside this change.

Existing iframe reuse and intent-based preconnect retained. Do not discard inactive frames automatically: they may contain unsaved work. Notification requests already run asynchronously and do not gate app selection. No production minimum-instance/cost policy changed.

Rollback: previous hub commit c72b475; redeploy previous _hub-sso-server for broker rollback.
