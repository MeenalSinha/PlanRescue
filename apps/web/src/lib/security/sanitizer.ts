/**
 * Security & Input Sanitizer (Spatial Phase 12)
 *
 * Guards against prompt injection, control character tampering,
 * script smuggling, and unsafe Unicode sequences in user inputs,
 * event titles, descriptions, and disruption reports.
 */

const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions\b/i,
  /\bsystem\s*:\s*/i,
  /\bdo\s+not\s+validate\b/i,
  /\bbypass\s+(approval|validation|engine)\b/i,
  /\bexecute\s+immediately\s+without\s+confirmation\b/i,
  /<!--[\s\S]*?-->/g,
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
];

/**
 * Sanitizes arbitrary user text before consumption by AI agent or storage.
 * Normalizes Unicode to NFC, removes non-printable ASCII/control characters,
 * and neutralizes common prompt-injection delimiters.
 */
export function sanitizeInput(input: string, maxLength = 2000): string {
  if (typeof input !== 'string') return '';

  // 1. Unicode Normalization (NFC)
  let cleaned = input.normalize('NFC');

  // 2. Remove control characters (except common whitespace: \n, \r, \t)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. Neutralize known prompt injection directives
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[filtered]');
  }

  // 4. Truncate to maximum allowed length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned.trim();
}

/**
 * Inspects text for adversarial prompt injection attempts.
 * Returns true if suspicious adversarial phrasing was detected.
 */
export function detectPromptInjection(input: string): { isSuspicious: boolean; detectedPatterns: string[] } {
  if (typeof input !== 'string') return { isSuspicious: false, detectedPatterns: [] };

  const detected: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      detected.push(pattern.source);
    }
  }

  return {
    isSuspicious: detected.length > 0,
    detectedPatterns: detected,
  };
}
