# Account inbox history — 2026-10-03

- Hours issues have a dedicated tab and are excluded from All/Requests/Activity. Archive and Timeline are distinct tabs.
- Archive/delete operate only on the selected user's inbox copy. Source requests and permission grants remain untouched. Timeline retains received snapshots, folds them into concise rows, and expands their received content with a disclosure arrow. Restore is supported.
- Broker POST /inbox authenticates the selected Firebase account and restricts all reads/writes to _hubInbox/{uid}/items. It accepts bounded, sanitized display snapshots only; these are personal inbox copies, not authoritative business audit records. No arbitrary URL or permission-action token is persisted. Deletion is a state transition, not document deletion. Existing Firestore rules deny direct client access.
- History begins with notifications received after this release. Pages contain 50 entries with a cursor. Active/archive indexes return the latest 300 entries; a partial status is shown if exceeded, while Timeline can page older entries. Source summary limits remain unchanged. Read marks are session-local unless the item is archived/deleted/restored.
- Required composite index: items, COLLECTION scope, state ASC + createdAt DESC. Created without modifying existing indexes/rules.
- S-LMS owns new hubStudentGrantNotification trigger on studentPermissions/{permissionId}. New ALLOW recipients and DENY→ALLOW restoration notify the matching active teacher with S-LMS access. Existing grants are not backfilled. Duplicate event retries are idempotent; renames and alias-only teacher identity migrations do not resend. Retry policy enabled. No existing grant or request was changed to test delivery.
- Notifications refresh on the existing visible-page five-minute interval or manual refresh.
- Tests: hub 51; S-LMS grant/request/permission 24; syntax checks 40. Isolated browser covers delete→history→expand, archive, teacher grant, separate account history, mobile layout. Real-account event delivery is not claimed.

Canonical S-LMS sources: functions/hub-grant-events.js and functions/hub-grant-events.test.js, export in functions/index.js; deploy only slms-roadmap:hubStudentGrantNotification.
