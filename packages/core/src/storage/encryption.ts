import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Optional AES-256-GCM field encryption for sensitive body text.
 * Disabled by default; enable via config.encryption.enabled.
 */
export class FieldEncryption {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = scryptSync(secret, 'kmind-vault', 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    if (!payload.startsWith('enc:v1:')) return payload;
    const parts = payload.split(':');
    const iv = Buffer.from(parts[2]!, 'base64');
    const tag = Buffer.from(parts[3]!, 'base64');
    const data = Buffer.from(parts[4]!, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
