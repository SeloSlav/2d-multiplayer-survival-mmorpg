// index.ts - Updated for production deployment
/**
 * OpenAuth issuer + Hono server with password UI and custom OIDC code/token flow.
 * Now using database storage and environment-based JWT keys.
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
import jwt from 'jsonwebtoken';
import { Buffer } from 'buffer'; // Needed for PKCE base64
import crypto from 'crypto'; // Needed for PKCE hash
import { cors } from 'hono/cors';
// Import our new modules
import { db, type UserRecord, type AuthCodeData } from './database.js';
import { initializeKeys, getPrivateKey, getPublicJWK, keyId } from './jwt-keys.js';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */
const PORT        = Number(process.env.PORT) || 4001;
const ISSUER_URL  = process.env.ISSUER_URL || 'https://broth-and-bullets-production.up.railway.app';
const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
const CLIENT_ID   = 'vibe-survival-game-client';

/* -------------------------------------------------------------------------- */
/* Core Password Logic Handlers (Updated for database)                       */
/* -------------------------------------------------------------------------- */

async function _handlePasswordRegisterSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  email = email.toLowerCase();
  const existing = await db.getUserByEmail(email);
  if (existing) {
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
  const success = await db.createUser(newUser);
  if (!success) {
    console.warn(`[RegisterHandler] Failed to create user: ${email}`);
    return null;
  }
  console.info(`[RegisterHandler] New user registered: ${email} -> ${userId}`);
  return { id: userId, email };
}

async function _handlePasswordLoginSimple(email: string, password?: string): Promise<{ id: string; email: string } | null> {
  email = email.toLowerCase();
  const user = await db.getUserByEmail(email);
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
  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const success = await db.updateUserPassword(userId, newPasswordHash);
  if (success) {
    console.info(`[ChangeHandler] Password changed for userId: ${userId}`);
  }
  return success;
}

// Placeholder sendCode function
async function handlePasswordSendCode(email: string, code: string): Promise<void> { 
  console.info(`[SendCodeHandler] Code for ${email}: ${code} (Manual Flow)`);
}

/* -------------------------------------------------------------------------- */
/* Provider Handler Wrappers (Match expected signatures)                      */
/* -------------------------------------------------------------------------- */

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
    const userId = state?.userId;
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
/* Provider Setup                                                             */
/* -------------------------------------------------------------------------- */
const password = PasswordProvider({
  register: handlePasswordRegister,
  login: handlePasswordLogin,
  change: handlePasswordChange,
  sendCode: handlePasswordSendCode,
});

