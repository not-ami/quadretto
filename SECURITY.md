# Security

Please **do not open a public issue** for a security problem. Use GitHub's private vulnerability reporting instead:
the repository's **Security** tab → **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer as soon as
possible; please give a reasonable time to fix the problem before disclosing it.

Areas that matter most: account isolation (every API query is filtered by the logged-in user), sessions and login
limits, the C/C++ sandbox (`server/run.js`), the GitHub import proxy, and file uploads.
