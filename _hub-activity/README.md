# Hub read-only activity function ownership

Only the teacher notification function is maintained here.

Deploy: `firebase deploy --project fir-lms-prod --only functions:hub-teacher-reader`

S-LMS owns `hubActivityApi` in its `slms-roadmap` codebase, from `s-lms/functions/index.js`, `hub-activity.js` and `activity-requests.js`. Its existing URL is unchanged. The production ownership transfer was verified on 2026-10-02 (ACTIVE, updated 12:33:21 UTC). Do not deploy the retired `hub-activity-reader` source or delete the live function. The obsolete local source copy has been removed to prevent overwriting the request producer integration.

S-LMS now supplies exam-request, consultation-request and lesson-request from its authenticated request inbox. COMPLETED/CANCELLED requests become history. The hub shows the latest 30 days, up to 60 S-LMS items; full history remains in S-LMS. No hubActivitySources/slms configuration is required.

The teacher source copy remains scoped to caller-owned hours reminders and must be reconciled with upstream agreement and authorization changes. Read markers remain browser-memory only.
