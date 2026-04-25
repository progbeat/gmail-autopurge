const PURGE_LABEL = "Purge";
const KEEP_LABEL = "Keep";
const RETENTION_DAYS = 1000;
const DRY_RUN = false;
const MAX_THREADS_PER_RUN = 100;
const MIN_THREADS_TO_DELETE = 100;
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
  const threads = GmailApp.search(query, 0, MAX_THREADS_PER_RUN);
  const deletedThreads = [];
  const previewThreads = [];
  const errors = [];
  let movedToTrashCount = 0;
  let skippedCount = 0;
  let skippedReason = "";

  if (!dryRun && !ignoreMinimum && threads.length < MIN_THREADS_TO_DELETE) {
    skippedCount = threads.length;
    skippedReason = `Only ${threads.length} matching threads found; minimum is ${MIN_THREADS_TO_DELETE}.`;
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
    matchedThreadsCount: threads.length,
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
  return {
    from: firstMessage.getFrom(),
    subject: firstMessage.getSubject(),
    date: firstMessage.getDate(),
    permalink: thread.getPermalink(),
  };
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
    "yyyyMMdd-HHmmss"
  );
  const subject = `[Gmail AutoPurge] ${reportType} ${result.mode} ${runId}`;
  const body = buildReportBody_(result);

  MailApp.sendEmail(recipient, subject, body);
  labelReportEmail_(subject);
}

function buildReportBody_(result) {
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

  lines.push(result.deletedThreads.length > 0 ? "Moved threads:" : "Preview threads:");
  if (threads.length === 0) {
    lines.push("- none");
  } else {
    threads.forEach((thread) => {
      lines.push(`- ${thread.date}: ${thread.from}`);
      lines.push(`  Subject: ${thread.subject}`);
      lines.push(`  Link: ${thread.permalink}`);
    });
  }

  return lines.join("\n");
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
