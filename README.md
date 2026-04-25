# Gmail AutoPurge

Self-hosted Gmail cleanup with Keep/Purge labels and safe batch trashing

Gmail AutoPurge is a small Google Apps Script that keeps your inbox cleanup simple:

- `Purge` means the thread can be trashed later.
- `Keep` means the thread must never be trashed by this script.
- Starred threads are protected.
- Threads without `Purge` are ignored.

The script runs inside your own Google account. It searches for old `Purge` threads and moves them to Trash in batches.

## Safety rules

The cleanup query is:

```text
label:Purge older_than:1000d -label:Keep -is:starred
```

The script only calls:

```js
thread.moveToTrash();
```

It does not use permanent deletion. Gmail Trash remains your recovery window.

By default, active cleanup is enabled:

```js
const DRY_RUN = false;
```

To avoid tiny surprise cleanups, a run only moves mail when it finds at least 25 matching Gmail threads:

```js
const MIN_THREADS_TO_DELETE = 25;
const MAX_THREADS_PER_RUN = 100;
```

Because Gmail Apps Script moves whole threads, the batch threshold is based on Gmail threads, not individual messages.
When a run executes, it scans all matching threads, sorts them by age, and processes the oldest ones first.

## Filter strategy

The shared defaults are designed around retention risk, not sender prestige.

- `Purge` is for mail that is usually low-value after a long retention window.
- `Keep` is for personal correspondence, important contacts, and workflows where history matters.
- The main red flag is any message that reflects movement of funds or a formal record.

As a rule of thumb:

- Good `Purge` candidates: account confirmation and one-time code messages.
- Bad `Purge` candidates: personal conversation history, contracts, agreements, invoices, receipts, statements, transfers, withdrawals, deposits, payments, payouts, settlements, and similar records.

The shared defaults are intentionally simple:

- one `Purge` filter for one-time/account-confirmation mail, with exclusions for financial and conversational terms
- one `Keep` filter for financial records and formal documents

## How to create safe filters

1. Start with a Gmail search query, not a filter.
2. Inspect recent matches manually.
3. Only create the filter if the query mostly finds mail that would still be disposable a year later.
4. If a query catches financial evidence or personal history, narrow it or move that source to `Keep`.

Practical recommendations:

- Prefer message type and exact phrases over broad domain assumptions.
- Use exclusions for money movement and formal records.
- Treat personal correspondence as protected by default.
- When in doubt, create a `Keep` filter instead of a more aggressive `Purge` filter.
- Filters in this project should only label mail. Do not auto-delete in Gmail filters.

## Shared defaults vs personal extensions

The default `gmail-filters.xml` should stay shared, generic, and conservative enough for many mailboxes.

Good shared defaults:

- one clear `Purge` filter for one-time/account-confirmation messages
- one clear `Keep` filter for transaction and document records

Usually personal-only filters:

- custom finance routing
- sender-specific `Keep` rules for your own important contacts
- niche workflow notifications
- travel, shopping, or developer notifications that are useful in some inboxes and noisy in others

## Fastest setup

### 1. Import the default Gmail filters

1. Open Gmail.
2. Open Settings.
3. Go to **Filters and Blocked Addresses**.
4. Choose **Import filters**.
5. Select `gmail-filters.xml`.
6. Review the filters.
7. Confirm that every filter action is only **Apply label**.
8. Create the filters.

The included starter filters are:

- one-time/account-confirmation messages (to `Purge`)
- financial records and formal transaction mail (to `Keep`)

The filters only apply a label. They do not delete, forward, mark important, skip inbox, or mark read.

### 2. Add your own `Keep` filters

Before turning on active cleanup, it is worth adding a few protective rules:

- personal contacts whose history matters
- clients, teammates, or counterparties
- institutions or workflows that send contracts or evidence of funds movement

Simple rule of thumb:

- if old mail helps you reconstruct a relationship, use `Keep`
- if old mail helps you reconstruct a transaction, use `Keep`

### 3. Create the Apps Script project

