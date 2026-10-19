# Security

This document describes what TenancyDesk protects, what it does not, and what you have to do yourself. It is written for the person running the app — normally a one-person letting agency — not for a security team.

## What this app stores

Every pack holds real personal data about real people:

| Data | Where it lives |
| --- | --- |
| Tenant names, dates of birth, current addresses, email addresses, phone numbers | `data/tenancydesk.db` (the `packs` table) |
| ID document references — passport or driving licence type and number | The same pack record |
| Property address and tenancy terms: rent, deposit amounts, start date, scheme references | The same pack record |
| Internal notes and drafted cover messages for email and WhatsApp | The same pack record |
| Every generated document — tenancy agreement, prescribed information, inventory, notices, welcome pack, guarantor deed | `data/documents/<pack-id>/` as `.docx`, `.html` and `.md` |
| A log of what the AI assistant did, including the details it was given | The `agent_runs` table |

Some packs also hold guarantor details and landlord contact details.

**This is personal data under the UK GDPR, and the letting agent is the data controller.** TenancyDesk is the software you use to process it; it does not decide what is lawful, how long to keep it, or who may see it. Those are your decisions, and you should have a lawful basis (normally contract and legal obligation), a retained privacy notice, and a retention period. Nothing in this app encrypts, anonymises, redacts or expires that data for you.

## The security model, stated plainly

Read this before deploying anywhere.

- **Single user. No accounts. No login. No password.** The app has no concept of a user at all.
- **No rate limiting, no CSRF tokens, no session handling.** Every request that reaches the port is treated as the letting agent.
- **No encryption at rest beyond whatever your operating system does.** The SQLite file and the generated documents are plain files. If the disk is not encrypted, a stolen laptop or a discarded drive is a data breach.
- **No access log beyond process output.** `NODE_ENV=production` makes the server log requests; nothing audits who viewed which pack, because nobody is identified.

The correct deployment is therefore one of:

1. On a **trusted machine** that only you use, ideally reached at `localhost`.
2. Behind a **VPN** — Tailscale, WireGuard or your router's VPN — so the only clients are your own devices.
3. Behind an **authenticating reverse proxy** that requires a password and terminates HTTPS.

Never expose the port directly to the public internet. Anyone who finds it can read, alter and delete every tenant pack, and can spend your DeepSeek credit. `docs/DEPLOY.md` §4 has an nginx configuration with TLS, basic auth and security headers.

## What the app does to protect data

These are real measures, not marketing. Each is small and checkable in the source.

| Protection | Where | What it means |
| --- | --- | --- |
| `.env` is git-ignored | `.gitignore` (`!.env.example` kept) | Your API key and agency details are not committed by accident. |
| `data/` is git-ignored | `.gitignore` (`data/`, `output/`, `*.db`, `*.db-wal`, `*.db-shm`) | Tenant packs never enter version control. `.dockerignore` keeps them out of the image too. |
| The API key is never logged | `src/config.ts` | `describeConfig` reports `apiKeyPresent: true/false` and nothing else. The key is not in the startup banner, the health endpoint or an error message. |
| Downloads cannot escape the data folder | `src/app.ts` | Each download resolves the stored path with `resolve(config.dataDir, …)`, then rejects it unless the result still starts with the resolved data directory — a path-traversal check. The ZIP bundle applies the same check per entry. |
| Filenames are sanitised | `src/app.ts` (`safeFilename`) | Characters such as backslash, slash, colon, asterisk, question mark, quote, angle brackets and pipe become `-`, whitespace is collapsed, and the name is capped at 90 characters, so a pack title cannot break the response header or the saved path. |
| Request bodies are capped at 2 MB | `src/app.ts` (`bodyLimit`) | A giant payload is refused rather than buffered. |
| Tool output fed back to the model is truncated | `src/agent/loop.ts` | Tool results are cut at 12,000 characters before they are sent, and the transcript is bounded by a step limit of 8 rounds. |
| The assistant can only touch an allow-list of fields | `src/agent/tools.ts` | The model writes values through `set_fields`; it cannot invent a document or reach a file path that is not a loaded template. Document generation is refused while a compliance error remains. |
| Generated documents are not served as raw HTML from the data folder | `src/app.ts` | A document is sent with an explicit content type and a `Content-Disposition` header; inline display only happens when the interface asks for it (`inline=1`). |

None of this is a substitute for access control. It limits the blast radius of a mistake; it does not guard the door.

## Where data leaves the machine

The app makes **one** kind of outbound connection.

| Destination | When | What is in it |
| --- | --- | --- |
| Your configured DeepSeek endpoint (`DEEPSEEK_BASE_URL`, default `https://api.deepseek.com`) | Every time you use the assistant | Your message, the field values already recorded on the pack, the results of the tools the model called, and the template metadata it needs to choose documents |

The practical consequences, in plain terms:

- **Do not type anything into the assistant that you would not send to that provider.** Once a name, a date of birth or an ID reference has gone up in a prompt, it is out of your hands.
- **You can work without it.** Set `OFFLINE_MODE=true`, or leave `DEEPSEEK_API_KEY` empty. Entering details by hand and generating documents never contacts anything; only the assistant does.
- **Check the provider's terms yourself.** Data processing terms, retention, training use and sub-processors are between you and DeepSeek (or whoever your base URL points at). If you move the base URL to a proxy or another provider, the same question applies to them. As data controller, you are the one who has to be able to answer it.
- **`pnpm doctor` also contacts DeepSeek**, sending the key to `/models` to confirm it works. It sends no tenant data.
- **The app itself has no telemetry, no analytics, no crash reporting and no update check.** It also sends no email and no messages: the assistant drafts a cover message and you send it from your own mailbox.

