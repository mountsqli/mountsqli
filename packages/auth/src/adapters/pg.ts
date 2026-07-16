/**
 * Postgres adapter for MountSQLI Auth using the MountSQLI query builder.
 */

import type { Adapter, User, Session, Account, VerificationToken } from "../types/index.js";

export interface PgAdapterConfig {
  raw: (sql: string, params?: unknown[]) => Promise<any[]>;
}

export function createPgAdapter({ raw }: PgAdapterConfig): Adapter {
  return {
    async createUser(user) {
      const [created] = await raw(
        `INSERT INTO "users" (id, name, email, "emailVerified", image, "passwordHash", role)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'user')
         RETURNING *`,
        [user.name, user.email, user.emailVerified ?? null, user.image ?? null, ""],
      );
      return toUser(created);
    },

    async getUser(id) {
      const [user] = await raw(`SELECT * FROM "users" WHERE id = $1`, [id]);
      return user ? toUser(user) : null;
    },

    async getUserByEmail(email) {
      const [user] = await raw(`SELECT * FROM "users" WHERE email = $1`, [email]);
      return user ? toUser(user) : null;
    },

    async getUserByAccount({ providerAccountId, provider }) {
      const [account] = await raw(
        `SELECT u.* FROM "users" u
         JOIN "accounts" a ON u.id = a."userId"
         WHERE a."providerAccountId" = $1 AND a.provider = $2`,
        [providerAccountId, provider],
      );
      return account ? toUser(account) : null;
    },

    async updateUser(user) {
      const [updated] = await raw(
        `UPDATE "users" SET name = $2, email = $3, image = $4, "emailVerified" = $5, "updatedAt" = NOW()
         WHERE id = $1 RETURNING *`,
        [user.id, user.name ?? null, user.email ?? null, user.image ?? null, user.emailVerified ?? null],
      );
      return toUser(updated);
    },

    async deleteUser(id) {
      await raw(`DELETE FROM "users" WHERE id = $1`, [id]);
    },

    async linkAccount(account) {
      await raw(
        `INSERT INTO "accounts" ("userId", type, provider, "providerAccountId", access_token, refresh_token, expires_at, token_type, scope, id_token, session_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT ("providerAccountId", provider) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           token_type = EXCLUDED.token_type,
           scope = EXCLUDED.scope,
           id_token = EXCLUDED.id_token,
           session_state = EXCLUDED.session_state`,
        [
          account.userId,
          account.type,
          account.provider,
          account.providerAccountId,
          account.access_token ?? null,
          account.refresh_token ?? null,
          account.expires_at ?? null,
          account.token_type ?? null,
          account.scope ?? null,
          account.id_token ?? null,
          account.session_state ?? null,
        ],
      );
      return account;
    },

    async unlinkAccount({ providerAccountId, provider }) {
      await raw(`DELETE FROM "accounts" WHERE "providerAccountId" = $1 AND provider = $2`, [providerAccountId, provider]);
    },

    async createSession({ sessionToken, userId, expires }) {
      await raw(
        `INSERT INTO "sessions" ("sessionToken", "userId", expires) VALUES ($1, $2, $3)`,
        [sessionToken, userId, expires],
      );
      return { sessionToken, userId, expires: expires.toISOString() };
    },

    async getSessionAndUser(sessionToken) {
      const [result] = await raw(
        `SELECT s."sessionToken" AS s_token, s."userId" AS s_user, s.expires AS s_expires,
                u.id, u.name, u.email, u."emailVerified", u.image
         FROM "sessions" s JOIN "users" u ON s."userId" = u.id
         WHERE s."sessionToken" = $1 AND s.expires > NOW()`,
        [sessionToken],
      );
      if (!result) return null;
      const user = toUser(result);
      return {
        session: { sessionToken: result.s_token, userId: result.s_user, expires: result.s_expires, user },
        user,
      };
    },

    async updateSession({ sessionToken, expires }) {
      await raw(`UPDATE "sessions" SET expires = $2 WHERE "sessionToken" = $1`, [sessionToken, expires]);
      const [session] = await raw(`SELECT * FROM "sessions" WHERE "sessionToken" = $1`, [sessionToken]);
      return session as Session;
    },

    async deleteSession(sessionToken) {
      await raw(`DELETE FROM "sessions" WHERE "sessionToken" = $1`, [sessionToken]);
    },

    async createVerificationToken({ identifier, token, expires }) {
      await raw(`INSERT INTO "verification_tokens" (identifier, token, expires) VALUES ($1, $2, $3)`, [identifier, token, expires]);
      return { identifier, token, expires };
    },

    async useVerificationToken({ identifier, token }) {
      const [vt] = await raw(`SELECT * FROM "verification_tokens" WHERE identifier = $1 AND token = $2`, [identifier, token]);
      if (!vt) return null;
      await raw(`DELETE FROM "verification_tokens" WHERE identifier = $1 AND token = $2`, [identifier, token]);
      return vt as VerificationToken;
    },
  };
}

function toUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
  };
}