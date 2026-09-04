# MEDSI web UI rollback points — 2026-09-04

Production is intentionally unchanged at this checkpoint.

## Legacy production (current live UI)
- Parent shell: `/index.html` — blob `3e6bcd57efa0e95bb83e3621d6608aca439b6de8`
- Tutor shell: `/tutors.html` — blob `541a5035e5ce02be178c0c1a7fddc902b1fc2963`
- Parent legacy source is also copied under `legacy-production/index.html`.

These blob SHAs are immutable Git objects and are the authoritative rollback references even if files later change.

## New GitHub UI candidate
Canonical test entry points:
- `/parents_test/`
- `/tutors_test/`

Parent candidate checkpoint:
- `parents_test/index.html` — commit `6b5269d6cb8beadad905ba3ae45078334d2fe0a9`
- `parents_test/chat-screen.css` instant positioning fix — commit `c2e7cb1f7de6667e63e2c4a84a2339533b5f4048`
- psychology formatter simplification — commit `eab18f3ff5d882e0432e11aa6b4b3683d96d5507`

Tutor candidate checkpoint:
- `tutors_test/index.html` — commit `bdcffd1f08536e4c358400aca21683247543550e`
- tutor media loading-state fix — commit `8ef46ff8f47c9d8ac263a4a71208ea7f1ce2cd12`

Unused failed `full-web-runtime-v6.*` tutor experiment was deleted before this checkpoint. It was never loaded by the accepted tutor test page.

## Production cutover design
Do not overwrite the legacy UI destructively. At release time keep both versions addressable and use one small routing switch in the production shell:

- `legacy` → current Apps Script iframe UI
- `web` → new GitHub frontend

Apps Script remains the backend authority for REPORTS, registration/bootstrap and Google-side operations. Cloudflare Worker/D1 remains the chat backend. The GitHub frontend never receives Google credentials or long-lived server secrets.

Rollback should only require changing the routing switch from `web` back to `legacy`; no data migration or D1/KV deletion is part of UI rollback.
