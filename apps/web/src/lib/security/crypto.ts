import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit authentication tag
const DEFAULT_SALT = 'planrescue-spatial-crypto-salt-2026';

function getDerivedKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.SESSION_SECRET || 'planrescue-spatial-internal-key-2026!';
  return scryptSync(secret, DEFAULT_SALT, 32);
}

/**
 * Encrypts a plaintext string using AES-256-GCM authenticated encryption.
 * Output format: `iv.authTag.ciphertext` (hex encoded).
 */
export function encryptData(plaintext: string, keyBuffer: Buffer = getDerivedKey()): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv, { authTagLength: TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string, validating authenticity tag.
 * Throws an error if the payload was modified, corrupted, or tampered with.
 */
export function decryptData(encryptedPayload: string, keyBuffer: Buffer = getDerivedKey()): string {
  const parts = encryptedPayload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
