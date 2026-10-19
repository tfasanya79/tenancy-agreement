# DeepSeek setup, cost and privacy

TenancyDesk uses [DeepSeek](https://platform.deepseek.com) for the assistant — the
part that reads a landlord's email and fills in the blanks. Everything else in the
app works without it.

The assistant is optional. With no key:

- The Details tab, all compliance checks, and all document generation still work.
- The Assistant tab shows a short explanation instead of a chat box.

---

## Getting a key

1. Go to <https://platform.deepseek.com> and sign in.
2. Open **API Keys**.
3. Create a new key. Copy it — it is shown once.
4. Put it in `.env`:

   ```bash
   DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

5. Restart the app (`docker compose restart`, or `Ctrl+C` then `pnpm start`).
6. Confirm with `pnpm doctor` — it calls DeepSeek's `/models` endpoint, which
   verifies the key without spending any tokens.

The app shows **Assistant ready** in the top right when it has a working key.

---

## Which model

| Setting | Value |
| --- | --- |
| `DEEPSEEK_MODEL` | `deepseek-chat` — the default, and the right choice |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` — change only if you use a proxy |

`deepseek-chat` supports **function calling**, which is what makes the assistant
able to actually do things (record a field, run the checks, generate documents)
rather than just talk.

**Do not use `deepseek-reasoner`.** It does not support tools, so the assistant
would be able to chat but unable to touch the pack. The app detects this and
returns a clear error rather than failing obscurely.

---

## What a pack costs

Each pack involves a handful of short requests: one to read the pasted details,
sometimes one or two more to handle a missing field, one or two to run checks and
generate. Nothing is sent in the background, and no tokens are spent while the app
is idle.

- The prompt carries the field catalogue and the current pack, which is a few
  thousand tokens.
- Responses are short — tool calls and a few sentences.

In practice the cost per tenant is **pennies, not pounds**. DeepSeek prices per
million tokens and changes its prices; check
<https://api-docs.deepseek.com/quick_start/pricing> for the current figures rather
than trusting any number in a README.

If you want a hard ceiling, use DeepSeek's own spending limits on your account.
The app also caps `max_tokens` per request and stops the tool loop after eight
rounds, so a runaway conversation cannot quietly run up a bill.

You can see what was actually used on the **Checks** tab's run history, or in the
`agent_runs` table of the database — every run stores its prompt and completion
token counts.

---

## What is sent to DeepSeek

Only what the assistant needs to do its job:

| Sent | Not sent |
| --- | --- |
| The details in the pack you are working on (names, addresses, dates, amounts, certificate dates) | Your API key is sent only as the `Authorization` header |
| The text you paste or type into the Assistant tab | The generated `.docx` files |
| The list of available templates and their required fields | Any other pack |
| The result of any tool call the assistant made (e.g. compliance findings) | Anything at all when you are not using the Assistant tab |

There is **no telemetry and no analytics** in this app. The DeepSeek call is the
only outbound request it makes.

> **Practically:** do not paste anything into the Assistant tab that you would not
> be content to send to that provider. A tenancy email is normally fine. Special
> category data — health, ethnicity, religion — should be handled according to your
> own data-protection policy, not pasted into a chat box.
>
> Check DeepSeek's current terms, retention policy and data-processing terms
> yourself before using it with real tenant data. That is your decision as the data
> controller, and it is the reason the app works perfectly well with the assistant
> switched off.

---

## Switching the assistant off

Either remove the key, or set:

```bash
OFFLINE_MODE=true
```

The Assistant tab then explains itself and everything else carries on. Useful for
demonstrating the app, for a colleague who should not be using AI, or for a
machine with no internet access.

---

## Troubleshooting

| Error message | Cause and fix |
| --- | --- |
| *No DeepSeek API key is configured* | `DEEPSEEK_API_KEY` is empty or `.env` is not being read (check you are in the project root, and that the file is called `.env`, not `.env.txt`) |
| *DeepSeek rejected the API key* (401/403) | Wrong, revoked or mistyped key. Watch for a trailing space when pasting. |
| *Your DeepSeek account has no remaining balance* (402) | Top up at platform.deepseek.com. Nothing is charged to this project. |
| *DeepSeek is rate limiting requests* (429) | Transient. The client retries with backoff; wait a moment. |
| *DeepSeek had a server error* (5xx) | Their side. Retried automatically; if it persists, try later. |
| *DeepSeek took too long to respond* | Network timeout after two minutes. Check your connection. |
| *The reasoner model does not support tools* | Set `DEEPSEEK_MODEL=deepseek-chat`. |
| *Could not reach DeepSeek* | No internet, a proxy, or a firewall blocking `api.deepseek.com`. |

The client retries transient failures (429, 5xx, network errors) three times with
exponential backoff, and does **not** retry errors your key cannot fix — a bad key
fails immediately with a message you can act on.

---

## If you would rather use another provider

The client ([`src/agent/deepseek.ts`](../src/agent/deepseek.ts)) speaks the
**OpenAI-compatible chat-completions API with function calling**. Any provider that
offers the same shape will work by pointing `DEEPSEEK_BASE_URL` at it — for
example a compatible proxy or gateway.

Two things must be true of the model: it must support tool calling, and it should
handle a system prompt of a few thousand tokens. If you swap providers, re-run
`pnpm doctor` and then try the three shortcut buttons on a test pack before trusting
it with a real tenant.