1. Open [script.google.com](https://script.google.com/).
2. Create a new project.
3. Paste the contents of `Code.gs` into the editor.
4. Save the project.
5. Select `install` from the function dropdown.
6. Click **Run**.
7. Approve the Google permissions.

`install()` creates or reuses the `Keep` and `Purge` labels, then creates one daily time-based trigger for `runPurgeCleanup`.

The daily trigger runs around 03:00 in the script project's timezone.

## Optional preview

If you want to inspect candidates before active cleanup, run:

```js
previewPurgeCleanup
```

This logs matching threads without moving anything. It ignores the minimum batch threshold so you can see candidates even when there are fewer than 25.

## Delete reports

By default, Gmail AutoPurge sends you a report email every time it moves threads to Trash:

```js
const SEND_DELETE_REPORT = true;
```

The report includes:

- timestamp
- mode
- search query
- matched count
- moved count
- skipped count
- errors
- sender, subject, date, and a clickable Gmail Trash search link for each moved thread

Those links should open the trashed threads in Gmail so you can restore anything important from Trash.
Review these reports periodically. If you see important messages in the report, tighten your `Purge` filter and/or broaden your `Keep` filter.

Report emails are labeled `Purge` on a best-effort basis, so they can age out later too. To disable normal delete reports, change:

```js
const SEND_DELETE_REPORT = false;
```

Error reports are still sent when errors occur.

No normal report email is sent when a run is skipped because fewer than 25 matching threads were found.

## Restore mail from Trash

1. Open the Gmail AutoPurge report email.
2. Click the link for the thread you want to recover.
3. In Gmail, move the thread out of Trash.
4. Add `Keep` or star the thread if it should be protected forever.

## Use Codex to set this up

If you use Codex Desktop, you can ask it to do the browser work for you with Browser Use or Computer Use. You will still need to personally approve Google OAuth prompts.

Ready-to-paste prompt:

```text
Use the in-app browser to set up Gmail AutoPurge for me.

1. Open Gmail settings and import gmail-filters.xml.
2. Verify every imported filter only applies a label (`Purge` or `Keep`).
3. Open script.google.com and create a new Apps Script project.
4. Paste Code.gs into the project.
5. Run install().
6. Pause when Google asks for OAuth approval so I can approve it.
7. Confirm that the Keep and Purge labels exist.
8. Confirm that a daily runPurgeCleanup trigger exists.
9. Do not permanently delete anything.
```

Codex can also run `previewPurgeCleanup()` and summarize the execution logs before active cleanup.

## Why this is self-hosted

A true one-click connected app would require a Google OAuth app, verification, privacy policy, review, hosting, and ongoing maintenance. Gmail cleanup requires sensitive mailbox permissions, so publishing it as a general connected app is much heavier than a small personal automation.

This repo keeps the trust boundary simple: the script runs in your own Google account, and no third-party server receives your email data.

## Can filter creation be automated?

Yes, but not in this v1.

Gmail filters can be created through the Gmail API, but that requires additional Gmail settings permissions and enabling the Advanced Gmail service in Apps Script. For the first version, `gmail-filters.xml` is simpler, more transparent, and easier to review before use.

## Configuration

Edit the constants at the top of `Code.gs`:

```js
const PURGE_LABEL = "Purge";
const KEEP_LABEL = "Keep";
const RETENTION_DAYS = 1000;
const DRY_RUN = false;
const MAX_THREADS_PER_RUN = 100;
const MIN_THREADS_TO_DELETE = 25;
const SEND_DELETE_REPORT = true;
```

Recommended changes:

- Set `DRY_RUN = true` if you want scheduled runs to log only.
- Set `SEND_DELETE_REPORT = false` if you do not want success emails.
- Increase `RETENTION_DAYS` if you want a longer retention period.

## Troubleshooting

### Nothing was moved

Check the execution log. If fewer than 25 matching threads were found, the run is skipped by design.

### I want smaller batches

Lower `MAX_THREADS_PER_RUN` if you want a smaller maximum batch. Lower `MIN_THREADS_TO_DELETE` if you want cleanup to run even when fewer matching threads are found.

### I got a permissions warning

Apps Script needs permission to read and modify Gmail because it searches threads, labels report emails, and moves old matching threads to Trash. Only approve the script if you trust the code you pasted.

### I see duplicate triggers

Run `install()` again. It reuses an existing `runPurgeCleanup` trigger instead of creating another one. You can also remove duplicates manually from the Apps Script Triggers page.
