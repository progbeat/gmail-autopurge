# Gmail AutoPurge

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Check](https://github.com/progbeat/gmail-autopurge/actions/workflows/check.yml/badge.svg?branch=master)](https://github.com/progbeat/gmail-autopurge/actions/workflows/check.yml)
[![Deploy Apps Script](https://github.com/progbeat/gmail-autopurge/actions/workflows/deploy.yml/badge.svg?branch=master)](https://github.com/progbeat/gmail-autopurge/actions/workflows/deploy.yml)
![Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-self--hosted-4285F4)

Gmail keeps old automated mail forever unless something cleans it up.

It also ends up storing things that should not sit in email for years: temporary passwords, API keys, recovery codes, login details.

Gmail AutoPurge is a small Google Apps Script that moves old, labeled Gmail threads to Trash. Labels decide what kind of mail a thread is. The script applies the expiration dates.

It also scans recent mail once a day and labels obvious credential emails as `Credentials`.

## Rules

| Label | Use it for | Default action |
|---|---|---|
| `Purge` | old automated mail | move to Trash after 1024 days |
| `Credentials` | possible passwords, API keys, recovery codes, login details | move to Trash after 16 days |
| `Keep` | records or mail history worth keeping | protects `Purge` threads |

Unlabeled mail is ignored.

Starred threads protect `Purge` threads.

`Credentials` is the sharp label: `Keep` and stars do not protect it. If a thread has `Credentials` for 16 days, it goes to Trash.

Actual Gmail searches:

```text
label:Purge older_than:1024d -in:chats -in:sent -in:drafts -in:spam -in:trash -label:Keep -is:starred
label:Credentials older_than:16d -in:chats -in:sent -in:drafts -in:spam -in:trash
```

Trash, Spam, Sent, Drafts, and Chat threads are skipped.

`Purge` waits until there are at least 25 old matches, then moves up to 50 threads per run.

`Credentials` starts at 1 match and also moves up to 50 threads per run.

Oldest matches move first.

## Why Use This

Use it for two jobs:

- give possible credentials a short fuse
- give old automated mail an expiration date

Good candidates:

- possible passwords, API keys, recovery codes, login details
- old login codes
- account confirmations
- delivery updates
- routine notifications
- ride receipts
- weekly digests

This is a small utility. Labels decide. The script cleans up on schedule.

## Credentials

Some services still email actual secrets.

The `Credentials` label is for messages that may contain plaintext passwords, temporary credentials, login details, API keys, recovery codes, backup codes, or similar secrets.

The script can auto-label threads that look like credential emails. It first uses a Gmail search prefilter, then reads the message text with strict classifier patterns before applying the label.

Current password-word prefilter languages: English, Japanese, Russian/Ukrainian, and Thai.

Auto-labeling is enabled by default in the daily cleanup run. The daily run checks the last 48 hours. It only applies the `Credentials` label and writes to Apps Script logs. It does not send a separate email report.

For a first pass over all matching mail, run:

```js
labelAllCredentialCandidates()
```

That is a live labeling run across matching mail.

For a normal recent scan, run:

```js
labelRecentCredentialCandidates()
```

If a message is not credentials, remove the label.

If it is credentials, move the secret to a password manager, rotate it if needed, and let the email age out.

## Reports

Reports are on by default.

Normal `Purge` reports are compact.

`Credentials` reports are separate and loud:

> REVIEW NOW: 3 possible CREDENTIALS moved to Trash

The report body is a compact thread list. Rows link back to Gmail Trash when possible.

Report emails get the `Purge` label, so they can expire later too.

To disable normal success reports:

```js
const SEND_DELETE_REPORT = false;
```

`Credentials` and error reports still send.

## Filters

`gmail-filters.xml` is not a finished ruleset. It is three starter examples:

- one-time code / account confirmation style mail -> `Purge`
- a simple `login password` heuristic -> `Credentials`
- formal records like invoices, statements, contracts, transfers, tax, insurance -> `Keep`

Review before importing. Delete what does not fit. Edit what almost fits. Add your own rules.

The included filters only apply labels. They do not delete, archive, mark as read, skip inbox, mark important, or forward mail.

Receipts are not kept by default. Some matter: tax, warranty, medical, business, expensive purchases. Plenty do not: coffee, parking, food delivery, tiny routine purchases. Add personal `Keep` filters for the ones that matter.

## Setup

### With Codex

Codex Desktop can do the browser work. Google permission screens still need a human.

Copy this prompt:

```text
Set up Gmail AutoPurge from this repository:

https://github.com/progbeat/gmail-autopurge

Use browser or computer control for Gmail and Apps Script setup.
Follow the README setup instructions. Do not invent a separate setup flow.
Pause at Google OAuth and permission screens so the user can approve them manually.
```

### Manual

1. Open [script.google.com](https://script.google.com/).
2. Create a new Apps Script project.
3. Paste the contents of all `.gs` files.
4. Save the project.
5. Select `install` from the function dropdown.
6. Click **Run**.
7. Approve the Google permissions.
8. Open Gmail settings.
9. Go to **Filters and Blocked Addresses**.
10. Choose **Import filters**.
11. Select `gmail-filters.xml`.
12. Review every filter.
13. Confirm each action is only **Apply label**.
14. Create the filters.

`install()` creates or reuses `Keep`, `Purge`, and `Credentials`, then creates one daily trigger for `runPurgeCleanup`.

## Preview

Run this before trusting the broom:

```js
previewPurgeCleanup()
```

Preview mode logs candidates and moves nothing.

To test report emails without moving anything:

```js
testPurgeReports()
```

This sends report emails for current candidates. It still does not move mail to Trash.

## Main Settings

Edit these at the top of `Code.gs`:

```js
const RETENTION_DAYS = 1024;
const CREDENTIALS_RETENTION_DAYS = 16;
const DRY_RUN = false;
const MAX_THREADS_PER_RUN = 50;
const MIN_THREADS_TO_DELETE = 25;
const SEND_DELETE_REPORT = true;
const AUTO_LABEL_CREDENTIALS = true;
const CREDENTIALS_AUTOLABEL_WINDOW_HOURS = 48;
```

Useful changes:

- `DRY_RUN = true` for preview-only scheduled runs
- `SEND_DELETE_REPORT = false` to disable normal success reports
- `RETENTION_DAYS` if 1024 days is not your number
- `CREDENTIALS_RETENTION_DAYS` if 16 days is too fast
- `AUTO_LABEL_CREDENTIALS = false` if you want manual `Credentials` labeling only
- `CREDENTIALS_AUTOLABEL_WINDOW_HOURS` if 48 hours is too short or too wide

## Restore Mail

If something moved by mistake:

1. Open Gmail Trash.
2. Move the thread out of Trash.
3. Remove the wrong label.
4. Fix the filter that added it.

Do step 4. Otherwise the same thing can happen again later.

## Updating

Manual copy-paste is fine for first setup.

For updates, `clasp` is nicer:

```sh
./clasp-push.sh
```

This expects `.clasp.json` to point at the Apps Script project. The file is ignored by Git because it is local setup, not repo content.

`clasp-push.sh` refuses to run if `.clasp.json` or `~/.clasprc.json` is readable by other users. Fix that once:

```sh
chmod 600 .clasp.json ~/.clasprc.json
```

## Files

| File | Purpose |
|---|---|
| `Code.gs` | cleanup, labels, triggers, reports |
| `CredentialClassifier.gs` | strict credential prefilter and body patterns |
| `gmail-filters.xml` | example Gmail filters |
| `appsscript.json` | Apps Script manifest |
| `clasp-push.sh` | local update helper |

## Limits

This is not a classifier, secret scanner, or mailbox oracle.

The labels do the deciding. The script enforces the expiration dates.

Bad filters make bad cleanup. Good filters make Gmail a little less clogged.
