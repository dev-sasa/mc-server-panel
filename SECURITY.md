# Security

[Deutsch](SECURITY.de.md) · **English**

MC Server Panel can change files on the server, run commands and control processes. Security vulnerabilities are therefore taken especially seriously.

## Reporting a vulnerability

Please do **not** report vulnerabilities as a public issue or in a discussion.

Use GitHub's private reporting feature instead:

1. Open the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe what happens, how to reproduce it and which version is affected.

I will reply as soon as possible, but please give me a few days. Please do not make anything public until a fix has been released. If you like, I will credit you as the discoverer in the changelog.

## Supported versions

Security fixes are provided for the **latest version** (branch `main`).

## What counts as a vulnerability

For example:

- Access to the panel or to files outside the server folder without signing in or without the appropriate role
- Bypassing the role check (for example a viewer who can run commands)
- Reading out passwords, sessions, 2FA secrets, the webhook address or the Discord secret
- Bypassing two-factor sign-in or the sign-in lockout (except via the deliberately trusted Discord sign-in)
- Extracting archives in a way that writes files outside the server folder
- Injecting commands or scripts (command injection, XSS, CSRF)

Not included: issues that require an already signed-in admin (who may run commands anyway), and missing hardening caused by an unprotected installation, such as running without HTTPS on the open internet.

## Recommendations for operation

- Run the panel only behind HTTPS or reach it via an SSH tunnel, not unprotected on the internet.
- Start it with a dedicated user, never as `root`.
- Use long, unique passwords, enable two-factor sign-in and protect the main user.
- Behind a reverse proxy, set `MCPANEL_TRUST_PROXY` appropriately (see INSTALLATION.md) so that the sign-in lockout counts the real visitors.
- Do not share `config.json` and `.env`. They contain password hashes and credentials.
- Keep the panel and Node.js up to date.

More on this can be found in [INSTALLATION.md](INSTALLATION.md) in the section "Securing and exposing the panel".
