# Bluehost (Titan) SMTP — Connect & Send Feature Design

**Date:** 2026-05-21
**Status:** Awaiting implementation

---

## Overview

End-to-end feature that lets the operator connect a Bluehost (Titan) SMTP mailbox, verify credentials live, store the account, and later send + sync outbound mail through it. Standalone build — existing Instantly.ai outreach is untouched until a future wiring pass.

---

## Stack Adaptations

Source pattern is from the Trustpilot Lead Gen project (Express + Vite). This project uses **Next.js 14 App Router + Tailwind + Supabase**, so:

| Spec assumption | This project equivalent |
|---|---|
| Express `router.post(...)` | App Router `route.ts` (`POST` export) |
| React + Vite component | Next.js client component in `web/components/` |
| Inline DB client | `lib/db.ts` Supabase service-role client |
| Custom envelope | `lib/response.ts` `ok()` / `fail()` helpers |
| pino logger | `lib/logger.ts` `getLogger()` |

---

## Part 1 — Database Migration

**File:** `db/migrations/012_email_accounts.sql`
**Also port to:** `db/schema.sql`

```sql
create table if not exists email_accounts (
    id                  uuid primary key default uuid_generate_v4(),
    email               text unique not null,
    from_name           text,
    provider            text,               -- 'Bluehost (Titan SMTP)'
    auth_type           text,               -- 'smtp' | 'gmail_oauth' | 'app_password'
    email_provider      text,               -- 'smtp'
    smtp_host           text,
    smtp_port           int,
    smtp_user           text,
    smtp_password       text,               -- plaintext (single-operator, service-role + RLS off)
    smtp_secure         text,               -- 'ssl' | 'tls'
    imap_host           text,
    imap_port           int,
    imap_user           text,
    imap_pass           text,               -- plaintext
    status              text default 'active'
                        check (status in ('active', 'paused', 'error')),
    daily_cap           int,
    hourly_cap          int,
    is_cold_sender      bool default true,
    warmup_enabled      bool default true,
    warmup_started_at   timestamptz,
    warmup_target_cap   int default 50,
    warmup_ramp_days    int default 21,
    created_at          timestamptz not null default now()
);

alter table if exists email_accounts disable row level security;
```

---

## Part 2 — Backend Route

**File:** `web/app/api/email-accounts/bluehost/route.ts`

### Request body (zod-validated)
```ts
{
  email: string,
  fromName?: string,
  password: string,
  smtpHost?: string,   // default 'smtp.titan.email'
  smtpPort?: string,   // default '465'
  imapHost?: string,   // default 'imap.titan.email'
  imapPort?: string,   // default '993'
}
```

### Steps (abort-on-failure for SMTP; soft-warn for IMAP)

**Step A — SMTP verify (hard gate)**
- `nodemailer.createTransport({ host, port, secure: port===465, auth })` → `transporter.verify()`
- Failure → `fail('SMTP connection failed: <first error line>', 400)`

**Step B — IMAP verify (soft warn)**
- `new ImapFlow({ host, port, secure:true, auth, logger:false, connectionTimeout:10000 })`
- Race `client.connect() + client.logout()` against 10s timeout
- Failure → capture `imapWarning` string; continue to Step C

**Step C — Insert**
- `provider: 'Bluehost (Titan SMTP)'`, `auth_type: 'smtp'`, `email_provider: 'smtp'`
- `smtp_secure: port===465 ? 'ssl' : 'tls'`
- `warmup_started_at: new Date()`, `status: 'active'`
- PG unique violation (code `23505`) → `fail('An account with this email already exists', 409)`

### Response
```ts
{ success: true, data: <row>, warning?: string }
// or
{ success: false, error: string }
```

---

## Part 3 — SMTP Sender Module

**File:** `web/lib/services/smtp-sender.ts`

### Exported interface
```ts
export interface SmtpSenderAccount {
  email: string;
  fromName?: string | null;
  auth_type: 'smtp';
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_user?: string | null;
  imap_pass?: string | null;
}
```

### Exported function
```ts
export async function sendEmailSmtp(
  to: string,
  subject: string,
  html: string,
  options: { screenshotPath?: string },
  account: SmtpSenderAccount
): Promise<{ success: true; messageId: string } | { success: false; error: string }>
```

### Behaviour

1. **Transporter pool** — module-scoped `Map<string, Transporter>` keyed by `smtp_user`. Create once with `pool:true, maxConnections:2, maxMessages:100`; reuse on subsequent calls.

