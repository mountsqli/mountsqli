# @mountsqli/auth

Complete, production-ready authentication system for MountSQLi applications.

## Features

- **Email/password** — Secure registration and login with scrypt hashing
- **JWT sessions** — Configurable expiration, revocable via database sessions
- **OAuth** — Google, GitHub with CSRF protection and email verification
- **2FA** — TOTP-based with QR code generation
- **RBAC** — Role-based access control with permission checking
- **Email verification** — Send verification emails on registration
- **Password reset** — Secure token-based password reset flow
- **Rate limiting** — Built-in protection against brute force attacks
- **CSRF protection** — For cookie-based authentication
- **Token encryption** — OAuth tokens encrypted at rest with AES-256-GCM
- **Framework middleware** — Express, Next.js, Hono, Fastify

## Installation

```bash
npm install @mountsqli/auth
```

## Quick Start

```typescript
import { createAuth, credentials, google, github } from '@mountsqli/auth';
import { mountsqli } from '@mountsqli/core';

const db = mountsqli(process.env.DATABASE_URL!);

export const auth = createAuth({
  db,
  secret: process.env.AUTH_SECRET!,
  providers: [
    credentials(),
    google({ clientId: process.env.GOOGLE_ID!, clientSecret: process.env.GOOGLE_SECRET! }),
    github({ clientId: process.env.GITHUB_ID!, clientSecret: process.env.GITHUB_SECRET! }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
});
```

## Usage

### Register & Login

```typescript
// Register
const { user, token } = await auth.register({ email, password, name });

// Login
const result = await auth.login('credentials', { email, password });
```

### OAuth

```typescript
// Get redirect URL
const url = await auth.signIn('google');

// Handle callback
const result = await auth.handleCallback('google', { code, state });
```

### Middleware (Express)

```typescript
import { expressMiddleware, requireAuth } from '@mountsqli/auth';

app.use(expressMiddleware(auth));
app.get('/api/me', requireAuth(auth), (req, res) => {
  res.json(req.auth.user);
});
```

### RBAC

```typescript
await auth.rbac.createRole({ name: 'admin', permissions: ['*'] });
await auth.rbac.assignRole(userId, 'admin');
const allowed = await auth.rbac.authorize(userId, 'posts:write');
```

### 2FA

```typescript
const { secret, otpauthUrl } = await auth.twoFactor.generate(userId);
await auth.twoFactor.enable(userId, code);
```

### Password Reset

```typescript
await auth.passwordReset.create(email);
await auth.passwordReset.verify(token, newPassword);
```

## Security

- scrypt password hashing with timing-safe comparison
- JWT with HS256 algorithm (prevents algorithm confusion)
- OAuth state validation (CSRF protection)
- AES-256-GCM token encryption at rest
- Rate limiting on all auth endpoints
- Input validation (email format, password strength)
- Generic error messages (prevents user enumeration)
- Timing-safe TOTP comparison

## Documentation

📖 [Documentation](https://mountsqli.vercel.app/docs/auth/overview)

## License

MIT