/* -------------------------------------------------------------------------- */
/* Success callback                                                           */
/* -------------------------------------------------------------------------- */
async function success(ctx: any, value: any): Promise<Response> { 
  console.log("[IssuerSuccess] Flow completed. Provider:", value?.provider, "Value:", value);
  if (ctx && ctx.res) {
      return ctx.res;
  }
  return new Response('Issuer Success OK', { status: 200 });
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */
(async () => {
  // Initialize database and keys
  await db.init();
  await initializeKeys();

  const storage = MemoryStorage();
  const auth = issuer({ 
    providers: { password }, 
    subjects, 
    storage, 
    success,
  });
  const app  = new Hono();

  // --- CORS Middleware --- 
  app.use('*', cors({ 
      origin: ['http://localhost:3008', 'http://localhost:3009'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
  }));

  // --- OIDC Discovery Endpoint --- 
  app.get('/.well-known/openid-configuration', (c) => {
      console.log('[OIDC Discovery] Serving configuration');
      return c.json({
          issuer: ISSUER_URL,
          authorization_endpoint: `${ISSUER_URL}/authorize`,
          token_endpoint: `${ISSUER_URL}/token`,
          jwks_uri: `${ISSUER_URL}/.well-known/jwks.json`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
      });
  });

  // --- JWKS Endpoint --- 
  app.get('/.well-known/jwks.json', (c) => {
      console.log('[JWKS] Serving JWKS endpoint');
      const publicJWK = getPublicJWK();
      return c.json({ 
          keys: [
              {
                  ...publicJWK,
                  kid: keyId,
                  use: 'sig',
                  alg: 'RS256'
              }
          ]
      });
  });

  // --- Custom Authorize Interceptor --- 
  app.get('/authorize', async (c, next) => {
      const query = c.req.query();
      const acrValues = query['acr_values'];

      if (acrValues === 'pwd') {
          console.log('[AuthServer] Intercepting /authorize for password flow (acr_values=pwd). Redirecting to /auth/password/login');
          
          const loginUrl = new URL('/auth/password/login', ISSUER_URL); 
          Object.keys(query).forEach(key => {
              loginUrl.searchParams.set(key, query[key]);
          });
          
          return c.redirect(loginUrl.toString(), 302);
      } else {
          console.log('[AuthServer] /authorize request is not for password flow (acr_values != \'pwd\') or acr_values missing. Passing to issuer.');
          await next(); 
          if (!c.res.bodyUsed) {
              console.warn('[AuthServer] /authorize interceptor: next() called but no response generated. Potential issue with issuer routing.');
          }
      }
  });

  // --- Manual Password Routes --- 
  app.get('/auth/password/register', (c) => {
    const query = c.req.query();
    const queryString = Object.entries(query)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    
    const redirect_uri = query['redirect_uri'] || '';
    const state = query['state'] || '';
    const code_challenge = query['code_challenge'] || '';
    const code_challenge_method = query['code_challenge_method'] || 'S256';
    const client_id = query['client_id'] || CLIENT_ID; 

    const githubLogoPlaceholder = 'Vibe Survival';

    return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Register</title>
        <style>
            body {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                width: 100%;
                margin: 0;
                background-color: #1a1a2e;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                color: white;
            }
            .container {
                background-color: rgba(40, 40, 60, 0.85);
                padding: 40px;
                border-radius: 4px;
                border: 1px solid #a0a0c0;
                box-shadow: 2px 2px 0px rgba(0,0,0,0.5);
                text-align: center;
                min-width: 400px;
                max-width: 500px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            }
            .logo-text {
                font-size: 24px;
                margin-bottom: 10px;
                color: #e0e0e0;
            }
            .subtitle {
                font-size: 14px;
                margin-bottom: 30px;
                color: #b0b0c0;
            }
            h1 {
                margin-bottom: 25px;
                font-weight: normal;
                font-size: 20px;
            }
            label {
                display: block;
                margin-bottom: 8px;
                font-size: 12px;
                text-align: left;
                color: #d0d0d0;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
            }
            input[type="email"], input[type="password"] {
                padding: 10px;
                margin-bottom: 20px;
                border: 1px solid #a0a0c0;
                background-color: #333;
                color: white;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                font-size: 14px;
                display: block;
                width: calc(100% - 22px);
                text-align: center;
                box-sizing: border-box;
                border-radius: 2px;
            }
            button[type="submit"] {
                padding: 12px 20px;
                border: 1px solid #a0a0c0;
                background-color: #777;
                color: white;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                font-size: 14px;
                cursor: pointer;
                box-shadow: 2px 2px 0px rgba(0,0,0,0.5);
                display: inline-block;
                box-sizing: border-box;
                margin-bottom: 20px;
                text-transform: uppercase;
                border-radius: 2px;
            }
            button[type="submit"]:hover {
                background-color: #888;
            }
            .form-link {
                font-size: 12px;
                color: #ccc;
            }
            .form-link a {
                color: #fff;
                text-decoration: underline;
            }
            .form-link a:hover {
                color: #a0a0c0;
            }
            hr {
                border: none;
                border-top: 1px solid #555;
                margin-top: 25px;
                margin-bottom: 25px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo-text">${githubLogoPlaceholder}</div>
            <div class="subtitle">2D Multiplayer Survival</div>
            <h1>Create Account</h1>
            <form method="post">
                <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
                <input type="hidden" name="state" value="${state || ''}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                <input type="hidden" name="client_id" value="${client_id}">
                <div>
                    <label for="email">Email:</label>
                    <input id="email" name="email" type="email" autocomplete="email" required>
                </div>
                <div>
                    <label for="password">Password:</label>
                    <input id="password" name="password" type="password" autocomplete="new-password" required>
                </div>
                <button type="submit">Register</button>
            </form>
            <hr>
            <p class="form-link">Already have an account? <a href="/auth/password/login?${queryString}">Login</a></p>
        </div>
    </body>
    </html>
    `);
  });

  app.post('/auth/password/register', async (c) => {
    const form = await c.req.formData();
    const email = form.get('email') as string | undefined;
    const password = form.get('password') as string | undefined;
    const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
    const state = form.get('state') as string | undefined;
    const code_challenge = form.get('code_challenge') as string | undefined;
    const code_challenge_method = form.get('code_challenge_method') as string | undefined;
    const client_id = form.get('client_id') as string | undefined;

    if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
         console.error('[AuthServer] POST Register: Missing form data.');
         return c.text('Missing required form fields.', 400);
    }

    const userResult = await _handlePasswordRegisterSimple(email, password);

    if (userResult) {
        const userId = userResult.id;
        const code = uuidv4();
        let redirect_uri: string;
        try {
            const decoded_once = decodeURIComponent(redirect_uri_from_form);
            redirect_uri = decodeURIComponent(decoded_once);
            console.log(`[AuthServer] POST Register: Decoded redirect_uri: ${redirect_uri}`);
        } catch (e) {
            console.error('[AuthServer] POST Register: Failed to double-decode redirect_uri:', redirect_uri_from_form, e);
            return c.text('Invalid redirect URI encoding.', 400);
        }
        await db.storeAuthCode(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
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
        console.warn(`[AuthServer] POST Register Failed for email: ${email} (Email likely taken)`);
        // Return error page with form
        return c.html(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Register</title>
            <style>/* Same styles as GET */</style>
        </head>
        <body>
            <div class="container">
                <div class="logo-text">Vibe Survival</div>
                <div class="subtitle">2D Multiplayer Survival</div>
                <h1>Create Account</h1>
                <p style="color: red; margin-bottom: 15px;">Registration failed. That email might already be taken.</p>
                <form method="post">
                     <input type="hidden" name="redirect_uri" value="${redirect_uri_from_form}">
                     <input type="hidden" name="state" value="${state || ''}">
                     <input type="hidden" name="code_challenge" value="${code_challenge}">
                     <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                     <input type="hidden" name="client_id" value="${client_id}">
                     <div><label for="email">Email:</label><input id="email" name="email" type="email" value="${email || ''}" required></div>
                     <div><label for="password">Password:</label><input id="password" name="password" type="password" required></div>
                     <button type="submit">Register</button>
                </form>
            </div>
        </body>
        </html>
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
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login</title>
        <style>
            body {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                width: 100%;
                margin: 0;
                background-color: #1a1a2e;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                color: white;
            }
            .container {
                background-color: rgba(40, 40, 60, 0.85);
                padding: 40px;
                border-radius: 4px;
                border: 1px solid #a0a0c0;
                box-shadow: 2px 2px 0px rgba(0,0,0,0.5);
                text-align: center;
                min-width: 400px;
                max-width: 500px;
            }
            .logo-text {
                font-size: 24px;
                margin-bottom: 10px;
                color: #e0e0e0;
            }
            .subtitle {
                font-size: 14px;
                margin-bottom: 30px;
                color: #b0b0c0;
            }
            h1 {
                margin-bottom: 25px;
                font-weight: normal;
                font-size: 20px;
            }
            label {
                display: block;
                margin-bottom: 8px;
                font-size: 12px;
                text-align: left;
                color: #d0d0d0;
            }
            input[type="email"], input[type="password"] {
                padding: 10px;
                margin-bottom: 20px;
                border: 1px solid #a0a0c0;
                background-color: #333;
                color: white;
                font-size: 14px;
                display: block;
                width: calc(100% - 22px);
                text-align: center;
                box-sizing: border-box;
                border-radius: 2px;
            }
            button[type="submit"] {
                padding: 12px 20px;
                border: 1px solid #a0a0c0;
                background-color: #777;
                color: white;
                font-size: 14px;
                cursor: pointer;
                box-shadow: 2px 2px 0px rgba(0,0,0,0.5);
                display: inline-block;
                box-sizing: border-box;
                margin-bottom: 20px;
                text-transform: uppercase;
                border-radius: 2px;
            }
            button[type="submit"]:hover {
                background-color: #888;
            }
            .form-link {
                font-size: 12px;
                color: #ccc;
            }
            .form-link a {
                color: #fff;
                text-decoration: underline;
            }
            .form-link a:hover {
                color: #a0a0c0;
            }
            hr {
                border: none;
                border-top: 1px solid #555;
                margin-top: 25px;
                margin-bottom: 25px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo-text">Vibe Survival</div>
            <div class="subtitle">2D Multiplayer Survival</div>
            <h1>Login</h1>
            <form method="post">
                <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
                <input type="hidden" name="state" value="${state || ''}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                <input type="hidden" name="client_id" value="${client_id}">
                <div>
                    <label for="email">Email:</label>
                    <input id="email" name="email" type="email" autocomplete="email" required>
                </div>
                <div>
                    <label for="password">Password:</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required>
                </div>
                <button type="submit">Login</button>
            </form>
            <hr>
            <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Register</a></p>
        </div>
    </body>
    </html>
    `);
  });
  
  app.post('/auth/password/login', async (c) => {
      const form = await c.req.formData();
      const email = form.get('email') as string | undefined;
      const password = form.get('password') as string | undefined;
      const redirect_uri_from_form = form.get('redirect_uri') as string | undefined;
      const state = form.get('state') as string | undefined;
      const code_challenge = form.get('code_challenge') as string | undefined;
      const code_challenge_method = form.get('code_challenge_method') as string | undefined;
      const client_id = form.get('client_id') as string | undefined;

      if (!email || !password || !redirect_uri_from_form || !code_challenge || !code_challenge_method || !client_id) {
           console.error('[AuthServer] POST Login: Missing form data.');
           return c.text('Missing required form fields.', 400);
      }

      const userResult = await _handlePasswordLoginSimple(email, password);

      if (userResult) {
          const userId = userResult.id;
          const code = uuidv4();
          let redirect_uri: string;
          try {
              const decoded_once = decodeURIComponent(redirect_uri_from_form);
              redirect_uri = decodeURIComponent(decoded_once);
              console.log(`[AuthServer] POST Login: Decoded redirect_uri: ${redirect_uri}`);
          } catch (e) {
              console.error('[AuthServer] POST Login: Failed to double-decode redirect_uri:', redirect_uri_from_form, e);
              return c.text('Invalid redirect URI encoding.', 400);
          }
          await db.storeAuthCode(code, { userId, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method, clientId: client_id, redirectUri: redirect_uri });
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
          console.warn(`[AuthServer] POST Login Failed for email: ${email}`);
          const query = { redirect_uri: redirect_uri_from_form, state, code_challenge, code_challenge_method, client_id };
          const queryString = Object.entries(query)
              .filter(([_, value]) => value != null)
              .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
              .join('&');
              
          return c.html(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Login</title>
                <style>
                    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; width: 100%; margin: 0; background-color: #1a1a2e; font-family: system-ui; color: white; }
                    .container { background-color: rgba(40, 40, 60, 0.85); padding: 40px; border-radius: 4px; border: 1px solid #a0a0c0; box-shadow: 2px 2px 0px rgba(0,0,0,0.5); text-align: center; min-width: 400px; max-width: 500px; }
                    .logo-text { font-size: 24px; margin-bottom: 10px; color: #e0e0e0; }
                    .subtitle { font-size: 14px; margin-bottom: 30px; color: #b0b0c0; }
                    h1 { margin-bottom: 25px; font-weight: normal; font-size: 20px; }
                    .error-message { color: red; margin-bottom: 15px; font-size: 12px; padding: 8px; background-color: rgba(255,0,0,0.1); border-radius: 4px; }
                    label { display: block; margin-bottom: 8px; font-size: 12px; text-align: left; color: #d0d0d0; }
                    input[type="email"], input[type="password"] { padding: 10px; margin-bottom: 20px; border: 1px solid #a0a0c0; background-color: #333; color: white; font-size: 14px; display: block; width: calc(100% - 22px); text-align: center; box-sizing: border-box; border-radius: 2px; }
                    button[type="submit"] { padding: 12px 20px; border: 1px solid #a0a0c0; background-color: #777; color: white; font-size: 14px; cursor: pointer; box-shadow: 2px 2px 0px rgba(0,0,0,0.5); display: inline-block; box-sizing: border-box; margin-bottom: 20px; text-transform: uppercase; border-radius: 2px; }
                    button[type="submit"]:hover { background-color: #888; }
                    .form-link { font-size: 12px; color: #ccc; }
                    .form-link a { color: #fff; text-decoration: underline; }
                    .form-link a:hover { color: #a0a0c0; }
                    hr { border: none; border-top: 1px solid #555; margin-top: 25px; margin-bottom: 25px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="logo-text">Vibe Survival</div>
                    <div class="subtitle">2D Multiplayer Survival</div>
                    <h1>Login</h1>
                    <p class="error-message">Invalid email or password.</p>
                    <form method="post">
                        <input type="hidden" name="redirect_uri" value="${redirect_uri_from_form}">
                        <input type="hidden" name="state" value="${state || ''}">
                        <input type="hidden" name="code_challenge" value="${code_challenge}">
                        <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                        <input type="hidden" name="client_id" value="${client_id}">
                        <div><label for="email">Email:</label><input id="email" name="email" type="email" value="${email || ''}" required></div>
                        <div><label for="password">Password:</label><input id="password" name="password" type="password" required></div>
                        <button type="submit">Login</button>
                    </form>
                    <hr>
                    <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Register</a></p>
                </div>
            </body>
            </html>
          `);
      }
  });

  // Token endpoint - Updated for environment keys
  app.post('/token', async c => {
    const form = await c.req.formData();
    const grantType = form.get('grant_type');
    const code = form.get('code');
    const redirectUriForm = form.get('redirect_uri');
    const clientIdForm = form.get('client_id');
    const codeVerifier = form.get('code_verifier');

    if (grantType !== 'authorization_code' || typeof code !== 'string' || typeof codeVerifier !== 'string' || typeof clientIdForm !== 'string') {
        return c.text('invalid_request', 400);
    }

    const codeData = await db.getAuthCode(code);
    if (!codeData) {
        console.error(`[AuthServer] /token: Code ${code} not found.`);
        return c.text('invalid_grant', 400); 
    }

    // PKCE Verification
    let calculatedChallenge: string;
    if (codeData.codeChallengeMethod === 'S256') {
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        calculatedChallenge = Buffer.from(hash).toString('base64url');
    } else {
        calculatedChallenge = codeVerifier;
        if(codeData.codeChallengeMethod !== 'plain') {
             console.error(`[AuthServer] /token: Unsupported code_challenge_method: ${codeData.codeChallengeMethod}`);
             return c.text('invalid_request', 400); 
        }
    }

    if (calculatedChallenge !== codeData.codeChallenge) {
        console.error(`[AuthServer] /token: PKCE verification failed. Expected ${codeData.codeChallenge}, got ${calculatedChallenge}`);
        await db.deleteAuthCode(code);
        return c.text('invalid_grant', 400); 
    }

    if (clientIdForm !== codeData.clientId) {
         console.error(`[AuthServer] /token: Client ID mismatch.`);
         await db.deleteAuthCode(code);
         return c.text('invalid_grant', 400); 
    }

    const userId = codeData.userId;
    await db.deleteAuthCode(code);

    console.log('[Token Endpoint] Code verified. Generating JWT...');
    
    const payload = {
        iss: ISSUER_URL,
        sub: userId,
        aud: clientIdForm,
        iat: Math.floor(Date.now() / 1000),
    };

    const signOptions: jwt.SignOptions = {
        algorithm: 'RS256',
        expiresIn: '4h',
        keyid: keyId,
    };

    const privateKey = getPrivateKey();
    const idToken = jwt.sign(payload, privateKey, signOptions);
    const accessToken = idToken; 

    const expiresInSeconds = 4 * 60 * 60;

    return c.json({
        access_token: accessToken, 
        id_token: idToken, 
        token_type: 'Bearer', 
        expires_in: expiresInSeconds 
    });
  });

  // Mount the OpenAuth issuer routes
  app.route('/', auth);
  app.get('/health', c => c.text('OK'));

  console.log(`🚀 Auth server → ${ISSUER_URL}`);
  serve({ fetch: app.fetch, port: PORT });
})(); 