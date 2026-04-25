const PURGE_LABEL = "Purge";
const KEEP_LABEL = "Keep";
const RETENTION_DAYS = 1000;
const DRY_RUN = false;
const MAX_THREADS_PER_RUN = 50;
const MIN_THREADS_TO_DELETE = 25;
const SEARCH_LOOKAHEAD_LIMIT = 1000;
const GMAIL_SEARCH_PAGE_SIZE = 500;
const SEND_DELETE_REPORT = true;
const ERROR_REPORTS_ENABLED = true;

function install() {
  ensureLabels_();
  const trigger = createDailyTrigger();
  const result = {
    installedAt: new Date().toISOString(),
    purgeLabel: PURGE_LABEL,
    keepLabel: KEEP_LABEL,
    triggerFunction: "runPurgeCleanup",
    triggerCreated: trigger.created,
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function previewPurgeCleanup() {
  return executePurgeCleanup_({ dryRun: true, ignoreMinimum: true });
}

function runPurgeCleanup() {
  return executePurgeCleanup_({ dryRun: DRY_RUN, ignoreMinimum: false });
}

function executePurgeCleanup_(options) {
  const startedAt = new Date();
  const dryRun = Boolean(options && options.dryRun);
  const ignoreMinimum = Boolean(options && options.ignoreMinimum);
  const mode = dryRun ? "DRY_RUN" : "ACTIVE";
  const query = buildPurgeQuery();
  const selection = selectOldestThreads_(query);
  const threads = selection.selectedThreads;
  const deletedThreads = [];
  const previewThreads = [];
  const errors = [];
  let movedToTrashCount = 0;
  let skippedCount = 0;
  let skippedReason = "";

  if (!dryRun && !ignoreMinimum && selection.totalMatches < MIN_THREADS_TO_DELETE) {
    skippedCount = selection.totalMatches;
    skippedReason = `Only ${selection.totalMatches} matching threads found; minimum is ${MIN_THREADS_TO_DELETE}.`;
  } else {
    threads.forEach((thread) => {
      try {
        const summary = summarizeThread_(thread);
        previewThreads.push(summary);

        if (dryRun) {
          skippedCount += 1;
          return;
        }

        thread.moveToTrash();
        movedToTrashCount += 1;
        deletedThreads.push(summary);
      } catch (error) {
        skippedCount += 1;
        errors.push(String(error && error.stack ? error.stack : error));
      }
    });
  }

  const result = {
    startedAt: startedAt.toISOString(),
    mode,
    query,
    matchedThreadsCount: selection.totalMatches,
    searchLookaheadLimit: SEARCH_LOOKAHEAD_LIMIT,
    movedToTrashCount,
    skippedCount,
    skippedReason,
    errors,
    previewThreads: previewThreads.slice(0, 10),
    deletedThreads,
  };

  logResult_(result);
  maybeSendReport_(result);
  return result;
}

function selectOldestThreads_(query) {
  const candidates = findCandidateThreads_(query);
  candidates.sort((a, b) => a.getLastMessageDate() - b.getLastMessageDate());
  return {
    totalMatches: candidates.length,
    selectedThreads: candidates.slice(0, MAX_THREADS_PER_RUN),
  };
}

function findCandidateThreads_(query) {
  const threads = [];
  let start = 0;

  while (start < SEARCH_LOOKAHEAD_LIMIT) {
    const pageSize = Math.min(GMAIL_SEARCH_PAGE_SIZE, 500, SEARCH_LOOKAHEAD_LIMIT - start);
    const page = GmailApp.search(query, start, pageSize);
    if (!page || page.length === 0) {
      break;
    }

    threads.push(...page);
    if (page.length < pageSize) {
      break;
    }

    start += page.length;
  }

  return threads;
}

function buildPurgeQuery() {
  return [
    `label:${PURGE_LABEL}`,
    `older_than:${RETENTION_DAYS}d`,
    `-label:${KEEP_LABEL}`,
    "-is:starred",
  ].join(" ");
}

function createDailyTrigger() {
  const existing = ScriptApp.getProjectTriggers().filter((trigger) => (
    trigger.getHandlerFunction() === "runPurgeCleanup"
  ));

  if (existing.length > 0) {
    return { created: false, trigger: existing[0] };
  }

  const trigger = ScriptApp.newTrigger("runPurgeCleanup")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  return { created: true, trigger };
}

function ensureLabels_() {
  getOrCreateLabel_(PURGE_LABEL);
  getOrCreateLabel_(KEEP_LABEL);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function summarizeThread_(thread) {
  const firstMessage = thread.getMessages()[0];
  const threadId = thread.getId();
  const from = firstMessage.getFrom();
  const messageId = firstMessage.getHeader("Message-ID");
  return {
    from,
    sender: formatSender_(from),
    subject: firstMessage.getSubject(),
    date: firstMessage.getDate(),
    threadId,
    messageId,
    trashUrl: buildTrashUrl_(messageId, threadId),
  };
}

function buildTrashUrl_(messageId, threadId) {
  if (messageId) {
    const query = `in:trash rfc822msgid:${messageId}`;
    return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
  }

  return `https://mail.google.com/mail/u/0/#trash/${encodeURIComponent(threadId)}`;
}

function formatSender_(from) {
  const withoutEmail = String(from).replace(/\s*<[^>]+>\s*$/, "");
  const unquoted = withoutEmail.replace(/^"(.+)"$/, "$1").trim();
  return unquoted || String(from).trim();
}

function logResult_(result) {
  Logger.log(JSON.stringify(result, null, 2));
}

function maybeSendReport_(result) {
  const hasErrors = result.errors.length > 0;
  const movedThreads = result.movedToTrashCount > 0;

  if (hasErrors && ERROR_REPORTS_ENABLED) {
    sendReportEmail_(result, "ERROR");
    return;
  }

  if (!SEND_DELETE_REPORT || !movedThreads) {
    return;
  }

  sendReportEmail_(result, "DELETE_REPORT");
}

function sendReportEmail_(result, reportType) {
  const recipient = Session.getActiveUser().getEmail();
  const runId = Utilities.formatDate(
    new Date(result.startedAt),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm"
  );
  const subject = buildReportSubject_(result, reportType, runId);
  const body = buildPlainReportBody_(result);
  const htmlBody = buildHtmlReportBody_(result);

  MailApp.sendEmail(recipient, subject, body, {
    htmlBody,
    name: "Gmail AutoPurge",
  });
  labelReportEmail_(subject);
}

function buildReportSubject_(result, reportType, runId) {
  if (reportType === "ERROR") {
    return `Gmail AutoPurge needs attention: ${result.errors.length} errors (${runId})`;
  }

  return `Gmail AutoPurge moved ${result.movedToTrashCount} threads to Trash (${runId})`;
}

function buildPlainReportBody_(result) {
  const lines = [
    "Gmail AutoPurge report",
    "",
    `Date/time: ${result.startedAt}`,
    `Mode: ${result.mode}`,
    `Search query: ${result.query}`,
    `Matched threads count: ${result.matchedThreadsCount}`,
    `Moved to Trash count: ${result.movedToTrashCount}`,
    `Skipped count: ${result.skippedCount}`,
    `Skipped reason: ${result.skippedReason || "none"}`,
    `Errors: ${result.errors.length}`,
    "",
  ];

  if (result.errors.length > 0) {
    lines.push("Errors:");
    result.errors.forEach((error) => lines.push(`- ${error}`));
    lines.push("");
  }

  const threads = result.deletedThreads.length > 0
    ? result.deletedThreads
    : result.previewThreads;
  const reportThreads = sortThreadsForReport_(threads);

  lines.push(result.deletedThreads.length > 0 ? "Moved threads:" : "Preview threads:");
  if (reportThreads.length === 0) {
    lines.push("- none");
  } else {
    reportThreads.forEach((thread) => {
      lines.push(`- ${thread.date}: ${thread.from}`);
      lines.push(`  Subject: ${thread.subject}`);
    });
  }

  return lines.join("\n");
}

function buildHtmlReportBody_(result) {
  const movedThreads = result.deletedThreads.length > 0;
  const threads = movedThreads ? result.deletedThreads : result.previewThreads;
  const reportThreads = sortThreadsForReport_(threads);
  const title = movedThreads
    ? `${result.movedToTrashCount} threads moved to Trash`
    : "Gmail AutoPurge report";
  const subtitle = movedThreads
    ? "Open a row to find the thread in Gmail Trash."
    : "No threads were moved in this run.";

  return [
    '<div style="margin:0;padding:0;background:#f6f8fa;color:#202124;font-family:Arial,Helvetica,sans-serif;">',
    '<div style="max-width:920px;margin:0 auto;padding:24px;">',
    '<div style="background:#ffffff;border:1px solid #dadce0;border-radius:10px;overflow:hidden;">',
    '<div style="padding:20px 24px;border-bottom:1px solid #e8eaed;">',
    `<div style="font-size:20px;font-weight:700;line-height:1.3;">${escapeHtml_(title)}</div>`,
    `<div style="margin-top:6px;color:#5f6368;font-size:13px;line-height:1.5;">${escapeHtml_(subtitle)}</div>`,
    '</div>',
    buildSummaryTable_(result),
    buildThreadTable_(reportThreads),
    buildErrorBlock_(result.errors),
    '</div>',
    '<div style="padding:12px 4px;color:#6b7280;font-size:12px;line-height:1.5;">',
    'Gmail AutoPurge only moves matching threads to Trash. It does not permanently delete mail.',
    '</div>',
    '</div>',
    '</div>',
  ].join("");
}

function buildSummaryTable_(result) {
  const rows = [
    ["Run time", result.startedAt],
    ["Mode", result.mode],
    ["Matched", result.matchedThreadsCount],
    ["Search window", `first ${result.searchLookaheadLimit} matches`],
    ["Moved", result.movedToTrashCount],
    ["Skipped", result.skippedCount],
    ["Query", result.query],
  ];

  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:1px solid #e8eaed;">',
    rows.map(([label, value]) => (
      '<tr>' +
      `<td style="width:120px;padding:8px 24px;color:#5f6368;font-size:12px;vertical-align:top;">${escapeHtml_(label)}</td>` +
      `<td style="padding:8px 24px 8px 0;color:#202124;font-size:12px;vertical-align:top;">${escapeHtml_(String(value))}</td>` +
      '</tr>'
    )).join(""),
    '</table>',
  ].join("");
}

function sortThreadsForReport_(threads) {
  const copy = threads.slice();
  copy.sort((a, b) => new Date(b.date) - new Date(a.date));
  return copy;
}

function buildThreadTable_(threads) {
  if (threads.length === 0) {
    return '<div style="padding:20px 24px;color:#5f6368;font-size:13px;">No threads to show.</div>';
  }

  const rows = threads.map((thread) => {
    const date = Utilities.formatDate(
      new Date(thread.date),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );
    const subject = thread.subject || "(no subject)";

    return [
      `<tr style="border-bottom:1px solid #eef0f2;">`,
      `<td style="padding:10px 0 10px 24px;width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#202124;font-size:13px;font-weight:600;">`,
      `<a href="${escapeHtml_(thread.trashUrl)}" style="color:#202124;text-decoration:none;display:block;">${escapeHtml_(thread.sender || thread.from)}</a>`,
      `</td>`,
      `<td style="padding:10px 12px;color:#202124;font-size:13px;">`,
      `<a href="${escapeHtml_(thread.trashUrl)}" style="color:#202124;text-decoration:none;display:block;">${escapeHtml_(subject)}</a>`,
      `</td>`,
      `<td style="padding:10px 24px 10px 0;width:96px;text-align:right;color:#5f6368;font-size:12px;white-space:nowrap;">`,
      `<a href="${escapeHtml_(thread.trashUrl)}" style="color:#5f6368;text-decoration:none;display:block;">${escapeHtml_(date)}</a>`,
      `</td>`,
      `</tr>`,
    ].join("");
  }).join("");

  return [
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">',
    '<thead>',
    '<tr style="background:#f8fafd;border-bottom:1px solid #e8eaed;">',
    '<th align="left" style="padding:9px 0 9px 24px;color:#5f6368;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">From</th>',
    '<th align="left" style="padding:9px 12px;color:#5f6368;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Subject</th>',
    '<th align="right" style="padding:9px 24px 9px 0;color:#5f6368;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Date</th>',
    '</tr>',
    '</thead>',
    '<tbody>',
    rows,
    '</tbody>',
    '</table>',
  ].join("");
}

function buildErrorBlock_(errors) {
  if (errors.length === 0) {
    return "";
  }

  return [
    '<div style="padding:16px 24px;border-top:1px solid #e8eaed;background:#fff7f7;">',
    '<div style="color:#b3261e;font-size:13px;font-weight:700;">Errors</div>',
    '<ul style="margin:8px 0 0 18px;padding:0;color:#3c4043;font-size:12px;line-height:1.5;">',
    errors.map((error) => `<li>${escapeHtml_(error)}</li>`).join(""),
    '</ul>',
    '</div>',
  ].join("");
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function labelReportEmail_(subject) {
  try {
    Utilities.sleep(1000);
    const purgeLabel = getOrCreateLabel_(PURGE_LABEL);
    const threads = GmailApp.search(`subject:"${subject}" newer_than:1d`, 0, 10);
    threads.forEach((thread) => purgeLabel.addToThread(thread));
  } catch (error) {
    Logger.log(`Could not label report email: ${error}`);
  }
}
