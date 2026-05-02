const PURGE_LABEL = "Purge";
const CREDENTIALS_LABEL = "Credentials";
const KEEP_LABEL = "Keep";
const RETENTION_DAYS = 1024;
const CREDENTIALS_RETENTION_DAYS = 16;
const DRY_RUN = false;
const MAX_THREADS_PER_RUN = 50;
const MIN_THREADS_TO_DELETE = 25;
const SEARCH_LOOKAHEAD_LIMIT = 1000;
const GMAIL_SEARCH_PAGE_SIZE = 500;
const SEND_DELETE_REPORT = true;
const ERROR_REPORTS_ENABLED = true;
const AUTO_LABEL_CREDENTIALS = true;
const CREDENTIALS_AUTOLABEL_WINDOW_HOURS = 48;
const EXCLUDED_SYSTEM_QUERY_TERMS = ["-in:chats", "-in:sent", "-in:drafts", "-in:spam", "-in:trash"];

const PURGE_CLASSES = [
  {
    name: "Purge",
    label: PURGE_LABEL,
    retentionDays: RETENTION_DAYS,
    minThreadsToDelete: MIN_THREADS_TO_DELETE,
    protectKeep: true,
    protectStarred: true,
    reportType: "normal",
  },
  {
    name: "Credentials",
    label: CREDENTIALS_LABEL,
    retentionDays: CREDENTIALS_RETENTION_DAYS,
    minThreadsToDelete: 1,
    protectKeep: false,
    protectStarred: false,
    reportType: "urgent",
  },
];

