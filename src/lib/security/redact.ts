/**
 * Removes credentials from text before it is stored, shown, or handed to an
 * agent. Covers the token shapes PATCHWORK handles plus generic key=value
 * assignments.
 */
const TOKEN_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic keys
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g, // Slack
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// Keep the prefix (group 1), redact what follows it.
const PREFIXED_PATTERNS: RegExp[] = [
  /(Authorization:\s*(?:Bearer|token|Basic)\s+)[^\s"']+/gi,
  /(https?:\/\/[^\s:/@]*:)[^@\s]+(?=@)/gi, // credentials embedded in URLs
  /(\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*["']?)[^\s"']{4,}/g,
];

const extraSecrets = new Set<string>();

/** Register a concrete secret value (e.g. a decrypted token) for redaction. */
export function registerSecret(value: string | undefined | null) {
  if (value && value.length >= 8) extraSecrets.add(value);
}

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const secret of extraSecrets) out = out.split(secret).join("[REDACTED]");
  for (const re of TOKEN_PATTERNS) out = out.replace(re, "[REDACTED]");
  for (const re of PREFIXED_PATTERNS) out = out.replace(re, "$1[REDACTED]");
  return out;
}
