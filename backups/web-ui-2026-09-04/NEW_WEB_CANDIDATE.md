# New web UI release candidate

Canonical test pages:

- `/parents_test/`
- `/tutors_test/`

Pinned repository snapshot after the final tutor loader/media cleanup:

- Git commit: `4c67e3f5a39cca8ecf7f2eacb7d1099852c4622c`

This commit is the immutable rollback/reference point for the polished GitHub-first test interfaces before production promotion.

Production `/` and `/tutors` were not changed when this snapshot was recorded.

Backend contract remains intentionally separate:

- Apps Script: authentication/business logic, REPORTS, registration, phone/admin operations, report distribution, issuing D1 chat sessions.
- Cloudflare Worker/D1/KV: chat sessions, threads, messages, media and unread state.
- GitHub Pages: user interface only.
