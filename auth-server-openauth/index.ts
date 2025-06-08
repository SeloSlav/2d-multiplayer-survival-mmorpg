// index.ts - Updated for production deployment
/**
 * OpenAuth issuer + Hono server with password UI and custom OIDC code/token flow.
 * Now using database storage and environment-based JWT keys.
 */
import dotenv from 'dotenv';

// Load environment variables from .env file in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Environment-based configuration
const config = {
  isDevelopment: process.env.NODE_ENV !== 'production',
  port: parseInt(process.env.PORT || '4001'),
  issuerUrl: process.env.ISSUER_URL || (process.env.NODE_ENV === 'production' 
    ? 'https://broth-and-bullets-production.up.railway.app' 
    : 'http://localhost:4001'),
  databaseUrl: process.env.DATABASE_URL,
  jwtPrivateKey: process.env.JWT_PRIVATE_KEY,
  jwtPublicKey: process.env.JWT_PUBLIC_KEY,
  saltRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
};

console.log(`[Config] Environment: ${config.isDevelopment ? 'development' : 'production'}`);
console.log(`[Config] Port: ${config.port}`);
console.log(`[Config] Issuer URL: ${config.issuerUrl}`);
console.log(`[Config] Database: ${config.databaseUrl ? 'PostgreSQL' : 'In-memory'}`);

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
import fs from 'fs';
import path from 'path';
// Import our new modules
import { db, type UserRecord, type AuthCodeData } from './database.js';
import { initializeKeys, getPrivateKey, getPublicJWK, keyId } from './jwt-keys.js';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */
const PORT        = config.port;
const ISSUER_URL  = config.issuerUrl;
const SALT_ROUNDS = config.saltRounds;
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

  // --- Static File Serving for logo.png ---
  app.get('/logo.png', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'logo.png');
      const imageBuffer = fs.readFileSync(imagePath);
      return new Response(imageBuffer, { headers: { 'Content-Type': 'image/png' } });
    } catch (error) {
      console.error('[Static] Failed to serve logo.png:', error);
      return new Response('Image not found', { status: 404 });
    }
  });

  app.get('/auth/password/logo.png', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'logo.png');
      const imageBuffer = fs.readFileSync(imagePath);
      return new Response(imageBuffer, { headers: { 'Content-Type': 'image/png' } });
    } catch (error) {
      console.error('[Static] Failed to serve logo.png:', error);
      return new Response('Image not found', { status: 404 });
    }
  });

  // --- Static File Serving for login_background.png ---
  app.get('/login_background.png', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'login_background.png');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/png');
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(imageBuffer);
    } catch (error) {
      console.error('[Static] Failed to serve login_background.png:', error);
      return c.text('Image not found', 404);
    }
  });

  // --- Also serve at the wrong path to fix current issue ---
  app.get('/auth/password/login_background.png', async (c) => {
    try {
      const imagePath = path.join(process.cwd(), 'login_background.png');
      const imageBuffer = fs.readFileSync(imagePath);
      c.header('Content-Type', 'image/png');
      c.header('Cache-Control', 'public, max-age=3600');
      return c.body(imageBuffer);
    } catch (error) {
      console.error('[Static] Failed to serve login_background.png:', error);
      return c.text('Image not found', 404);
    }
  });

  // --- CORS Middleware --- 
  app.use('*', cors({ 
      origin: [
          'http://localhost:3008', 
          'http://localhost:3009',

          'https://brothandbullets.com',
          'https://www.brothandbullets.com',
          'https://broth-and-bullets-production-client-production.up.railway.app'
      ],
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

    return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Create Account - Broth & Bullets</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                min-height: 100vh;
                width: 100%;
                background-image: url('login_background.png');
                background-size: cover;
                background-position: top center;
                background-repeat: no-repeat;
                background-attachment: fixed;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                color: white;
                display: flex;
                justify-content: center;
                align-items: center;
                position: relative;
                overflow-x: hidden;
            }
            
            .container {
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(12px);
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 16px;
                padding: 60px 40px;
                width: 90%;
                max-width: 450px;
                position: relative;
                z-index: 2;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
                text-align: center;
            }
            
            .game-title {
                height: 90px;
                margin-bottom: 20px;
                object-fit: contain;
                filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.8));
            }
            
            .game-subtitle {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
                margin-bottom: 40px;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                font-weight: 400;
                letter-spacing: 2px;
                text-transform: uppercase;
            }
            
            .form-title {
                font-size: 24px;
                font-weight: 600;
                color: white;
                margin-bottom: 30px;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            }
            
            .form-group {
                margin-bottom: 25px;
                text-align: left;
            }
            
            label {
                display: block;
                margin-bottom: 8px;
                font-size: 13px;
                color: rgba(255, 255, 255, 0.9);
                font-weight: 500;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                letter-spacing: 0.5px;
            }
            
            input[type="email"], 
            input[type="password"] {
                width: 100%;
                padding: 16px 20px;
                background: rgba(255, 255, 255, 0.1);
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 12px;
                color: white;
                font-size: 16px;
                font-family: inherit;
                backdrop-filter: blur(8px);
                transition: all 0.3s ease;
                box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
            }
            
            input[type="email"]:focus, 
            input[type="password"]:focus {
                outline: none;
                border-color: #ff8c00;
                background: rgba(255, 255, 255, 0.15);
                box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(255, 140, 0, 0.2);
            }
            
            input[type="email"]::placeholder,
            input[type="password"]::placeholder {
                color: rgba(255, 255, 255, 0.5);
            }
            
            .submit-button {
                width: 100%;
                padding: 18px 20px;
                background: linear-gradient(135deg, #ff8c00 0%, #e67700 100%);
                border: none;
                border-radius: 12px;
                color: white;
                font-size: 16px;
                font-weight: 600;
                font-family: inherit;
                cursor: pointer;
                transition: all 0.3s ease;
                margin-bottom: 30px;
                box-shadow: 0 4px 15px rgba(255, 140, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            .submit-button:hover {
                background: linear-gradient(135deg, #ffaa33 0%, #ff8c00 100%);
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(255, 140, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
            }
            
            .submit-button:active {
                transform: translateY(0);
                box-shadow: 0 2px 8px rgba(255, 140, 0, 0.3);
            }
            
            .divider {
                height: 1px;
                background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%);
                margin: 30px 0;
            }
            
            .form-link {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
                line-height: 1.6;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            }
            
            .form-link a {
                color: #ff8c00;
                text-decoration: none;
                font-weight: 500;
                transition: color 0.3s ease;
            }
            
            .form-link a:hover {
                color: #ffaa33;
                text-decoration: underline;
            }
            
            .error-message {
                background: rgba(220, 53, 69, 0.15);
                border: 1px solid rgba(220, 53, 69, 0.4);
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 20px;
                font-size: 14px;
                color: #ff6b6b;
                backdrop-filter: blur(8px);
                text-shadow: none;
            }
            
            @media (max-width: 480px) {
                .container {
                    padding: 40px 30px;
                    margin: 20px;
                }
                
                .game-title {
                    height: 60px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="game-title">
                <img src="logo.png" alt="Broth & Bullets Logo" style="height: 100%; width: auto;">
            </div>
            <div class="game-subtitle">2D Multiplayer Survival</div>
            
            <h1 class="form-title">Create Account</h1>
            
            <form method="post">
                <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
                <input type="hidden" name="state" value="${state || ''}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                <input type="hidden" name="client_id" value="${client_id}">
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="new-password" required placeholder="Create a password">
                </div>
                
                <button type="submit" class="submit-button">Create Account</button>
            </form>
            
            <div class="divider"></div>
            
            <p class="form-link">Already have an account? <a href="/auth/password/login?${queryString}">Sign In</a></p>
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
        <title>Sign In - Broth & Bullets</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                min-height: 100vh;
                width: 100%;
                background-image: url('login_background.png');
                background-size: cover;
                background-position: top center;
                background-repeat: no-repeat;
                background-attachment: fixed;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                color: white;
                display: flex;
                justify-content: center;
                align-items: center;
                position: relative;
                overflow-x: hidden;
            }
            
            .container {
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(12px);
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 16px;
                padding: 60px 40px;
                width: 90%;
                max-width: 450px;
                position: relative;
                z-index: 2;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
                text-align: center;
            }
            
            .game-title {
                height: 90px;
                margin-bottom: 20px;
                object-fit: contain;
                filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.8));
            }
            
            .game-subtitle {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
                margin-bottom: 40px;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                font-weight: 400;
                letter-spacing: 2px;
                text-transform: uppercase;
            }
            
            .form-title {
                font-size: 24px;
                font-weight: 600;
                color: white;
                margin-bottom: 20px;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            }
            
            .error-message {
                background: rgba(220, 53, 69, 0.15);
                border: 1px solid rgba(220, 53, 69, 0.4);
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 25px;
                font-size: 14px;
                color: #ff6b6b;
                backdrop-filter: blur(8px);
                text-shadow: none;
            }
            
            .form-group {
                margin-bottom: 25px;
                text-align: left;
            }
            
            label {
                display: block;
                margin-bottom: 8px;
                font-size: 13px;
                color: rgba(255, 255, 255, 0.9);
                font-weight: 500;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                letter-spacing: 0.5px;
            }
            
            input[type="email"], 
            input[type="password"] {
                width: 100%;
                padding: 16px 20px;
                background: rgba(255, 255, 255, 0.1);
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 12px;
                color: white;
                font-size: 16px;
                font-family: inherit;
                backdrop-filter: blur(8px);
                transition: all 0.3s ease;
                box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
            }
            
            input[type="email"]:focus, 
            input[type="password"]:focus {
                outline: none;
                border-color: #ff8c00;
                background: rgba(255, 255, 255, 0.15);
                box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(255, 140, 0, 0.2);
            }
            
            .submit-button {
                width: 100%;
                padding: 18px 20px;
                background: linear-gradient(135deg, #ff8c00 0%, #e67700 100%);
                border: none;
                border-radius: 12px;
                color: white;
                font-size: 16px;
                font-weight: 600;
                font-family: inherit;
                cursor: pointer;
                transition: all 0.3s ease;
                margin-bottom: 30px;
                box-shadow: 0 4px 15px rgba(255, 140, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            .submit-button:hover {
                background: linear-gradient(135deg, #ffaa33 0%, #ff8c00 100%);
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(255, 140, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
            }
            
            .divider {
                height: 1px;
                background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%);
                margin: 30px 0;
            }
            
            .form-link {
                font-size: 14px;
                color: rgba(255, 255, 255, 0.8);
                line-height: 1.6;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            }
            
            .form-link a {
                color: #ff8c00;
                text-decoration: none;
                font-weight: 500;
                transition: color 0.3s ease;
            }
            
            .form-link a:hover {
                color: #ffaa33;
                text-decoration: underline;
            }
            
            @media (max-width: 480px) {
                .container {
                    padding: 40px 30px;
                    margin: 20px;
                }
                
                .game-title {
                    height: 40px;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="game-title">
                <img src="logo.png" alt="Broth & Bullets Logo" style="height: 100%; width: auto;">
            </div>
            <div class="game-subtitle">2D Multiplayer Survival</div>
            
            <h1 class="form-title">Sign In</h1>
            
            <form method="post">
                <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}">
                <input type="hidden" name="state" value="${state || ''}">
                <input type="hidden" name="code_challenge" value="${code_challenge}">
                <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                <input type="hidden" name="client_id" value="${client_id}">
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input id="email" name="email" type="email" autocomplete="email" required placeholder="Enter your email">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password">
                </div>
                
                <button type="submit" class="submit-button">Sign In</button>
            </form>
            
            <div class="divider"></div>
            
            <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Create Account</a></p>
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
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Sign In - Broth & Bullets</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    body {
                        min-height: 100vh;
                        width: 100%;
                        background-image: url('login_background.png');
                        background-size: cover;
                        background-position: top center;
                        background-repeat: no-repeat;
                        background-attachment: fixed;
                        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                        color: white;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        position: relative;
                        overflow-x: hidden;
                    }
                    
                    .container {
                        background: rgba(0, 0, 0, 0.75);
                        backdrop-filter: blur(12px);
                        border: 2px solid rgba(255, 255, 255, 0.3);
                        border-radius: 16px;
                        padding: 60px 40px;
                        width: 90%;
                        max-width: 450px;
                        position: relative;
                        z-index: 2;
                        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
                        text-align: center;
                    }
                    
                    .game-title {
                        height: 60px;
                        margin-bottom: 15px;
                        object-fit: contain;
                        filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.8));
                    }
                    
                    .game-subtitle {
                        font-size: 14px;
                        color: rgba(255, 255, 255, 0.8);
                        margin-bottom: 40px;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                        font-weight: 400;
                        letter-spacing: 2px;
                        text-transform: uppercase;
                    }
                    
                    .form-title {
                        font-size: 24px;
                        font-weight: 600;
                        color: white;
                        margin-bottom: 20px;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    }
                    
                    .error-message {
                        background: rgba(220, 53, 69, 0.15);
                        border: 1px solid rgba(220, 53, 69, 0.4);
                        border-radius: 8px;
                        padding: 12px;
                        margin-bottom: 25px;
                        font-size: 14px;
                        color: #ff6b6b;
                        backdrop-filter: blur(8px);
                        text-shadow: none;
                    }
                    
                    .form-group {
                        margin-bottom: 25px;
                        text-align: left;
                    }
                    
                    label {
                        display: block;
                        margin-bottom: 8px;
                        font-size: 13px;
                        color: rgba(255, 255, 255, 0.9);
                        font-weight: 500;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                        letter-spacing: 0.5px;
                    }
                    
                    input[type="email"], 
                    input[type="password"] {
                        width: 100%;
                        padding: 16px 20px;
                        background: rgba(255, 255, 255, 0.1);
                        border: 2px solid rgba(255, 255, 255, 0.3);
                        border-radius: 12px;
                        color: white;
                        font-size: 16px;
                        font-family: inherit;
                        backdrop-filter: blur(8px);
                        transition: all 0.3s ease;
                        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
                    }
                    
                    input[type="email"]:focus, 
                    input[type="password"]:focus {
                        outline: none;
                        border-color: #ff8c00;
                        background: rgba(255, 255, 255, 0.15);
                        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(255, 140, 0, 0.2);
                    }
                    
                    .submit-button {
                        width: 100%;
                        padding: 18px 20px;
                        background: linear-gradient(135deg, #ff8c00 0%, #e67700 100%);
                        border: none;
                        border-radius: 12px;
                        color: white;
                        font-size: 16px;
                        font-weight: 600;
                        font-family: inherit;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        margin-bottom: 30px;
                        box-shadow: 0 4px 15px rgba(255, 140, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    }
                    
                    .submit-button:hover {
                        background: linear-gradient(135deg, #ffaa33 0%, #ff8c00 100%);
                        transform: translateY(-2px);
                        box-shadow: 0 6px 20px rgba(255, 140, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
                    }
                    
                    .divider {
                        height: 1px;
                        background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%);
                        margin: 30px 0;
                    }
                    
                    .form-link {
                        font-size: 14px;
                        color: rgba(255, 255, 255, 0.8);
                        line-height: 1.6;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    }
                    
                    .form-link a {
                        color: #ff8c00;
                        text-decoration: none;
                        font-weight: 500;
                        transition: color 0.3s ease;
                    }
                    
                    .form-link a:hover {
                        color: #ffaa33;
                        text-decoration: underline;
                    }
                    
                    @media (max-width: 480px) {
                        .container {
                            padding: 40px 30px;
                            margin: 20px;
                        }
                        
                        .game-title {
                            height: 40px;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="game-title">
                        <img src="logo.png" alt="Broth & Bullets Logo" style="height: 100%; width: auto;">
                    </div>
                    <div class="game-subtitle">2D Multiplayer Survival</div>
                    <h1 class="form-title">Sign In</h1>
                    <p class="error-message">Invalid email or password. Please try again.</p>
                    <form method="post">
                        <input type="hidden" name="redirect_uri" value="${redirect_uri_from_form}">
                        <input type="hidden" name="state" value="${state || ''}">
                        <input type="hidden" name="code_challenge" value="${code_challenge}">
                        <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
                        <input type="hidden" name="client_id" value="${client_id}">
                        <div class="form-group">
                            <label for="email">Email Address</label>
                            <input id="email" name="email" type="email" value="${email || ''}" required placeholder="Enter your email">
                        </div>
                        <div class="form-group">
                            <label for="password">Password</label>
                            <input id="password" name="password" type="password" required placeholder="Enter your password">
                        </div>
                        <button type="submit" class="submit-button">Sign In</button>
                    </form>
                    <div class="divider"></div>
                    <p class="form-link">Don't have an account? <a href="/auth/password/register?${queryString}">Create Account</a></p>
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