## Recommended hardening checklist

Work down this list; the first three matter far more than the rest.

- [ ] **Behind HTTPS and authentication, or a VPN.** No exceptions if it is reachable from anywhere other than your own machine.
- [ ] **Run as a non-root user.** The Docker image already runs as `node`; a local install should not be run with `sudo`.
- [ ] **`chmod 600 .env` and `chmod 700 data`.** The key and the tenant data are readable only by the account that runs the app.
- [ ] **Full-disk encryption**, on the laptop or on the server volume. This is the only thing standing between a stolen disk and a personal-data breach.
- [ ] **Back up `data/`** — encrypted, off the machine, and restored at least once to prove it works. Note the SQLite WAL files (`-wal`, `-shm`) or stop the app before copying.
- [ ] **Delete packs once the tenancy is archived.** The delete button removes the pack record; also clear the matching `data/documents/<pack-id>/` folder, and remember the assistant run log for that pack.
- [ ] **Keep Node and dependencies current.** `pnpm outdated`, `pnpm update`, and re-run `pnpm test`. Docker users rebuild the image on upgrade.
- [ ] **Review the rule set periodically.** The England & Wales checks are only as good as their sources — see `docs/RULES.md` (generated from `src/knowledge/rules.ts`, which records its review date). Tenancy law is changing through 2025–2026; a stale rule set produces confident wrong paperwork.
- [ ] **Use a DeepSeek key dedicated to this app, and rotate it.** One key per purpose means one thing to revoke if a laptop is lost. A leaked key is a bill, not a data breach — but revoke it anyway.
- [ ] **Decide your retention period and write it down.** The app will keep every pack forever, by default, because it has no opinion.

## Risks that remain, even when hardened

Access control is the biggest lever, but it is not the only one. These are the gaps a careful operator should know about:

| Risk | Why it remains | What you can do |
| --- | --- | --- |
| A stolen, unlocked laptop | The app trusts whoever is at the keyboard, and the browser session needs no password | Lock the screen, use disk encryption, keep the machine with you |
| Phishing or a shared screen | Packs are visible to anyone looking at the display | Treat a pack as you would a paper file |
| Malicious or mistaken data entered | The app stores what you type, and the assistant may fill fields from it | Check what the assistant recorded before generating anything |
| A wrong document reaching a tenant | Generation is a rendering step, not a legal review | Read the `.docx`, check the compliance panel, and only then send |
| Another process on the same machine | The SQLite file is a plain file readable by anyone who can reach it | `chmod 600` the database, one app per host, no shared logins |

## If something goes wrong

| What happened | Do this, in this order |
| --- | --- |
| **The machine was lost or stolen** | Change your DeepSeek key first, then treat the incident as a personal-data breach and assess whether it must be reported to the ICO — that is your call as controller, within 72 hours of becoming aware |
| **The API key was pasted somewhere public** | Revoke it in the DeepSeek console and issue a new one. A leaked key spends your credit; it does not expose stored packs |
| **The app turned out to be reachable from the internet** | Stop it (`docker compose stop`), fix the exposure, then review whether anything was accessed. The app keeps no access log, so assume it may have been |
| **A pack went to the wrong tenant** | Delete the generated files, delete the pack once you have kept what your records require, and record what happened |
| **A backup went missing** | If it was unencrypted, that is a breach on the same footing as losing the laptop |

## Reporting a vulnerability

If you find a security problem in TenancyDesk:

1. **Do not open a public issue describing the flaw**, and do not include tenant data, API keys or pack contents anywhere in a report.
2. **Open a private security advisory** on the project's GitHub page (*Security* → *Report a vulnerability*). That keeps the report visible only to the maintainers.
3. **Include what you can**: what you did, what happened, what you expected, and the version or commit. Reproduce it against a pack you created for testing, not a real tenant's.
4. **Give it a chance to be fixed** before writing it up publicly. A reasonable timescale is fine to ask for; state what you need.

<!-- maintainer: add contact -->

There is no bug bounty, no guaranteed response time and no formal support contract. This is a small self-hosted project, and it is honest about that.

## What is NOT a vulnerability

Some reports are not bugs. These are known, deliberate properties of the design:

| Report | Why it is by design |
| --- | --- |
| "There is no login / anyone can read the packs" | Single-user app, no account model. Protecting the port is a deployment decision — see §1. |
| "No rate limiting / no password complexity / no MFA" | There are no accounts to protect. Use a VPN or an authenticating proxy. |
| "Data is stored unencrypted on disk" | Relies on operating-system disk encryption, as documented above. |
| "The assistant invented a fact / got the law wrong" | It is a language model. It can be wrong, and its output is a draft. Check every value and every document before a tenant sees it. |
| "The generated document is not legally correct" | Templates are illustrations of how the software works, not legal advice (see `LICENSE`). The agency is responsible for the document it serves. |
| "Documents are not signed" | The app generates `.docx` and print-ready HTML. Signing, deposit protection and sending are done in other tools — see `docs/TOOLBOX.md`. |
| "It does not send the pack to the tenant" | Deliberate. You send it from your own mailbox. |
| "Two people cannot have separate logins" | There is no user model, by design. Run one instance per person if you need that. |

If your report is not on either list, it is worth sending.
