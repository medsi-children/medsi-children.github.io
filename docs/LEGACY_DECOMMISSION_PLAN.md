# Legacy decommission plan

Purpose: keep the production architecture understandable and reversible while the new GitHub frontend + Cloudflare chat stack stabilizes.

## Phase 0 — before cutover

- Do not remove old Apps Script HTML pages or legacy chat functions.
- Keep production URLs unchanged.
- Keep the old iframe UI as the immediate UI rollback path.
- Keep D1/KV data and legacy Sheets/Drive chat data intact.
- Record exact release control points for GitHub, Apps Script, and Cloudflare.
- Complete the final delta migration and verify message ordering, timestamps, attachments/fallbacks, read state, reactions, edits, deletes, and replies.

## Phase 1 — stabilization window (recommended: 2–4 weeks)

The new GitHub frontend is production, but the legacy implementation remains available only as rollback infrastructure.

During this window:

- No feature work should be added to legacy HTML unless needed for rollback safety.
- New fixes belong in the GitHub frontend / Cloudflare stack or shared Apps Script API layer.
- Keep the old Apps Script deployment version and source backup untouched.
- Do not delete old Sheets/Drive chat history.
- Monitor real use of parent, tutor, psychology, chat, attachments, reports, registration, notifications, edit/delete/reaction/reply flows and mobile Safari/PWA behavior.

Exit criteria:

- No rollback to the old UI during the stabilization window.
- No unexplained D1/legacy data divergence.
- Attachments remain available.
- Production reports and registration stay correct.
- GitHub rollback and Apps Script/Cloudflare recovery procedures have been tested or rehearsed.

## Phase 2 — archive legacy UI source

After the stabilization window passes:

1. Create a permanent Git tag/branch or release archive containing the final legacy-compatible state.
2. Keep a local/offline project backup of the same Apps Script source and Cloudflare source/config.
3. Keep the historical Apps Script deployment/version ID documented.
4. Only after those control points exist, remove legacy UI files from the active Apps Script source.

Likely Apps Script UI files to retire after dependency audit:

- `children.html`
- `educators.html`
- old chat rendering/UI code embedded in those pages
- `psychology.html` only if the standalone GitHub psychology frontend has fully replaced every live Apps Script psychology UI dependency

Do not remove `chat-adapter.html`, migration helpers, or old chat server functions merely because their names look legacy. First prove whether they are still needed for rollback, server-to-server fallback, migration, or disaster recovery.

## Phase 3 — shrink Apps Script to its intended role

Target Apps Script responsibilities:

- REPORTS / DATABASE / Google Sheets logic
- Google Drive logic that is still genuinely required
- authorization / tutor login / parent registration
- report read/write and validation
- phone / child lifecycle logic
- short-lived D1 session issuance
- push integration that still belongs in Apps Script
- explicit migration/recovery utilities that are intentionally retained

Target Apps Script should no longer contain the normal production web UI or duplicate chat-rendering implementation.

Before deleting each function, perform a call-site search across:

- Apps Script files
- GitHub frontend
- Cloudflare Worker
- push worker
- upload proxy

Delete only code with zero required callers and no documented recovery role.

## Phase 4 — Cloudflare cleanup

Do this later than the UI cleanup.

- Keep historical `/lab/...` routes while any deployed Apps Script adapter or documented recovery path still uses them.
- Remove compatibility aliases only after all callers are migrated and a separate rollback plan exists.
- Do not delete D1/KV storage as part of code cleanup.
- Review whether the upload proxy is still necessary. If retry/idempotency logic is moved safely into the main Worker, retire the proxy only after mobile Safari testing.
- Remove unused bindings/config only after runtime verification.

## Phase 5 — GitHub frontend consolidation

Once production is stable, perform a dependency audit of the frontend scripts.

Goals:

- one clear entrypoint per role: parent, tutor, psychology
- shared modules only for genuinely shared behavior
- no duplicate patch scripts that permanently override main logic
- temporary `final-polish`/compatibility fixes should either move into the owning module or be removed
- remove unused test-only files after the release branch and rollback archive exist
- document what each remaining script owns

Do not combine files merely to reduce file count. Prefer coherent modules over one giant file. The goal is understandable ownership, not the fewest possible files.

## Phase 6 — remove legacy data paths only after a longer retention period

Old Sheets/Drive chat storage should outlive the legacy UI code. Removing old UI source and deleting historical data are separate decisions.

Before deleting any legacy chat data:

- create an export/archive
- verify D1 contains all required history
- verify legacy Drive attachments have either been migrated or have a durable fallback/archive
- decide the required retention period explicitly
- document a restore procedure

## Final architecture target

```text
Public URLs / PWA
        |
        v
GitHub Pages frontend
  |        |        |
parent   tutor   psychology
  |        |        |
  +---- Apps Script API ---- Google Sheets / Drive
  |
  +---- short D1 session ---- Cloudflare Worker ---- D1 / KV
```

Apps Script remains the Google/business-logic backend. GitHub owns the user interface. Cloudflare owns the production chat data plane. Legacy UI code lives in an archive/control point rather than remaining mixed into the active project forever.
