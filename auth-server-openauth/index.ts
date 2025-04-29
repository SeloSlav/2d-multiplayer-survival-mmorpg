// index.ts
/**
 * OpenAuth issuer + Hono server with password UI and custom OIDC code/token flow.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { issuer } from '@openauthjs/openauth';
import { PasswordProvider } from '@openauthjs/openauth/provider/password';
import { PasswordUI } from '@openauthjs/openauth/ui/password';
import { MemoryStorage } from '@openauthjs/openauth/storage/memory';
import { Select } from '@openauthjs/openauth/ui/select';
import { subjects } from './subjects.js';

import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { Buffer } from 'buffer'; // Needed for PKCE base64
import crypto from 'crypto'; // Needed for PKCE hash
import { cors } from 'hono/cors';
import fsSync from 'fs'; // Use synchronous read for simplicity at startup
// Import jose for JWKS
import * as jose from 'jose';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PORT        = Number(process.env.PORT) || 4001;
const ISSUER_URL  = process.env.ISSUER_URL  || `http://localhost:${PORT}`;
const USERS_PATH  = process.env.USERS_FILE  || path.resolve(__dirname, '../data/users.json');
const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
// const JWT_SECRET  = process.env.JWT_SECRET || 'dev-secret'; // No longer used
const CLIENT_ID   = 'vibe-survival-game-client';

// Load the private key for signing JWTs
let privateKey: string;
let jwksPublicKey: jose.KeyLike; // Store public key in jose format
let jwksPublicJWK: jose.JWK;     // Store public key as plain JWK object
const keyId = 'auth-server-signing-key'; // An identifier for our key

try {
    privateKey = fsSync.readFileSync(path.resolve(__dirname, '../keys/private.pem'), 'utf8');
    const publicKeyPem = fsSync.readFileSync(path.resolve(__dirname, '../keys/public.pem'), 'utf8');
    // Import public key for JWKS endpoint using jose
    jwksPublicKey = await jose.importSPKI(publicKeyPem, 'RS256');
    // Export to JWK format for the response body
    jwksPublicJWK = await jose.exportJWK(jwksPublicKey);
    console.log('[JWKS] Public key loaded and converted to JWK successfully.');
} catch (error) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! FAILED TO LOAD KEYS (private.pem / public.pem)      !!!");
    console.error("!!! Please generate keys using OpenSSL (see README/docs) !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!", error);
    process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Stores                                                                     */
/* -------------------------------------------------------------------------- */
interface UserRecord { userId: string; email: string; passwordHash: string; }
let users     = new Map<string, UserRecord>();
// Store code -> { userId, codeChallenge } for PKCE
interface AuthCodeData { userId: string; codeChallenge: string; codeChallengeMethod: string; clientId: string; redirectUri: string; }
let authCodes = new Map<string, AuthCodeData>(); 

async function loadUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, 'utf-8');
    users = new Map(JSON.parse(raw).map((u: UserRecord) => [u.email, u]));
  } catch (err: any) {
    if (err.code === 'ENOENT') await saveUsers(); else throw err;
  }
}
async function saveUsers() {
  await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
  await fs.writeFile(USERS_PATH, JSON.stringify([...users.values()], null, 2));
}

/* -------------------------------------------------------------------------- */
/* Core Password Logic Handlers (Simple versions)                             */
/* -------------------------------------------------------------------------- */

// These handlers interact directly with your user store
async function _handlePasswordRegisterSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  email = email.toLowerCase();
  if (users.has(email)) {
    console.warn(`[RegisterHandler] Email already taken: ${email}`);
    return null; 
  }
  if (!password) {
    console.error(`[RegisterHandler] Password missing for: ${email}`);
    return null;
  }
  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const newUser: UserRecord = { userId, email, passwordHash };
  users.set(email, newUser);
  await saveUsers();
  console.info(`[RegisterHandler] New user registered: ${email} -> ${userId}`);
  return { id: userId, email };
}

async function _handlePasswordLoginSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  email = email.toLowerCase();
  const user = users.get(email);
  if (!user || !password) {
    console.warn(`[LoginHandler] User not found or password missing for: ${email}`);
    return null;
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    console.warn(`[LoginHandler] Incorrect password for: ${email}`);
    return null;
  }
  console.info(`[LoginHandler] User logged in: ${email} -> ${user.userId}`);
  return { id: user.userId, email };
}

