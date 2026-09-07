# SEDU Hub SSO production broker

Production hub: https://sedubanpo.github.io/sso/workspace/
Endpoint: https://asia-northeast3-fir-lms-prod.cloudfunctions.net/hubSsoApi

Firebase project fir-lms-prod; Node 22, asia-northeast3, entry point hubSsoApi. Runtime identity sedu-hub-sso@fir-lms-prod.iam.gserviceaccount.com. HUB_ORIGINS=https://sedubanpo.github.io. Deploy this directory only as the function source. Use existing authenticated CLI / managed identity; do not add private key files.

Tickets: _hubSsoTickets, 60-second server-enforced expiry, one-use transaction, hashed code, PKCE, nonce, exact origin/window. Default Firestore deny rule prevents client access. deleteAfter TTL requested for cleanup. Each app retains its own authorization. Never mint tokens for browser-supplied UIDs.

The workspace/ directory is the public frontend. Existing index.html remains unchanged. Synchro and Intranet open in a new tab. Hub reload requires login again (memory-only session); closing/redirecting an external app can prevent coordinated logout.
