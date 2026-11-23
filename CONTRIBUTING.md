# Contributing

[Deutsch](CONTRIBUTING.de.md) · **English**

Thank you for wanting to help. Bug reports, ideas and pull requests are welcome.

## Bugs and feature requests

- First search the [issues](../../issues) to see whether the topic already exists.
- Use the templates for **bugs** and **feature requests**.
- Do **not** report **security vulnerabilities** as an issue, but as described in [SECURITY.md](SECURITY.md).

## Setting up development

You only need Node.js ≥ 18. Java and a real Minecraft server are not required.

```bash
git clone https://github.com/dev-sasa/mc-server-panel.git
cd mc-server-panel
npm install
npm run dev
```

The panel then runs at `http://127.0.0.1:8080` (user `admin`, password `dev`) with a simulated server. All data is stored in `.dev/`.

## Before the pull request

1. Create a branch: `git checkout -b my-feature`.
2. Follow the existing style: plain JavaScript without a build step, two-space indentation (see `.editorconfig`). UI texts are written in German; the English texts go into `public/i18n-en.js`, and `node dev/i18n-extract.js` shows what is still missing. The German README is `README.de.md`.
3. Check the syntax and the tests: `npm run check` and `npm test`. New endpoints and rules should get a test (see `test/`).
4. Try your change in dev mode, also in the light and dark design and in the narrow (mobile) view if you touch the interface.
5. Permissions and inputs are checked by the **server**, not only by the interface. New endpoints therefore need an entry in `requiredPerm` in `lib/auth.js` and validation of the inputs.
6. Write in the description what you changed and how you tested it.

## Principles

- **Do not write IP addresses** or other personal data to the log.
- **No new external services**, and do not embed third-party scripts or fonts, without listing them in the "Privacy and external services" section of README.md.
- Add new dependencies only if they are really necessary. The project should stay small and easy to review.
- Passwords, credentials and the files `config.json`, `.env`, `audit.jsonl` never belong in a commit.
