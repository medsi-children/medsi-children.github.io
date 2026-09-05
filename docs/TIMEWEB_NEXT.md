# Medsi Timeweb Next

This branch is isolated from production. Production remains the stable Apps Script / Sheets version.

## Current test path

Browser -> Timeweb Node.js -> Cloudflare Worker -> D1/KV

GitHub stores source code only. Timeweb serves the frontend and acts as the same-origin API/media gateway.

## Target path

Apps Script / REPORTS remains the authority for active parent/child identity and reports.

Timeweb becomes responsible for:
- chat sessions/tokens;
- chat API;
- chat messages, reactions, read/unread and pins in PostgreSQL;
- media in S3;
- serving the frontend.

Apps Script remains responsible for:
- REPORTS;
- parent/child matching;
- report delivery and Google Sheets logic;
- registration/business rules that depend on Google data.

## PostgreSQL

`database/schema.sql` is the initial schema. PostgreSQL support is optional until `DATABASE_URL` is configured. Without it, the app continues in Cloudflare-proxy mode.

Environment variables planned:
- `DATABASE_URL`
- `DATABASE_SSL` (default `require`)
- `DATABASE_POOL_MAX` (default `5`)
- `CHAT_UPSTREAM`
- `UPLOAD_UPSTREAM`

## Diagnostics

- `/__health` - process/database readiness. Works without Cloudflare.
- `/__diag/network` - measures server-side Timeweb -> Cloudflare latency and reports PostgreSQL readiness.

## Safety rule

Do not switch the live parent/educator production site to this branch until network tests pass on iPhone Safari, Mac, Lovit Wi-Fi, workplace Wi-Fi and Megafon LTE.
