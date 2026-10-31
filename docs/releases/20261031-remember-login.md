# Optional remembered login — 2026-10-31

Latest remote base c32f871; isolated worktree to preserve outstanding local app/registry/root-index edits.

- Unchecked by default: uses Firebase memory persistence. Checked: uses browserLocalPersistence for named sedu-hub Auth only. Password is never stored by hub code.
- On reopening, await authStateReady then broker /session (revocation and current grants). Saved selected UID/mode is scoped to original operator UID; reissue through existing audited /switch-worker or /switch-teacher, never trust stored permissions. Delegated Auth remains memory-only.
- Forbidden/deleted selection returns to the operator picker; expired/revoked base session is signed out. Network failure blocks app credentials, allows retry, retains persisted session.
- Token getter enforces actual selected UID. Account changes and logout in other tabs invalidate visible apps and feeds. Existing frames and popup logout behavior retained.
- Logout clears saved selection and base Auth persistence. Browser clearing site data also ends remembered login.

Validation: 63 Node tests pass (existing fixture mocks updated for real UID and document.hasFocus contract), including restore/opt-out/logout, staff/teacher switch restore, denied selection, cross-tab invalidation callback, revoked session and offline restore. JavaScript syntax and git diff checks pass. Firebase SDK persistence semantics checked against https://firebase.google.com/docs/auth/web/auth-state-persistence .

Browser QA NOT completed: computer-use returned "Local browser use is disabled in Work settings". No workaround attempted, no real credentials read. Live Firebase reload/cross-tab behavior and actual app bootstrap remain manual verification scope; no performance or all-app live-success claim.

No backend deployment or authorization policy change. Frontend release 20261031-remember. Rollback: revert this commit's four workspace files.