function install() {
  ensureLabels_();
  const trigger = createDailyTrigger();
  const result = {
    installedAt: new Date().toISOString(),
    labels: [KEEP_LABEL, PURGE_LABEL, CREDENTIALS_LABEL],
    triggerFunction: "runPurgeCleanup",
    triggerCreated: trigger.created,
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function previewPurgeCleanup() {
  return executePurgeCleanup_({ dryRun: true, ignoreMinimum: true, sendReports: false });
}

function testPurgeReports() {
  return executePurgeCleanup_({ dryRun: true, ignoreMinimum: true, sendReports: true });
}

function labelRecentCredentialCandidates() {
  return labelCredentialCandidates(CREDENTIALS_AUTOLABEL_WINDOW_HOURS);
}

function labelAllCredentialCandidates() {
  return labelCredentialCandidates_({
    mode: "BACKFILL",
    windowHours: null,
  });
}

function labelInboxCredentialCandidates() {
  return labelAllCredentialCandidates();
}

function labelCredentialCandidates(windowHours) {
  const normalizedWindowHours = normalizeWindowHours_(windowHours);
  return labelCredentialCandidates_({
    mode: normalizedWindowHours === null ? "BACKFILL" : "RECENT",
    windowHours: normalizedWindowHours,
  });
}

function runPurgeCleanup() {
  const credentialLabelingResult = AUTO_LABEL_CREDENTIALS && !DRY_RUN
    ? labelCredentialCandidates_({ mode: "RECENT", windowHours: CREDENTIALS_AUTOLABEL_WINDOW_HOURS })
    : null;

  return executePurgeCleanup_({
    dryRun: DRY_RUN,
    ignoreMinimum: false,
    sendReports: false,
    credentialLabelingResult,
  });
}

function executePurgeCleanup_(options) {
  const startedAt = new Date();
  const dryRun = Boolean(options && options.dryRun);
  const ignoreMinimum = Boolean(options && options.ignoreMinimum);
  const sendReports = Boolean(options && options.sendReports);
  const mode = dryRun ? "DRY_RUN" : "ACTIVE";
  const credentialLabelingResult = options && options.credentialLabelingResult
    ? options.credentialLabelingResult
    : null;

  const results = PURGE_CLASSES.map((purgeClass) => (
    executePurgeClassCleanup_(purgeClass, { startedAt, dryRun, ignoreMinimum, sendReports, mode })
  ));

  return {
    startedAt: startedAt.toISOString(),
    mode,
    credentialLabelingResult,
    results,
  };
}

function normalizeWindowHours_(windowHours) {
  if (windowHours === undefined || windowHours === "") {
    return CREDENTIALS_AUTOLABEL_WINDOW_HOURS;
  }

  if (windowHours === null) {
    return null;
  }

  const numericWindowHours = Number(windowHours);
  if (!isFinite(numericWindowHours) || numericWindowHours <= 0) {
    throw new Error("windowHours must be a positive number, or null for full matching-mail backfill.");
  }

  return numericWindowHours;
}

function labelCredentialCandidates_(options) {
  const startedAt = new Date();
  const windowHours = options.windowHours;
  const cutoffDate = windowHours === null
    ? null
    : new Date(startedAt.getTime() - (windowHours * 60 * 60 * 1000));
  const query = buildCredentialAutoLabelQuery_(windowHours);
  const threads = findAllThreads_(query);
  const credentialsLabel = getOrCreateLabel_(CREDENTIALS_LABEL);
  const labeledThreads = [];
  const examples = [];
  const errors = [];
  let skippedCount = 0;

  threads.forEach((thread) => {
    let summary = null;
    try {
      summary = summarizeThread_(thread);
      if (threadHasLabel_(thread, CREDENTIALS_LABEL)) {
        skippedCount += 1;
        return;
      }

      if (!threadLooksLikeCredentials_(thread, cutoffDate)) {
        skippedCount += 1;
        return;
      }

      credentialsLabel.addToThread(thread);
      labeledThreads.push(summary);
      if (examples.length < 10) {
        examples.push(summary);
      }
    } catch (error) {
      skippedCount += 1;
      errors.push(formatThreadError_(summary, error));
    }
  });

  const result = {
    startedAt: startedAt.toISOString(),
    mode: options.mode,
    windowHours,
    query,
    scannedThreadsCount: threads.length,
    newlyLabeledCount: labeledThreads.length,
    skippedCount,
    errorCount: errors.length,
    errors,
    examples,
  };

  logCredentialLabelingResult_(result);
  return result;
}

function findAllThreads_(query) {
  const threads = [];
  let start = 0;

  while (true) {
    const page = GmailApp.search(query, start, GMAIL_SEARCH_PAGE_SIZE);
    if (!page || page.length === 0) {
      break;
    }

    threads.push(...page);
    if (page.length < GMAIL_SEARCH_PAGE_SIZE) {
      break;
    }

    start += page.length;
  }

  return threads;
}

function threadHasLabel_(thread, labelName) {
  return thread.getLabels().some((label) => label.getName() === labelName);
}

function executePurgeClassCleanup_(purgeClass, options) {
  const query = buildPurgeQuery(purgeClass);
  const selection = selectOldestThreads_(query);
  const threads = selection.selectedThreads;
  const deletedThreads = [];
  const previewThreads = [];
  const errors = [];
  let movedToTrashCount = 0;
  let skippedCount = 0;
  let skippedReason = "";

  if (!options.dryRun && !options.ignoreMinimum && selection.totalMatches < purgeClass.minThreadsToDelete) {
    skippedCount = selection.totalMatches;
    skippedReason = `Only ${selection.totalMatches} matching ${purgeClass.name} threads found; minimum is ${purgeClass.minThreadsToDelete}.`;
  } else {
    threads.forEach((thread) => {
      let summary = null;
      try {
        summary = summarizeThread_(thread);
        const skipReason = getThreadSkipReason_(thread);
        if (skipReason) {
          skippedCount += 1;
          Logger.log(`Skipped ${purgeClass.name} thread: ${skipReason}; ${formatThreadForLog_(summary)}`);
          return;
        }

        previewThreads.push(summary);

        if (options.dryRun) {
          skippedCount += 1;
          return;
        }

        thread.moveToTrash();
        movedToTrashCount += 1;
        deletedThreads.push(summary);
      } catch (error) {
        skippedCount += 1;
        errors.push(formatThreadError_(summary, error));
      }
    });
  }

  const result = {
    startedAt: options.startedAt.toISOString(),
    mode: options.mode,
    testReport: options.dryRun && options.sendReports,
    purgeClassName: purgeClass.name,
    reportType: purgeClass.reportType,
    query,
    matchedThreadsCount: selection.totalMatches,
    searchLookaheadLimit: SEARCH_LOOKAHEAD_LIMIT,
    movedToTrashCount,
    skippedCount,
    skippedReason,
    errors,
    previewThreads: previewThreads.slice(0, options.sendReports ? MAX_THREADS_PER_RUN : 10),
    deletedThreads,
  };

  logResult_(result);
  if (options.sendReports || !options.dryRun) {
    maybeSendReport_(result);
  }
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

function buildPurgeQuery(purgeClass) {
  const terms = [
    `label:${purgeClass.label}`,
    `older_than:${purgeClass.retentionDays}d`,
    ...EXCLUDED_SYSTEM_QUERY_TERMS,
  ];

  if (purgeClass.protectKeep) {
    terms.push(`-label:${KEEP_LABEL}`);
  }

  if (purgeClass.protectStarred) {
    terms.push("-is:starred");
  }

  return terms.join(" ");
}

function getThreadSkipReason_(thread) {
  if (thread.isInTrash()) {
    return "already in Trash";
  }

  if (thread.isInSpam()) {
    return "in Spam";
  }

  if (thread.isInChats()) {
    return "in Chats";
  }

  return "";
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
  getOrCreateLabel_(KEEP_LABEL);
  getOrCreateLabel_(PURGE_LABEL);
  getOrCreateLabel_(CREDENTIALS_LABEL);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function summarizeThread_(thread) {
  const firstMessage = thread.getMessages()[0];
  const threadId = thread.getId();
  const messageId = firstMessage.getHeader("Message-ID");
  const from = firstMessage.getFrom();

  return {
    from,
    sender: formatSender_(from),
    subject: firstMessage.getSubject(),
    date: firstMessage.getDate(),
    threadUrl: buildThreadUrl_(messageId, threadId),
    trashUrl: buildTrashUrl_(messageId, threadId),
  };
}

function buildThreadUrl_(messageId, threadId) {
  if (messageId) {
    const query = `rfc822msgid:${messageId}`;
    return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
  }

  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
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
  Logger.log(JSON.stringify(buildLogResult_(result), null, 2));
}

function logCredentialLabelingResult_(result) {
  Logger.log(JSON.stringify({
    startedAt: result.startedAt,
    mode: result.mode,
    windowHours: result.windowHours,
    query: result.query,
    scannedThreadsCount: result.scannedThreadsCount,
    newlyLabeledCount: result.newlyLabeledCount,
    skippedCount: result.skippedCount,
    errorCount: result.errorCount,
    errors: result.errors,
    examples: result.examples.map((thread) => ({
      from: thread.from,
      subject: thread.subject,
      date: thread.date,
    })),
  }, null, 2));
}

function buildLogResult_(result) {
  return {
    startedAt: result.startedAt,
    mode: result.mode,
    purgeClassName: result.purgeClassName,
    reportType: result.reportType,
    query: result.query,
    matchedThreadsCount: result.matchedThreadsCount,
    searchLookaheadLimit: result.searchLookaheadLimit,
    movedToTrashCount: result.movedToTrashCount,
    skippedCount: result.skippedCount,
    skippedReason: result.skippedReason,
    errorCount: result.errors.length,
    errors: result.errors,
  };
}

function maybeSendReport_(result) {
  const hasErrors = result.errors.length > 0;
  const movedThreads = result.movedToTrashCount > 0;

  if (result.testReport) {
    sendReportEmail_(result, result.reportType === "urgent" ? "CREDENTIALS_REPORT" : "DELETE_REPORT");
    return;
  }

  if (!movedThreads) {
    if (hasErrors && ERROR_REPORTS_ENABLED) {
      sendReportEmail_(result, "ERROR");
    }
    return;
  }

  if (result.reportType === "urgent") {
    sendReportEmail_(result, "CREDENTIALS_REPORT");
    return;
  }

  if (!SEND_DELETE_REPORT) {
    if (hasErrors && ERROR_REPORTS_ENABLED) {
      sendReportEmail_(result, "ERROR");
    }
    return;
  }

  sendReportEmail_(result, hasErrors ? "DELETE_REPORT_WITH_ERRORS" : "DELETE_REPORT");
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
  const draft = GmailApp.createDraft(recipient, subject, body, {
    htmlBody,
    name: "Gmail AutoPurge",
  });
  const message = draft.send();

  labelReportEmail_(message);
}

function buildReportSubject_(result, reportType, runId) {
  if (reportType === "ERROR") {
    return `REVIEW: Gmail AutoPurge ${result.purgeClassName} failed on ${result.errors.length} threads (${runId})`;
  }

  if (reportType === "DELETE_REPORT_WITH_ERRORS") {
    return `REVIEW: Gmail AutoPurge moved ${result.movedToTrashCount} ${result.purgeClassName} threads; ${result.errors.length} errors`;
  }

  const reportThreadCount = getReportThreadCount_(result);

  if (reportType === "CREDENTIALS_REPORT") {
    if (result.testReport) {
      return `TEST REPORT - REVIEW NOW: ${reportThreadCount} possible CREDENTIALS candidates`;
    }

    return `REVIEW NOW: ${result.movedToTrashCount} possible CREDENTIALS moved to Trash`;
  }

  if (result.testReport) {
    return `TEST REPORT: Gmail AutoPurge found ${reportThreadCount} old ${result.purgeClassName} candidates`;
  }

  return `REVIEW: Gmail AutoPurge moved ${result.movedToTrashCount} old ${result.purgeClassName} threads to Trash`;
}

function getReportThreadCount_(result) {
  return result.deletedThreads.length > 0
    ? result.deletedThreads.length
    : result.previewThreads.length;
}

function buildPlainReportBody_(result) {
  const threads = result.deletedThreads.length > 0
    ? result.deletedThreads
    : result.previewThreads;
  const reportThreads = sortThreadsForReport_(threads);
  const lines = [result.deletedThreads.length > 0 ? "Moved threads:" : "Preview threads:"];

  if (reportThreads.length === 0) {
    lines.push("- none");
  } else {
    reportThreads.forEach((thread) => {
      lines.push(`- ${thread.date}: ${thread.from}`);
      lines.push(`  Subject: ${thread.subject}`);
    });
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    result.errors.forEach((error) => lines.push(`- ${error}`));
  }

  return lines.join("\n");
}

function buildHtmlReportBody_(result) {
  const movedThreads = result.deletedThreads.length > 0;
  const threads = movedThreads ? result.deletedThreads : result.previewThreads;
  const reportThreads = sortThreadsForReport_(threads);
  const title = "Gmail AutoPurge report";
  const subtitle = movedThreads ? "" : "No threads were moved in this run.";
  const header = movedThreads ? "" : [
    '<div style="padding:12px 8px;border-bottom:1px solid #e8eaed;">',
    `<div style="font-size:18px;font-weight:700;line-height:1.3;">${escapeHtml_(title)}</div>`,
    subtitle ? `<div style="margin-top:6px;color:#5f6368;font-size:13px;line-height:1.5;">${escapeHtml_(subtitle)}</div>` : "",
    '</div>',
  ].join("");

  return [
    '<div style="margin:0;padding:0;background:#ffffff;color:#202124;font-family:Arial,Helvetica,sans-serif;">',
    '<div style="margin:0;padding:0;">',
    '<div style="background:#ffffff;overflow:hidden;">',
    header,
    buildThreadTable_(reportThreads, movedThreads),
    buildErrorBlock_(result.errors),
    '</div>',
    '</div>',
    '</div>',
  ].join("");
}

function sortThreadsForReport_(threads) {
  const copy = threads.slice();
  copy.sort((a, b) => new Date(b.date) - new Date(a.date));
  return copy;
}

function buildThreadTable_(threads, movedThreads) {
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
    const threadUrl = getReportThreadUrl_(thread, movedThreads);

    return [
      `<tr style="border-bottom:1px solid #eef0f2;">`,
      `<td style="padding:3px 0 3px 8px;width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#202124;font-size:13px;font-weight:400;line-height:18px;">`,
      `<a href="${escapeHtml_(threadUrl)}" target="_blank" style="color:#202124;text-decoration:none;font-weight:400;line-height:18px;">${escapeHtml_(thread.sender || thread.from)}</a>`,
      `</td>`,
      `<td style="padding:3px 12px;color:#202124;font-size:13px;font-weight:400;line-height:18px;">`,
      `<a href="${escapeHtml_(threadUrl)}" target="_blank" style="color:#202124;text-decoration:none;font-weight:400;line-height:18px;">${escapeHtml_(subject)}</a>`,
      `</td>`,
      `<td style="padding:3px 8px 3px 0;width:86px;text-align:right;color:#5f6368;font-size:12px;font-weight:400;line-height:18px;white-space:nowrap;">`,
      `<a href="${escapeHtml_(threadUrl)}" target="_blank" style="color:#5f6368;text-decoration:none;font-weight:400;line-height:18px;">${escapeHtml_(date)}</a>`,
      `</td>`,
      `</tr>`,
    ].join("");
  }).join("");

  return [
    '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">',
    '<tbody>',
    rows,
    '</tbody>',
    '</table>',
  ].join("");
}

function getReportThreadUrl_(thread, movedThreads) {
  return movedThreads ? thread.trashUrl : thread.threadUrl;
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

function formatThreadError_(summary, error) {
  const errorText = String(error && error.stack ? error.stack : error);
  if (!summary) {
    return errorText;
  }

  return `${formatThreadForLog_(summary)}\n${errorText}`;
}

function formatThreadForLog_(summary) {
  return [
    `from=${summary.from || ""}`,
    `subject=${summary.subject || "(no subject)"}`,
    `date=${summary.date || ""}`,
    `url=${summary.trashUrl || ""}`,
  ].join("; ");
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function labelReportEmail_(message) {
  try {
    const purgeLabel = getOrCreateLabel_(PURGE_LABEL);
    purgeLabel.addToThread(message.getThread());
  } catch (error) {
    Logger.log(`Could not label report email: ${error}`);
  }
}
