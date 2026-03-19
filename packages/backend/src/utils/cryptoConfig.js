const { CONFIG_SECRET } = require('../config/env');
const crypto = require('crypto');

/**
 * Derive a 32-byte key from CONFIG_SECRET (if present & sufficiently long).
 */
function getSecret() {
    const secret = CONFIG_SECRET;
    if (!secret || secret.length < 16) return null;
    return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt JSON string with AES-256-GCM (iv(12) + tag(16) + ciphertext) -> base64 prefixed with enc:
 */
function encryptConfig(jsonStr) {
    const key = getSecret();
    if (!key) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, ciphertext]);
    return 'enc:' + payload.toString('base64url');
}

/**
 * Decrypt enc:<base64> token
 */
function decryptConfig(token) {
    if (!token.startsWith('enc:')) throw new Error('Not encrypted');
    const key = getSecret();
    if (!key) throw new Error('Encryption disabled');
    let b64 = token.slice(4);

    // Normalize base64url to standard base64 to ensure reliable decoding
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padNeeded = (4 - (b64.length % 4)) % 4;
    if (padNeeded) b64 += '='.repeat(padNeeded);

    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 12 + 16 + 1) throw new Error('Bad payload');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
}

/**
 * Decode plain (possibly base64url) token and parse JSON.
 * Accepts:
 *  - enc:<base64> encrypted
 *  - base64 (with + / =)
 *  - base64url ( - _ no padding)
 */
function tryParseConfigToken(token) {
    if (!token) throw new Error('Empty token');
    if (token.startsWith('enc:')) return decryptConfig(token);

    // Normalize base64url -> base64
    let base = token.replace(/-/g, '+').replace(/_/g, '/');
    // Re-pad
    const padNeeded = (4 - (base.length % 4)) % 4;
    if (padNeeded) base += '='.repeat(padNeeded);

    let jsonStr;
    try {
        const raw = Buffer.from(base, 'base64').toString('utf8');
        jsonStr = raw;
    } catch {
        throw new Error('Invalid base64');
    }
    try {
        return JSON.parse(jsonStr);
    } catch {
        throw new Error('Invalid JSON config');
    }
}

module.exports = {
    encryptConfig,
    decryptConfig,
    tryParseConfigToken
};