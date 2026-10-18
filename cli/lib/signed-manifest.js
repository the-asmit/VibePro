import crypto from 'node:crypto';
import { TRUSTED_KEY_ID, TRUSTED_PUBLIC_KEY_PEM } from './trusted-key.js';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintForKey(pem) {
  const key = crypto.createPublicKey(pem);
  return crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

export function verifySignedManifest(envelope, options = {}) {
  if (!envelope || typeof envelope !== 'object' || !envelope.manifest || typeof envelope.manifest !== 'object'
      || typeof envelope.signature !== 'string' || typeof envelope.key_id !== 'string') {
    throw new Error('Backend returned a missing or malformed signed manifest.');
  }
  let publicKeyPem = options.publicKeyPem || TRUSTED_PUBLIC_KEY_PEM;
  let expectedKeyId = options.keyId || TRUSTED_KEY_ID;
  if (!options.publicKeyPem && process.env.NODE_ENV === 'test' && process.env.VIBEPRO_TEST_PUBLIC_KEY) {
    publicKeyPem = process.env.VIBEPRO_TEST_PUBLIC_KEY.replace(/\\n/g, '\n');
    expectedKeyId = fingerprintForKey(publicKeyPem);
  }
  if (envelope.key_id !== expectedKeyId || fingerprintForKey(publicKeyPem) !== expectedKeyId) {
    throw new Error('Backend signing key is not trusted (key ID mismatch).');
  }
  let signature;
  try { signature = Buffer.from(envelope.signature, 'base64'); }
  catch { throw new Error('Backend returned an invalid manifest signature.'); }
  if (signature.length !== 64 || signature.toString('base64') !== envelope.signature) {
    throw new Error('Backend returned an invalid manifest signature.');
  }
  const valid = crypto.verify(null, Buffer.from(canonicalJson(envelope.manifest), 'utf8'), crypto.createPublicKey(publicKeyPem), signature);
  if (!valid) throw new Error('Manifest signature verification failed; the response may have been tampered with.');
  return envelope.manifest;
}
