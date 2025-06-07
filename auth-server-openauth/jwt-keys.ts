import crypto from 'crypto';
import * as jose from 'jose';

let privateKey: string;
let jwksPublicKey: jose.KeyLike;
let jwksPublicJWK: jose.JWK;
export const keyId = 'auth-server-signing-key';

export async function initializeKeys(): Promise<void> {
  const privateKeyEnv = process.env.JWT_PRIVATE_KEY;
  const publicKeyEnv = process.env.JWT_PUBLIC_KEY;

  if (privateKeyEnv && publicKeyEnv) {
    // Production: Use environment variables
    console.log('[Keys] Using environment variables for JWT keys');
    privateKey = privateKeyEnv.replace(/\\n/g, '\n');
    const publicKeyPem = publicKeyEnv.replace(/\\n/g, '\n');
    
    jwksPublicKey = await jose.importSPKI(publicKeyPem, 'RS256');
    jwksPublicJWK = await jose.exportJWK(jwksPublicKey);
    console.log('[Keys] JWT keys loaded from environment');
  } else {
    // Development: Generate temporary keys
    console.log('[Keys] Generating temporary RSA key pair for development');
    console.warn('⚠️  Using temporary keys! Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY for production');
    
    const { publicKey: pubKey, privateKey: privKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    privateKey = privKey;
    jwksPublicKey = await jose.importSPKI(pubKey, 'RS256');
    jwksPublicJWK = await jose.exportJWK(jwksPublicKey);
    console.log('[Keys] Temporary keys generated successfully');
  }
}

export function getPrivateKey(): string {
  if (!privateKey) {
    throw new Error('JWT keys not initialized. Call initializeKeys() first.');
  }
  return privateKey;
}

export function getPublicJWK(): jose.JWK {
  if (!jwksPublicJWK) {
    throw new Error('JWT keys not initialized. Call initializeKeys() first.');
  }
  return jwksPublicJWK;
} 