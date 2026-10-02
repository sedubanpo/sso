# Hub read-only activity functions

Independent codebases: hub-activity-reader and hub-teacher-reader. Only these two functions are deployed from this directory; existing S-LMS and teacher portal entrypoints are not redeployed.

Deploy: `firebase deploy --project fir-lms-prod --only functions:hub-activity-reader,functions:hub-teacher-reader`

Sources: S-LMS functions/hub-activity.js and lesson-logs actor modules; teacher portal portal-functions/hub-notifications.js and its parity-tested class-log engine. Source copies are intentionally small, do not include credentials or unrelated functions, and must be reconciled when upstream authorization or agreement rules change.

Actual exam/log request producers remain unconfirmed. The server reports those kinds as pending; no requests are fabricated. Read markers remain browser-memory only.
