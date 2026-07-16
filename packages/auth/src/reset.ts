// MountSQLI — password reset flow.
//
// Usage:
//   const reset = new PasswordReset(new MemoryTokenStore());
//   const token = reset.create("user-id");
//   const ok = reset.verify(token, "new-password");

import { randomBytes } from "node:crypto";
import { hashPassword } from "./crypto.js";
import type { TokenStore } from "./session.js";

export interface EmailTransport {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Simple console-log email transport (dev/test only). */
export class ConsoleEmailTransport implements EmailTransport {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`[Email] To: ${to} | Subject: ${subject}\n${body}`);
  }
}

export interface PasswordResetConfig {
  /** Token TTL in seconds (default 1 hour). */
  ttlSec?: number;
  /** Where to store reset tokens. */
  store: TokenStore;
  /** Optional email transport. */
  email?: EmailTransport;
}

export class PasswordReset {
  private ttlSec: number;
  private store: TokenStore;
  private email?: EmailTransport;

  constructor(cfg: PasswordResetConfig) {
    this.ttlSec = cfg.ttlSec ?? 3600;
    this.store = cfg.store;
    this.email = cfg.email;
  }

  /**
   * Generate a reset token for a user and optionally email it.
   * Returns the raw token string (the caller sends it to the user).
   */
  create(userId: string | number): string {
    const token = randomBytes(32).toString("hex");
    this.store.save({ token, userId, expiresAt: Date.now() + this.ttlSec * 1000 });
    return token;
  }

  /** Send the reset email via the configured transport. */
  async sendEmail(email: string, token: string): Promise<void> {
    if (!this.email) return;
    await this.email.send(
      email,
      "Password Reset",
      `Use this link to reset your password:\n\n${token}\n\nThis link expires in ${this.ttlSec / 60} minutes.`,
    );
  }

  /**
   * Verify a reset token and set a new password.
   * Returns false if the token is invalid or expired.
   */
  async verify(token: string, newPassword: string): Promise<boolean> {
    const record = await this.store.load(token);
    if (!record) return false;
    if (record.expiresAt < Date.now()) return false;
    // Hash the new password and store it (the caller handles persistence).
    const hashed = hashPassword(newPassword);
    await this.store.revoke(token);
    return true; // caller must persist { userId: record.userId, passwordHash: hashed }
  }
}
