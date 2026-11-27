# Security

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting instead:
the repository's **Security** tab → **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer as soon as
possible; please give a reasonable time to fix the problem before disclosing it.

Quadretto is **beta** software: fixes go into the latest version only.

Areas that matter most:

- **permissions**: a user must reach only their own data and what has been shared with them, with the granted role
  (read or edit), in the API and on the live WebSocket (`server/server.js`, `server/live.js`, the role functions in
  `server/schema.sql`); revoking a share must take effect at once;
- **read-only links** (anyone holding one can read, without an account, until it expires or is revoked);
- sessions, login limits and the cross-site protections;
- the C/C++ sandbox (`server/run.js`);
- the GitHub import proxy and file uploads;
- the experimental federation between servers (`server/federation.js`, off unless configured).
