import postgres from 'postgres';

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

class DatabaseService {
  private sql: postgres.Sql | null = null;
  private memoryUsers = new Map<string, UserRecord>();
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
      console.log('[Database] Using in-memory storage (development)');
      this.isProduction = false;
    }
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
      if (this.memoryUsers.has(user.email)) {
        return false;
      }
      this.memoryUsers.set(user.email, user);
      return true;
    }
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    if (this.isProduction && this.sql) {
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
      return this.memoryUsers.get(email) || null;
    }
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    if (this.isProduction && this.sql) {
      const result = await this.sql`
        UPDATE users 
        SET password_hash = ${passwordHash}
        WHERE user_id = ${userId}
      `;
      return result.count > 0;
    } else {
      for (const [email, user] of this.memoryUsers.entries()) {
        if (user.userId === userId) {
          this.memoryUsers.set(email, { ...user, passwordHash });
          return true;
        }
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