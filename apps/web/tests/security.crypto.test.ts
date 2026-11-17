import { describe, expect, it, afterEach } from 'vitest';
import {
  decryptData,
  encryptData,
  getEncryptionSecret,
  migrateCiphertext,
  CryptoConfigError,
} from '../src/lib/security/crypto';

const TEST_SECRET = 'test-encryption-key-for-unit-tests-32chars!';
const LEGACY_DEFAULT_SALT = 'planrescue-spatial-crypto-salt-2026';

describe('AES-256-GCM Authenticated Encryption & Key Management', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('encrypts and decrypts plaintext using v2 versioned format with random salt and IV', () => {
    const message = 'secret-calendar-access-token-xyz-123';
    const ciphertext = encryptData(message, TEST_SECRET);

    expect(ciphertext.startsWith('v2.')).toBe(true);
    const parts = ciphertext.split('.');
    expect(parts.length).toBe(5);

    const decrypted = decryptData(ciphertext, TEST_SECRET);
    expect(decrypted).toBe(message);
  });

  it('generates distinct salt, IV and ciphertext for identical plaintext inputs', () => {
    const message = 'identical-token-content';
    const enc1 = encryptData(message, TEST_SECRET);
    const enc2 = encryptData(message, TEST_SECRET);

    expect(enc1).not.toBe(enc2);

    const parts1 = enc1.split('.');
    const parts2 = enc2.split('.');

    // Salts and IVs must be unique
    expect(parts1[1]).not.toBe(parts2[1]); // salt
    expect(parts1[2]).not.toBe(parts2[2]); // iv
  });

  it('fails closed and throws error when decrypting with incorrect secret', () => {
    const message = 'protected-access-token';
    const ciphertext = encryptData(message, TEST_SECRET);

    const wrongSecret = 'different-test-secret-key-32chars!!';
    expect(() => decryptData(ciphertext, wrongSecret)).toThrow();
  });

  it('fails closed and throws error if ciphertext is tampered with', () => {
    const ciphertext = encryptData('valid-token', TEST_SECRET);
    const parts = ciphertext.split('.');

    // Tamper with ciphertext hex (flip last byte)
    const originalCipher = parts[4]!;
    const tamperedCipher =
      originalCipher.slice(0, -2) + (originalCipher.endsWith('00') ? 'ff' : '00');
    const tampered = [parts[0], parts[1], parts[2], parts[3], tamperedCipher].join('.');

    expect(() => decryptData(tampered, TEST_SECRET)).toThrow();
  });

  it('fails closed and throws error if auth tag is tampered with', () => {
    const ciphertext = encryptData('valid-token', TEST_SECRET);
    const parts = ciphertext.split('.');

    // Tamper with tag hex
    const originalTag = parts[3]!;
    const tamperedTag =
      originalTag.slice(0, -2) + (originalTag.endsWith('00') ? 'ff' : '00');
    const tampered = [parts[0], parts[1], parts[2], tamperedTag, parts[4]].join('.');

    expect(() => decryptData(tampered, TEST_SECRET)).toThrow();
  });

  it('fails closed and throws error if IV is tampered with', () => {
    const ciphertext = encryptData('valid-token', TEST_SECRET);
    const parts = ciphertext.split('.');

    const originalIv = parts[2]!;
    const tamperedIv =
      originalIv.slice(0, -2) + (originalIv.endsWith('00') ? 'ff' : '00');
    const tampered = [parts[0], parts[1], tamperedIv, parts[3], parts[4]].join('.');

    expect(() => decryptData(tampered, TEST_SECRET)).toThrow();
  });

  it('decrypts legacy v1 format and migrates it to v2 format with migrateCiphertext', () => {
    // Construct legacy v1 payload manually using scrypt with fixed legacy salt
    const { createCipheriv, randomBytes, scryptSync } = require('node:crypto');
    const legacyKey = scryptSync(TEST_SECRET, LEGACY_DEFAULT_SALT, 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', legacyKey, iv, { authTagLength: 16 });
    let enc = cipher.update('legacy-token-data', 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const legacyPayload = `${iv.toString('hex')}.${tag.toString('hex')}.${enc}`;
    expect(legacyPayload.split('.').length).toBe(3);

    // Decrypts legacy payload
    const decrypted = decryptData(legacyPayload, TEST_SECRET);
    expect(decrypted).toBe('legacy-token-data');

    // Migrates to v2 payload
    const migrated = migrateCiphertext(legacyPayload, TEST_SECRET);
    expect(migrated.startsWith('v2.')).toBe(true);
    expect(migrated.split('.').length).toBe(5);

    // Can decrypt migrated payload
    expect(decryptData(migrated, TEST_SECRET)).toBe('legacy-token-data');
  });

  it('rejects invalid or corrupted payload formats', () => {
    expect(() => decryptData('', TEST_SECRET)).toThrow('Encrypted payload must be a non-empty string');
    expect(() => decryptData('random-corrupted-string', TEST_SECRET)).toThrow('Unsupported or corrupted encrypted payload format');
    expect(() => decryptData('a.b.c.d', TEST_SECRET)).toThrow('Unsupported or corrupted encrypted payload format');
  });

  describe('Production Secret Validation Boundaries', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('throws CryptoConfigError in production if secret is missing', () => {
      process.env.APP_ENV = 'production';
      delete process.env.ENCRYPTION_SECRET;
      delete process.env.SESSION_SECRET;

      expect(() => getEncryptionSecret()).toThrow(CryptoConfigError);
      expect(() => getEncryptionSecret()).toThrow('Production encryption secret is missing');
    });

    it('throws CryptoConfigError in production if secret is too short (< 32 chars)', () => {
      process.env.APP_ENV = 'production';
      process.env.ENCRYPTION_SECRET = 'too-short-secret';

      expect(() => getEncryptionSecret()).toThrow(CryptoConfigError);
      expect(() => getEncryptionSecret()).toThrow('Production encryption secret is too weak');
    });

    it('throws CryptoConfigError in production if secret uses a known placeholder string', () => {
      process.env.APP_ENV = 'production';
      process.env.ENCRYPTION_SECRET = 'planrescue-spatial-internal-key-2026-production-attempt!';

      expect(() => getEncryptionSecret()).toThrow(CryptoConfigError);
      expect(() => getEncryptionSecret()).toThrow('Production encryption secret cannot use a known placeholder string');
    });

    it('accepts valid 32+ char secret in production without error', () => {
      process.env.APP_ENV = 'production';
      process.env.ENCRYPTION_SECRET = 'a-truly-secure-and-random-key-for-prod-32chars!';

      expect(getEncryptionSecret()).toBe('a-truly-secure-and-random-key-for-prod-32chars!');
    });
  });
});
