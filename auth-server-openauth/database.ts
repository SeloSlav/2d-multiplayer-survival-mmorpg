import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

export interface UserRecord {
  userId: string;
  email: string;
  passwordHash: string;
}

export interface AuthCodeData {
  userId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  redirectUri: string;
}

interface JsonStorage {
  users: UserRecord[];
  codes: { code: string; data: AuthCodeData; expiresAt: number }[];
}

class DatabaseService {
  private sql: postgres.Sql | null = null;
  private jsonFilePath = path.join(process.cwd(), 'users.json');
  private memoryCodes = new Map<string, AuthCodeData>();
  private isProduction = false;

  async init() {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (databaseUrl) {
      console.log('[Database] Using PostgreSQL (production)');
      this.sql = postgres(databaseUrl);
      this.isProduction = true;
      await this.createTables();
    } else {
      console.log('[Database] Using JSON file storage (development)');
      this.isProduction = false;
      this.initJsonStorage();
    }
  }

  private initJsonStorage() {
    // Only create/use JSON file in development mode
    if (!fs.existsSync(this.jsonFilePath)) {
      const initialData: JsonStorage = { users: [], codes: [] };
      fs.writeFileSync(this.jsonFilePath, JSON.stringify(initialData, null, 2));
      console.log('[Database] Created users.json file for development');
    } else {
      console.log('[Database] Found existing users.json file');
    }
  }

  private readJsonStorage(): JsonStorage {
    try {
      const data = fs.readFileSync(this.jsonFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.warn('[Database] Failed to read users.json, creating new file');
      const initialData: JsonStorage = { users: [], codes: [] };
      this.writeJsonStorage(initialData);
      return initialData;
    }
  }

  private writeJsonStorage(data: JsonStorage) {
    fs.writeFileSync(this.jsonFilePath, JSON.stringify(data, null, 2));
  }

  private async createTables() {
    if (!this.sql) return;
    
    await this.sql`
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS auth_codes (
        code VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method VARCHAR(10) NOT NULL,
        client_id VARCHAR(255) NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes')
      )
    `;

    // Clean up expired codes
    await this.sql`DELETE FROM auth_codes WHERE expires_at < CURRENT_TIMESTAMP`;
  }

  // User operations
  async createUser(user: UserRecord): Promise<boolean> {
    if (this.isProduction && this.sql) {
      // Production: Use PostgreSQL
      try {
        await this.sql`
          INSERT INTO users (user_id, email, password_hash)
          VALUES (${user.userId}, ${user.email}, ${user.passwordHash})
        `;
        return true;
      } catch (error: any) {
        if (error.code === '23505') { // Unique constraint violation
          return false;
        }
        throw error;
      }
    } else {
      // Development: Use JSON file
      const storage = this.readJsonStorage();
      if (storage.users.find(u => u.email === user.email)) {
        return false; // Email already exists
      }
      storage.users.push(user);
      this.writeJsonStorage(storage);
      return true;
    }
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    if (this.isProduction && this.sql) {
      // Production: Use PostgreSQL
      const result = await this.sql`
        SELECT user_id, email, password_hash 
        FROM users 
        WHERE email = ${email}
      `;
      return result[0] ? {
        userId: result[0].user_id,
        email: result[0].email,
        passwordHash: result[0].password_hash
      } : null;
    } else {
      // Development: Use JSON file
      const storage = this.readJsonStorage();
      return storage.users.find(u => u.email === email) || null;
    }
  }

  async getUserById(userId: string): Promise<UserRecord | null> {
    if (this.isProduction && this.sql) {
      // Production: Use PostgreSQL
      const result = await this.sql`
        SELECT user_id, email, password_hash 
        FROM users 
        WHERE user_id = ${userId}
      `;
      return result[0] ? {
        userId: result[0].user_id,
        email: result[0].email,
        passwordHash: result[0].password_hash
      } : null;
    } else {
      // Development: Use JSON file
      const storage = this.readJsonStorage();
      return storage.users.find(u => u.userId === userId) || null;
    }
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    if (this.isProduction && this.sql) {
      // Production: Use PostgreSQL
      const result = await this.sql`
        UPDATE users 
        SET password_hash = ${passwordHash}
        WHERE user_id = ${userId}
      `;
      return result.count > 0;
    } else {
      // Development: Use JSON file
      const storage = this.readJsonStorage();
      const userIndex = storage.users.findIndex(u => u.userId === userId);
      if (userIndex !== -1) {
        storage.users[userIndex].passwordHash = passwordHash;
        this.writeJsonStorage(storage);
        return true;
      }
      return false;
    }
  }

  // Auth code operations
  async storeAuthCode(code: string, data: AuthCodeData): Promise<void> {
    if (this.isProduction && this.sql) {
      await this.sql`
        INSERT INTO auth_codes (code, user_id, code_challenge, code_challenge_method, client_id, redirect_uri)
        VALUES (${code}, ${data.userId}, ${data.codeChallenge}, ${data.codeChallengeMethod}, ${data.clientId}, ${data.redirectUri})
      `;
    } else {
      this.memoryCodes.set(code, data);
    }
  }

  async getAuthCode(code: string): Promise<AuthCodeData | null> {
    if (this.isProduction && this.sql) {
      const result = await this.sql`
        SELECT user_id, code_challenge, code_challenge_method, client_id, redirect_uri
        FROM auth_codes 
        WHERE code = ${code} AND expires_at > CURRENT_TIMESTAMP
      `;
      return result[0] ? {
        userId: result[0].user_id,
        codeChallenge: result[0].code_challenge,
        codeChallengeMethod: result[0].code_challenge_method,
        clientId: result[0].client_id,
        redirectUri: result[0].redirect_uri
      } : null;
    } else {
      return this.memoryCodes.get(code) || null;
    }
  }

  async deleteAuthCode(code: string): Promise<void> {
    if (this.isProduction && this.sql) {
      await this.sql`DELETE FROM auth_codes WHERE code = ${code}`;
    } else {
      this.memoryCodes.delete(code);
    }
  }
}

export const db = new DatabaseService(); 