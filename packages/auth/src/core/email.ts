/**
 * Email sending interface and built-in adapters.
 */

export interface EmailAdapter {
  send(params: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void>;
}

/**
 * Console email adapter (logs to console — for development).
 */
export class ConsoleEmailAdapter implements EmailAdapter {
  async send(params: { to: string; subject: string; text?: string; html?: string }): Promise<void> {
    console.log(`[Auth Email] To: ${params.to}`);
    console.log(`[Auth Email] Subject: ${params.subject}`);
    console.log(`[Auth Email] Body: ${params.text ?? params.html ?? ''}`);
  }
}

/**
 * Send a verification email.
 */
export async function sendVerificationEmail(
  adapter: EmailAdapter,
  email: string,
  token: string,
  baseUrl: string = 'http://localhost:3000',
): Promise<void> {
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;

  await adapter.send({
    to: email,
    subject: 'Verify your email address',
    text: `Click the link to verify your email: ${verifyUrl}`,
    html: `
      <h1>Verify your email</h1>
      <p>Click the link below to verify your email address:</p>
      <a href="${verifyUrl}">${verifyUrl}</a>
      <p>This link will expire in 24 hours.</p>
    `,
  });
}

/**
 * Send a password reset email.
 */
export async function sendPasswordResetEmail(
  adapter: EmailAdapter,
  email: string,
  token: string,
  baseUrl: string = 'http://localhost:3000',
): Promise<void> {
  const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

  await adapter.send({
    to: email,
    subject: 'Reset your password',
    text: `Click the link to reset your password: ${resetUrl}`,
    html: `
      <h1>Reset your password</h1>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}">${resetUrl}</a>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this, ignore this email.</p>
    `,
  });
}