async function _handlePasswordChangeSimple(userId: string, newPassword?: string): Promise<boolean> {
  if (!newPassword) return false;
  let userRecord: UserRecord | undefined;
  let userEmail: string | undefined;
  for (const [email, record] of users.entries()) {
      if (record.userId === userId) {
          userRecord = record;
          userEmail = email;
          break;
      }
  }
  if (!userRecord || !userEmail) return false;
  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const updatedUser: UserRecord = { ...userRecord, passwordHash: newPasswordHash };
  users.set(userEmail, updatedUser);
  await saveUsers();
  console.info(`[ChangeHandler] Password changed for userId: ${userId}`);
  return true;
}

// Placeholder sendCode function
async function handlePasswordSendCode(email: string, code: string): Promise<void> { 
  console.info(`[SendCodeHandler] Code for ${email}: ${code} (Manual Flow)`);
}

/* -------------------------------------------------------------------------- */
/* Provider Handler Wrappers (Match expected signatures)                      */
/* -------------------------------------------------------------------------- */

// These wrappers adapt our simple handlers to the signatures PasswordProvider expects.
// Note: The exact signature and how to signal success/failure might need 
// adjustment based on OpenAuthJS specifics, especially how ctx.success/fail work.

async function handlePasswordRegister(ctx: any, state: any, form?: FormData): Promise<Response> {
    const email = form?.get('email') as string | undefined;
    const password = form?.get('password') as string | undefined;
    if (!email || !password) {
        return ctx.fail ? ctx.fail({ error: 'invalid_request' }) : new Response('Missing email or password', { status: 400 });
    }
    const result = await _handlePasswordRegisterSimple(email, password);
    if (!result) {
        return ctx.fail ? ctx.fail({ error: 'registration_failed' }) : new Response('Registration failed', { status: 400 });
    }
    // Assuming ctx.success exists and takes the user data
    return ctx.success ? ctx.success({ user: result }) : new Response(JSON.stringify(result), { status: 200 });
}

async function handlePasswordLogin(ctx: any, form?: FormData): Promise<Response> {
    const email = form?.get('email') as string | undefined;
    const password = form?.get('password') as string | undefined;
     if (!email || !password) {
        return ctx.fail ? ctx.fail({ error: 'invalid_request' }) : new Response('Missing email or password', { status: 400 });
    }
    const result = await _handlePasswordLoginSimple(email, password);
    if (!result) {
        return ctx.fail ? ctx.fail({ error: 'invalid_credentials' }) : new Response('Login failed', { status: 401 });
    }
    return ctx.success ? ctx.success({ user: result }) : new Response(JSON.stringify(result), { status: 200 });
}

async function handlePasswordChange(ctx: any, state: any, form?: FormData): Promise<Response> {
    const userId = state?.userId; // Assuming userId is in the state object
    const newPassword = form?.get('password') as string | undefined;
    if (!userId || !newPassword) {
       return ctx.fail ? ctx.fail({ error: 'invalid_request' }) : new Response('Missing user context or new password', { status: 400 });
    }
    const success = await _handlePasswordChangeSimple(userId, newPassword);
    if (!success) {
        return ctx.fail ? ctx.fail({ error: 'change_failed' }) : new Response('Password change failed', { status: 400 });
    }
    return ctx.success ? ctx.success({}) : new Response('Password changed', { status: 200 }); 
}

/* -------------------------------------------------------------------------- */
/* Provider Setup (Core Handlers Only)                                        */
/* -------------------------------------------------------------------------- */
const password = PasswordProvider({
  // Using wrapped handlers
  register: handlePasswordRegister,
  login: handlePasswordLogin,
  change: handlePasswordChange,
      sendCode: handlePasswordSendCode,
});

