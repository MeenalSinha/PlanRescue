import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const TAG_LENGTH = 16; // 128-bit authentication tag
const SALT_LENGTH = 16; // 128-bit salt for scrypt
const LEGACY_DEFAULT_SALT = 'planrescue-spatial-crypto-salt-2026';

export class CryptoConfigError extends Error {
  override name = 'CryptoConfigError';
}

/**
 * Resolves the active encryption secret.
 * Enforces production security invariants:
 * - In production, a secret >= 32 characters MUST be explicitly configured.
 * - Source-code fallback strings are strictly forbidden in production.
 */
export function getEncryptionSecret(explicitSecret?: string): string {
  if (explicitSecret) {
    return explicitSecret;
  }

  const envSecret = process.env.ENCRYPTION_SECRET || process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';

  if (isProduction) {
    if (!envSecret) {
      throw new CryptoConfigError(
        'Production encryption secret is missing. Set ENCRYPTION_SECRET or SESSION_SECRET (min 32 chars).',
      );
    }
    if (envSecret.length < 32) {
      throw new CryptoConfigError(
        `Production encryption secret is too weak (length ${envSecret.length}). Must be at least 32 characters.`,
      );
    }
    if (
      envSecret.includes('planrescue-spatial-internal-key') ||
      envSecret.includes('your-secure-random')
    ) {
      throw new CryptoConfigError('Production encryption secret cannot use a known placeholder string.');
    }
    return envSecret;
  }

  // Development/Test fallback only when NOT in production
  return envSecret || 'planrescue-dev-only-secret-key-32-chars-long!';
}

export function deriveKey(secret: string, salt: Buffer | string): Buffer {
  const saltBuffer = typeof salt === 'string' ? Buffer.from(salt, 'hex') : salt;
  return scryptSync(secret, saltBuffer, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Encrypts a plaintext string using authenticated AES-256-GCM.
 * Version 2 format: `v2.<saltHex>.<ivHex>.<tagHex>.<ciphertextHex>`
 * Each ciphertext receives a fresh, cryptographically secure random salt and unique nonce/IV.
 */
export function encryptData(plaintext: string, secret?: string): string {
  const activeSecret = getEncryptionSecret(secret);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(activeSecret, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `v2.${salt.toString('hex')}.${iv.toString('hex')}.${tag.toString('hex')}.${encrypted}`;
}

/**
 * Decrypts an authenticated AES-256-GCM encrypted string, validating the authentication tag.
 * Supports versioned format `v2.<salt>.<iv>.<tag>.<cipher>` and migratable legacy format `<iv>.<tag>.<cipher>`.
 * Fails closed: throws if ciphertext is corrupted, tampered with, or key is invalid.
 */
export function decryptData(encryptedPayload: string, secret?: string): string {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Encrypted payload must be a non-empty string');
  }

  const activeSecret = getEncryptionSecret(secret);
  const parts = encryptedPayload.split('.');

  // Format v2: v2.salt.iv.tag.ciphertext (5 parts)
  if (parts.length === 5 && parts[0] === 'v2') {
    const [, saltHex, ivHex, tagHex, cipherHex] = parts as [string, string, string, string, string];
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || salt.length !== SALT_LENGTH) {
      throw new Error('Invalid v2 ciphertext component length');
    }

    const key = deriveKey(activeSecret, salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Legacy format v1: iv.tag.ciphertext (3 parts)
  if (parts.length === 3) {
    const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new Error('Invalid legacy ciphertext component length');
    }

    const legacyKey = scryptSync(activeSecret, LEGACY_DEFAULT_SALT, 32);
    const decipher = createDecipheriv(ALGORITHM, legacyKey, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error('Unsupported or corrupted encrypted payload format');
}

/**
 * Migrates a ciphertext string to the latest versioned (v2) format if needed.
 */
export function migrateCiphertext(encryptedPayload: string, secret?: string): string {
  if (encryptedPayload.startsWith('v2.')) {
    return encryptedPayload;
  }
  const plaintext = decryptData(encryptedPayload, secret);
  return encryptData(plaintext, secret);
}