2. **Message-ID pre-generation** (before `sendMail`)
   ```ts
   const host = account.email.split('@')[1] || 'localhost';
   const messageId = `<${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}@${host}>`;
   ```
   Pass to `sendMail` AND use in `MailComposer` for IMAP raw MIME. Return the pre-generated ID (never `info.messageId`).

3. **Optional inline screenshot** — if `options.screenshotPath` is set: fetch buffer with 3× retry / 1s backoff for URLs; attach with `cid: 'inline-screenshot'`; append `<img src="cid:inline-screenshot">` to body HTML. On null fetch → log and skip (never fail the send).

4. **From header** — `"${account.fromName || account.email}" <${account.email}>`

5. **IMAP Append (fire-and-forget)** — after successful `sendMail`, call `appendToSentFolder(account, mailOptions).catch(log)`. IMAP failure never propagates to the caller.

6. **`appendToSentFolder(account, mailOptions)`**
   - Build raw MIME: `new MailComposer(mailOptions).compile().build()` (Promisified)
   - Open `ImapFlow` with account IMAP creds
   - `client.list()` → pick Sent folder in priority order:
     1. `specialUse === '\\Sent'`
     2. name matches `/^sent$/i`
     3. name matches `/^sent\.messages$/i`
     4. name matches `/^sent\.items$/i`
     5. any name matching `/sent/i`
   - `client.append(sentBox.path, raw, ['\\Seen'])`
   - Always `client.logout()` in `finally`
   - If no Sent folder found: `log.warn(...)` and return (no throw)

7. **Return** — `{ success: true, messageId }` on SMTP success; `{ success: false, error: e.message }` on SMTP failure.

---

## Part 4 — Frontend

### Page
**File:** `web/app/(dashboard)/email-accounts/page.tsx`
- Server component
- Fetches rows from `email_accounts` ordered by `created_at desc`
- Table columns: Email, Provider, Status, Warm-up, Daily cap, Connected at
- "Connect Bluehost" button → opens `ConnectBluehostModal`

### Modal
**File:** `web/components/ConnectBluehostModal.tsx`
- Client component (`'use client'`)
- Fields: email, fromName (optional), password, smtpHost (prefilled `smtp.titan.email`), smtpPort (`465`), imapHost (`imap.titan.email`), imapPort (`993`)
- On submit → `POST /api/email-accounts/bluehost`
- `response.success === false` → inline red error
- `response.warning` present → yellow notice + "Continue anyway" button (save already happened; CTA just closes + refreshes)
- Clean success → close + refresh list
- Info box at bottom: *"Bluehost Titan defaults: SMTP smtp.titan.email:465 (SSL), IMAP imap.titan.email:993 (TLS). Username is your full email address."*

### Navigation
- Add "Email Accounts" link to `web/components/SideNav.tsx`

---

## Part 5 — Dependencies

Add to `web/package.json`:

| Package | Purpose |
|---|---|
| `nodemailer` | SMTP send + MailComposer (bundled) |
| `imapflow` | IMAP verify + Sent-folder append |
| `@types/nodemailer` | TypeScript types (devDependency) |

---

## Part 6 — Wiring (deferred)

**Standalone build** — `stage-5-outreach.ts` and `lib/services/instantly.ts` are untouched. `sendEmailSmtp` is ready to call; wired into a scheduler/script in a separate pass.

Future wiring point: when `account.auth_type === 'smtp'`, dispatch via `sendEmailSmtp`; respect `daily_cap` / `hourly_cap`; write `sender_email` on the outreach event row.

---

## Acceptance Checks

| # | Scenario | Expected |
|---|---|---|
| 1 | Correct Titan mailbox, wrong password | `400` — `"SMTP connection failed: ..."` |
| 2 | Correct creds, IMAP blocked at network | Row inserted, response includes `warning`, modal shows yellow notice + "Continue anyway" |
| 3 | Correct creds, IMAP reachable | Row inserted, no warning, account in list with `status=active`, `provider="Bluehost (Titan SMTP)"` |
| 4 | Send test through new account | Recipient receives mail; Titan webmail Sent folder contains message with same Message-ID stored server-side |

---

## Files Created / Modified

| Action | Path |
|---|---|
| New migration | `db/migrations/012_email_accounts.sql` |
| Update schema | `db/schema.sql` |
| New route | `web/app/api/email-accounts/bluehost/route.ts` |
| New service | `web/lib/services/smtp-sender.ts` |
| New page | `web/app/(dashboard)/email-accounts/page.tsx` |
| New component | `web/components/ConnectBluehostModal.tsx` |
| Update nav | `web/components/SideNav.tsx` |
| Update deps | `web/package.json` |