/* -------------------------------------------------------------------------- */
/* Success callback - Simplified (Returns Response)                           */
/* -------------------------------------------------------------------------- */
async function success(ctx: any, value: any): Promise<Response> { 
  console.log("[IssuerSuccess] Flow completed. Provider:", value?.provider, "Value:", value);
  // Return a basic successful response, as required by the signature.
  // The actual redirect logic is intended for the manual Hono routes.
  // Assuming ctx might be a Hono context here? If so, c.res is simpler.
  // If ctx is just the responder object, create a new Response.
  if (ctx && ctx.res) {
      return ctx.res; // Pass through if possible
  }
  return new Response('Issuer Success OK', { status: 200 });
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */
(async () => {
  await loadUsers();

  const storage = MemoryStorage();
  const auth = issuer({ 
    providers: { password }, 
    subjects, 
    storage, 
    success, // Provide the simplified success handler
  });
  const app  = new Hono();

  // --- CORS Middleware --- 
  // Allow requests from your client origins
  app.use('*', cors({ 
      origin: ['http://localhost:3008', 'http://localhost:3009'], // Allow both client ports
      allowMethods: ['GET', 'POST', 'OPTIONS'], // Allow needed methods
      allowHeaders: ['Content-Type', 'Authorization'], // Allow needed headers (adjust if necessary)
      credentials: true, // Allow cookies/credentials if needed later
  }));

  // --- OIDC Discovery Endpoint --- 
  app.get('/.well-known/openid-configuration', (c) => {
      console.log('[OIDC Discovery] Serving configuration');
      return c.json({
          issuer: ISSUER_URL,
          authorization_endpoint: `${ISSUER_URL}/authorize`, // Where client initiates flow
          token_endpoint: `${ISSUER_URL}/token`,           // Where client exchanges code
          jwks_uri: `${ISSUER_URL}/.well-known/jwks.json`, // Location of public keys
          response_types_supported: ["code"],            // We support the Authorization Code flow
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"], // We sign ID tokens with RS256
          // Optional fields you might add later:
          // scopes_supported: ["openid", "profile", "email"],
          // claims_supported: ["sub", "iss", "aud", "exp", "iat" /*, "email" */],
          // userinfo_endpoint: `${ISSUER_URL}/userinfo`, // If you implement a userinfo endpoint
          // end_session_endpoint: `${ISSUER_URL}/logout` // If you implement logout endpoint
      });
  });

  // --- JWKS Endpoint --- 
  app.get('/.well-known/jwks.json', (c) => {
      console.log('[JWKS] Serving JWKS endpoint');
      return c.json({ 
          keys: [
              {
                  ...jwksPublicJWK, // Spread the basic JWK (n, e, kty)
                  kid: keyId,       // Key ID
                  use: 'sig',       // Usage: signature verification
                  alg: 'RS256'      // Algorithm
              }
          ]
      });
  });

  // --- Custom Authorize Interceptor --- 
  app.get('/authorize', async (c, next) => {
      const query = c.req.query();
      const acrValues = query['acr_values'];

      if (acrValues === 'pwd') {
          // Handle password flow manually: Redirect to our custom login page
          console.log('[AuthServer] Intercepting /authorize for password flow (acr_values=pwd). Redirecting to /auth/password/login');
          
          // Forward all original OIDC query parameters
          const loginUrl = new URL('/auth/password/login', ISSUER_URL); 
          Object.keys(query).forEach(key => {
              loginUrl.searchParams.set(key, query[key]);
          });
          
          return c.redirect(loginUrl.toString(), 302);
      } else {
          // For any other flow (or if acr_values is missing), let the issuer handle it.
          console.log('[AuthServer] /authorize request is not for password flow (acr_values != \'pwd\') or acr_values missing. Passing to issuer.');
          // In Hono v3/v4, just calling next() should pass control if the issuer is mounted on '/'
          // However, since issuer is mounted on '/', it might intercept anyway.
          // If this doesn't work, we might need to only mount specific issuer routes, not all of '/'.
          // For now, let's explicitly return and let the issuer handle it via its own routing.
          // A cleaner way would be conditional mounting or more specific routes for the issuer.
          // Let's assume for now the issuer WILL pick it up if we don't handle it.
          await next(); 
          // If next() didn't implicitly fall through to the issuer mounted on '/', 
          // we might get a 404 here if no other route matches.
          if (!c.res.bodyUsed) {
              // If next() didn't result in a response, explicitly indicate not found or pass to a generic handler
              console.warn('[AuthServer] /authorize interceptor: next() called but no response generated. Potential issue with issuer routing.');
              // return c.notFound(); // Or let it fall through if issuer might still catch it
          }
          // No explicit return here, allowing potential fallthrough or next middleware response

      }
  });

  // --- Manual Password Routes --- 
  app.get('/auth/password/register', (c) => {
    const query = c.req.query();
    // Reconstruct query string for links, excluding potentially sensitive params if needed later
    const queryString = Object.entries(query)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    
    const redirect_uri = query['redirect_uri'] || '';
    const state = query['state'] || '';
    const code_challenge = query['code_challenge'] || '';
    const code_challenge_method = query['code_challenge_method'] || 'S256'; // Default to S256
    const client_id = query['client_id'] || CLIENT_ID; 

    return c.html(`
      <h1>Register</h1>
      <form method="post">
        <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
        <input type="hidden" name="state" value="${state || ''}">
        <input type="hidden" name="code_challenge" value="${code_challenge}">
        <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
        <input type="hidden" name="client_id" value="${client_id}">
        
        <div><label>Email: <input name="email" type="email" required></label></div>
        <div><label>Password: <input name="password" type="password" required></label></div>
        <button type="submit">Register</button>
      </form>
      <hr>
      <p>Already have an account? <a href="/auth/password/login?${queryString}">Login</a></p>
    `);
  });

  app.post('/auth/password/register', async (c) => {
    const form = await c.req.formData();
    const email = form.get('email') as string | undefined;
    const password = form.get('password') as string | undefined;
    // Retrieve hidden fields
    const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
    const state = form.get('state') as string | undefined;
    const code_challenge = form.get('code_challenge') as string | undefined;
    const code_challenge_method = form.get('code_challenge_method') as string | undefined;
    const client_id = form.get('client_id') as string | undefined;

    if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
         console.error('[AuthServer] POST Register: Missing form data.');
         return c.text('Missing required form fields.', 400);
    }

    // Call the simple registration handler
    const userResult = await _handlePasswordRegisterSimple(email, password);

    if (userResult) {
        // Registration successful
        const userId = userResult.id;
        const code = uuidv4();
        
        // Decode the redirect URI received from the form TWICE
        let redirect_uri: string;
        try {
            const decoded_once = decodeURIComponent(redirect_uri_from_form);
            redirect_uri = decodeURIComponent(decoded_once); // Decode again
            console.log(`[AuthServer] POST Register: Decoded redirect_uri: ${redirect_uri}`);
        } catch (e) {
            console.error('[AuthServer] POST Register: Failed to double-decode redirect_uri:', redirect_uri_from_form, e);
            return c.text('Invalid redirect URI encoding.', 400);
        }
        
        // Store code details (using the fully decoded URI)
        authCodes.set(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
        
        // Construct redirect URL using the fully decoded URI
        try {
            const redirect = new URL(redirect_uri);
            redirect.searchParams.set('code', code);
            if (state) redirect.searchParams.set('state', state);
            console.log(`[AuthServer] POST Register Success: Redirecting to ${redirect.toString()}`);
            return c.redirect(redirect.toString(), 302);
        } catch (e) {
            console.error('[AuthServer] POST Register: Failed to construct redirect URL with double-decoded URI:', redirect_uri, e);
            return c.text('Invalid redirect URI provided.', 500);
        }
    } else {
        // Registration failed (likely email taken)
        console.warn(`[AuthServer] POST Register Failed for email: ${email} (Email likely taken)`);
        // Re-render registration form with error message
        const redirect_uri_encoded = encodeURIComponent(redirect_uri_from_form); // Re-encode for HTML value
        const query = { redirect_uri: redirect_uri_encoded, state, code_challenge, code_challenge_method, client_id };
        const queryString = Object.entries(query)
            .filter(([_, value]) => value != null) // Ensure values are not null/undefined before encoding
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
            .join('&');
            
        return c.html(`
            <h1>Register</h1>
            <p style="color:red;">Registration failed. That email might already be taken.</p>
            <form method="post">
                 <input type="hidden" name="redirect_uri" value="${redirect_uri_encoded}">
                 <input type="hidden" name="state" value="${state || ''}">
                 <input type="hidden" name="code_challenge" value="${code_challenge}">
                 <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                 <input type="hidden" name="client_id" value="${client_id}">
                 <div><label>Email: <input name="email" type="email" value="${email || ''}" required></label></div>
                 <div><label>Password: <input name="password" type="password" required></label></div>
                 <button type="submit">Register</button>
            </form>
            <hr>
            <p>Already have an account? <a href="/auth/password/login?${queryString}">Login</a></p>
        `);
    }
  });

  app.get('/auth/password/login', (c) => {
    const query = c.req.query();
    const queryString = Object.entries(query)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
        
    const redirect_uri = query['redirect_uri'] || '';
    const state = query['state'] || '';
    const code_challenge = query['code_challenge'] || '';
    const code_challenge_method = query['code_challenge_method'] || 'S256';
    const client_id = query['client_id'] || CLIENT_ID;

    return c.html(`
      <h1>Login</h1>
      <form method="post">
         <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
        <input type="hidden" name="state" value="${state || ''}">
        <input type="hidden" name="code_challenge" value="${code_challenge}">
        <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
         <input type="hidden" name="client_id" value="${client_id}">

        <div><label>Email: <input name="email" type="email" required></label></div>
        <div><label>Password: <input name="password" type="password" required></label></div>
        <button type="submit">Login</button>
      </form>
      <hr>
      <p>Don't have an account? <a href="/auth/password/register?${queryString}">Register</a></p>
    `);
  });
  
  app.post('/auth/password/login', async (c) => {
      const form = await c.req.formData();
      const email = form.get('email') as string | undefined;
      const password = form.get('password') as string | undefined;
      // Retrieve hidden fields
      const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
      const state = form.get('state') as string | undefined;
      const code_challenge = form.get('code_challenge') as string | undefined;
      const code_challenge_method = form.get('code_challenge_method') as string | undefined;
      const client_id = form.get('client_id') as string | undefined;

      if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
           console.error('[AuthServer] POST Login: Missing form data.');
           // TODO: Re-render form with error and hidden fields
           return c.text('Missing required form fields.', 400);
      }

      const userResult = await _handlePasswordLoginSimple(email, password);

      if (userResult) {
          // Login successful
          const userId = userResult.id;
          const code = uuidv4();
          
          // Decode the redirect URI received from the form TWICE
          let redirect_uri: string;
          try {
              const decoded_once = decodeURIComponent(redirect_uri_from_form);
              redirect_uri = decodeURIComponent(decoded_once); // Decode again
              console.log(`[AuthServer] POST Login: Decoded redirect_uri: ${redirect_uri}`);
          } catch (e) {
              console.error('[AuthServer] POST Login: Failed to double-decode redirect_uri:', redirect_uri_from_form, e);
              return c.text('Invalid redirect URI encoding.', 400);
          }
          
          // Store code details (using the fully decoded URI)
          authCodes.set(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
          
          // Construct redirect URL using the fully decoded URI
          try {
              const redirect = new URL(redirect_uri);
              redirect.searchParams.set('code', code);
              if (state) redirect.searchParams.set('state', state);
              console.log(`[AuthServer] POST Login Success: Redirecting to ${redirect.toString()}`);
              return c.redirect(redirect.toString(), 302);
          } catch (e) {
              console.error('[AuthServer] POST Login: Failed to construct redirect URL with double-decoded URI:', redirect_uri, e);
              return c.text('Invalid redirect URI provided.', 500);
          }
      } else {
          // Login failed
          console.warn(`[AuthServer] POST Login Failed for email: ${email}`);
          // Re-render login form with error message
          // Pass the original encoded value back to the hidden field
          const query = { redirect_uri: redirect_uri_from_form, state, code_challenge, code_challenge_method, client_id };
          const queryString = Object.entries(query)
              .filter(([_, value]) => value != null) // Ensure values are not null/undefined before encoding
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
              .join('&');
              
          return c.html(`
              <h1>Login</h1>
              <p style="color:red;">Invalid email or password.</p>
              <form method="post">
                  <input type="hidden" name="redirect_uri" value="${redirect_uri_from_form}">
                  <input type="hidden" name="state" value="${state || ''}">
                  <input type="hidden" name="code_challenge" value="${code_challenge}">
                  <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                  <input type="hidden" name="client_id" value="${client_id}">
                  <div><label>Email: <input name="email" type="email" value="${email || ''}" required></label></div>
                  <div><label>Password: <input name="password" type="password" required></label></div>
                  <button type="submit">Login</button>
              </form>
          `);
      }
  });
  // --- End Manual Password Routes --- 

  // Token endpoint - Updated for PKCE & RS256 signing
  app.post('/token', async c => {
    const form = await c.req.formData();
    const grantType = form.get('grant_type');
    const code = form.get('code');
    const redirectUriForm = form.get('redirect_uri');
    const clientIdForm = form.get('client_id');
    const codeVerifier = form.get('code_verifier'); // PKCE verifier

    if (grantType !== 'authorization_code' || typeof code !== 'string' || typeof codeVerifier !== 'string' || typeof clientIdForm !== 'string') {
        return c.text('invalid_request', 400);
    }

    const codeData = authCodes.get(code);
    if (!codeData) {
        console.error(`[AuthServer] /token: Code ${code} not found.`);
        return c.text('invalid_grant', 400); 
    }

    // === PKCE Verification ===
    let calculatedChallenge: string;
    if (codeData.codeChallengeMethod === 'S256') {
        // Verify S256 challenge
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        calculatedChallenge = Buffer.from(hash).toString('base64url');
    } else {
        // Verify plain challenge (or handle error if only S256 supported)
        calculatedChallenge = codeVerifier;
        if(codeData.codeChallengeMethod !== 'plain') {
             console.error(`[AuthServer] /token: Unsupported code_challenge_method: ${codeData.codeChallengeMethod}`);
             return c.text('invalid_request', 400); 
        }
    }

    if (calculatedChallenge !== codeData.codeChallenge) {
        console.error(`[AuthServer] /token: PKCE verification failed. Expected ${codeData.codeChallenge}, got ${calculatedChallenge}`);
        authCodes.delete(code); // Consume code even on failure
        return c.text('invalid_grant', 400); 
    }
    // === End PKCE Verification ===

    // Optional: Verify client_id and redirect_uri match stored values
    if (clientIdForm !== codeData.clientId /* || redirectUriForm !== codeData.redirectUri */) {
         console.error(`[AuthServer] /token: Client ID mismatch.`);
         authCodes.delete(code);
         return c.text('invalid_grant', 400); 
    }

    // PKCE verified, grant is valid
    const userId = codeData.userId;
    authCodes.delete(code); // Consume the code

    console.log('[Token Endpoint] Code verified. Generating JWT...');
    // Generate ID Token (JWT)
    const payload = {
        iss: ISSUER_URL,         // Issuer
        sub: userId,             // Subject (unique user ID)
        aud: clientIdForm,       // Audience (client ID)
        // exp is handled by expiresIn option below
        iat: Math.floor(Date.now() / 1000), // Issued at
        // nonce: ??? // If nonce was provided in auth request, should include here
    };

    const signOptions: jwt.SignOptions = {
        algorithm: 'RS256',
        expiresIn: '4h', // Set expiration to 4 hours
        keyid: keyId,    // Include key ID
        audience: clientIdForm, // Redundant but ensures aud claim is set
        issuer: ISSUER_URL,     // Redundant but ensures iss claim is set
        subject: userId        // Redundant but ensures sub claim is set
    };

    // Sign the ID token
    const idToken = jwt.sign(payload, privateKey, signOptions);

    // For OpenID Connect, usually the id_token is sufficient. 
    // If you need a separate access_token (e.g., for resource servers), 
    // you might generate it here with a different payload/scope/expiration.
    // For simplicity, we'll return the id_token as the access_token too.
    const accessToken = idToken; 

    // Calculate expires_in in seconds for the response
    const expiresInSeconds = 4 * 60 * 60;

    // Return the tokens
    return c.json({
        access_token: accessToken, 
        id_token: idToken, 
        token_type: 'Bearer', 
        expires_in: expiresInSeconds 
    });
  });

  // Mount the OpenAuth issuer routes AFTER your manual routes AND the interceptor
  // Note: Mounting on '/' might still cause conflicts if the issuer internally registers /authorize.
  app.route('/', auth);
  app.get('/health', c => c.text('OK'));

  console.log(`🚀 Auth server → ${ISSUER_URL}`);
  serve({ fetch: app.fetch, port: PORT });
})();
