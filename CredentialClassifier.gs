const CREDENTIALS_PREFILTER_TERMS = [
  "password",
  "パスワード",
  "пароль",
  "รหัสผ่าน",
  "\"login details\"",
  "\"login data\"",
  "\"account details\"",
  "\"access details\"",
  "PIN",
  "\"PIN code\"",
  "\"license key\"",
  "\"product key\"",
  "\"serial number\"",
  "\"activation key\"",
  "\"activation code\"",
  "\"recovery code\"",
  "\"backup code\"",
  "\"API key\"",
  "\"access token\"",
  "\"код активации\"",
  "\"код активації\"",
  "\"резервный код\"",
  "\"резервний код\"",
  "\"รหัสกู้คืน\"",
  "\"รหัสสำรอง\"",
  "mirror",
];

function buildCredentialAutoLabelQuery_(windowHours) {
  return buildCredentialCandidateQuery_(windowHours, true);
}

function buildCredentialCandidateQuery_(windowHours, excludeAlreadyLabeled) {
  const prefilterTerms = CREDENTIALS_PREFILTER_TERMS.join(" OR ");
  const terms = [`(${prefilterTerms})`];

  if (excludeAlreadyLabeled) {
    terms.unshift(`-label:${CREDENTIALS_LABEL}`);
  }

  if (windowHours !== null) {
    terms.push(`newer_than:${Math.max(1, Math.ceil(windowHours / 24))}d`);
  }

  return terms.join(" ");
}

function threadLooksLikeCredentials_(thread, cutoffDate) {
  return Boolean(findThreadCredentialPattern_(thread, cutoffDate));
}

function findThreadCredentialPattern_(thread, cutoffDate) {
  for (const message of thread.getMessages()) {
    if (cutoffDate && message.getDate() < cutoffDate) {
      continue;
    }

    const matchedPattern = findMessageCredentialPattern_(message);
    if (matchedPattern) {
      return matchedPattern;
    }
  }

  return "";
}

function messageLooksLikeCredentials_(message) {
  return Boolean(findMessageCredentialPattern_(message));
}

function findMessageCredentialPattern_(message) {
  if (isAutoPurgeReportMessage_(message)) {
    return "";
  }

  return findCredentialPatternNameForFields_({
    subject: message.getSubject(),
    body: getCredentialMessageBodyText_(message),
    bodyHtml: message.getBody(),
  });
}

function getCredentialMessageBodyText_(message) {
  const plainBody = message.getPlainBody();
  if (String(plainBody || "").trim()) {
    return plainBody;
  }

  return message.getBody();
}

function isAutoPurgeReportMessage_(message) {
  const from = String(message.getFrom() || "");
  const subject = String(message.getSubject() || "");

  return /Gmail AutoPurge/i.test(from) || /Gmail AutoPurge/i.test(subject);
}

function findCredentialPatternNameForText_(text) {
  return findCredentialPatternNameForFields_({
    subject: "",
    body: text,
    bodyHtml: "",
  });
}

function findCredentialPatternNameForFields_(fields) {
  return findCredentialPatternMatch_(CREDENTIAL_PATTERNS_, fields || {});
}

function findCredentialPatternMatch_(patterns, fields) {
  const match = patterns.find((credentialPattern) => {
    const target = credentialPattern.target || "body";
    return credentialPattern.pattern.test(String(fields[target] || ""));
  });

  return match ? match.name : "";
}

const CREDENTIAL_PATTERNS_ = [
  // Login/password pairs.
  { name: "en-user-field-password-field", target: "body", pattern: /^[\s\S]*\b(?:login|username)\s*:\s*\S+[\s\S]{0,1200}\bpassword\s*:\s*\S+[\s\S]*$/i },
  { name: "ru-login-field-password-field", target: "body", pattern: /^[\s\S]*логин\s*:\s*\S+[\s\S]{0,1200}пароль\s*:\s*\S+[\s\S]*$/i },

  // Single-line password fields.
  { name: "en-password-field-line", target: "body", pattern: /^[^\S\r\n]*password\s*:\s*\S{4,100}[^\S\r\n]*\r?$/im },
  { name: "ru-password-colon-field-line", target: "body", pattern: /^[^\S\r\n]*[Пп]ароль\s*:\s*\S{4,100}[^\S\r\n]*\r?$/m },
  { name: "en-password-dash-field-line", target: "body", pattern: /^[^\S\r\n]*password\s*-\s*\S{4,100}[^\S\r\n]*\r?$/im },
  { name: "ru-password-dash-field-line", target: "body", pattern: /^[^\S\r\n]*[Пп]ароль\s*-\s*\S{4,100}[^\S\r\n]*\r?$/m },

  // Password marker lines where the value is nearby or encoded in a link.
  { name: "en-password-colon-line", target: "body", pattern: /^[^\r\n]*\bpassword:[^\S\r\n]*\r?$/im },
  { name: "en-password-line", target: "body", pattern: /^[^\S\r\n]*password[^\S\r\n]*\r?$/im },

  // Password-like values in prose.
  { name: "en-password-is-token-line", target: "body", pattern: /^[^\r\n]*\b[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s+is\s+(?=\S{4,100}[^\S\r\n]*\r?$)(?=\S*[a-z])(?=\S*(?:[A-Z0-9]|[^A-Za-z0-9\s]))\S+[^\S\r\n]*\r?$/m },
  { name: "password-like-colon-value-line", target: "body", pattern: /\b[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\b[^,;.!?:]{0,160}:(?: |[^\S\r\n]*\r?\n[^\S\r\n]*)(?=[A-Za-z0-9]{6,16}(?:[^A-Za-z0-9]|$))(?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]+(?=[^A-Za-z0-9]|$)/m },
  { name: "en-change-password-asap", target: "body", pattern: /^[\s\S]*\bchange your password as soon as possible\b[\s\S]*$/i },

  // Password reset links.
  { name: "reset-password-direct-link", target: "body", pattern: /(?:^|\n)[^\S\r\n]*[Rr]eset password[ \t]+https?:\/\/\S*reset\S*(?:\?\S+|\/confirm\/\S+)/ },
  { name: "password-reset-token-link", target: "body", pattern: /https?:\/\/\S*(?:password-recovery|password-reset|passwordReset|reset-password|password\/reset|password\/recover|ChangePassword)\S*(?:[?&](?:code|key|token|id|signature|requestEmail|tempPassword)=[A-Za-z0-9_+\/=.-]{6,}|\/confirm\/\S+)/i },

  // Password reset subjects.
  { name: "subject-password-reset", target: "subject", pattern: /\b(?:password reset|reset[^\r\n]{1,80}password|set[^\r\n]{1,80}password|new[^\r\n]{1,80}password)\b/i },
  { name: "subject-ru-password-reset", target: "subject", pattern: /(?:сброс|восстановление|сменить|новый)[^\r\n]{0,40}парол/i },
];
