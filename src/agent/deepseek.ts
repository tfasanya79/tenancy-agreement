/**
 * A very small DeepSeek client.
 *
 * DeepSeek exposes an OpenAI-compatible chat-completions API, so we only need
 * `fetch` — no SDK, no extra dependency. Function calling is what makes the
 * assistant an *agent*: it decides which of our tools to call and in what order.
 */

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export class DeepSeekError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
    this.retryable = retryable;
  }
}

export type DeepSeekOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
};

type RawResponse = {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string };
};

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export class DeepSeekClient {
  readonly #options: DeepSeekOptions;

  constructor(options: DeepSeekOptions) {
    this.#options = options;
  }

  get model(): string {
    return this.#options.model;
  }

  /** True when a key is configured — the app can run without one, minus the AI. */
  get configured(): boolean {
    return this.#options.apiKey.trim() !== '';
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<ChatResult> {
    if (!this.configured) {
      throw new DeepSeekError(
        'No DeepSeek API key is configured. Add DEEPSEEK_API_KEY to your .env file — see docs/DEEPSEEK.md.',
        0,
        false,
      );
    }

    const body: Record<string, unknown> = {
      model: this.#options.model,
      messages,
      temperature: this.#options.temperature ?? 0.2,
      max_tokens: this.#options.maxTokens ?? 4000,
      stream: false,
    };
    if (tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }

    const url = `${(this.#options.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`;
    const doFetch = this.#options.fetchImpl ?? fetch;
    const maxRetries = this.#options.maxRetries ?? 3;
    let lastError: DeepSeekError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delay = Math.min(500 * 2 ** (attempt - 1), 8000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const response = await doFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.#options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? 120_000),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const error = new DeepSeekError(
            describeHttpError(response.status, text),
            response.status,
            RETRYABLE_STATUS.has(response.status),
          );
          if (!error.retryable) throw error;
          lastError = error;
          continue;
        }

        const raw = (await response.json()) as RawResponse;
        const choice = raw.choices?.[0];
        if (choice === undefined) {
          throw new DeepSeekError('DeepSeek returned no choices. Try again.', response.status, true);
        }

        return {
          content: choice.message?.content ?? '',
          toolCalls: choice.message?.tool_calls ?? [],
          finishReason: choice.finish_reason ?? 'stop',
          usage: {
            promptTokens: raw.usage?.prompt_tokens ?? 0,
            completionTokens: raw.usage?.completion_tokens ?? 0,
            totalTokens: raw.usage?.total_tokens ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof DeepSeekError && !error.retryable) throw error;
        if (error instanceof DeepSeekError) {
          lastError = error;
          continue;
        }
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          lastError = new DeepSeekError('DeepSeek took too long to respond. Try again.', 0, true);
          continue;
        }
        lastError = new DeepSeekError(
          `Could not reach DeepSeek: ${error instanceof Error ? error.message : String(error)}`,
          0,
          true,
        );
      }
    }

    throw lastError ?? new DeepSeekError('DeepSeek request failed.', 0, false);
  }
}

function describeHttpError(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return 'DeepSeek rejected the API key. Check DEEPSEEK_API_KEY in your .env file.';
  }
  if (status === 402) {
    return 'Your DeepSeek account has no remaining balance. Top up at platform.deepseek.com.';
  }
  if (status === 429) {
    return 'DeepSeek is rate limiting requests. Wait a moment and try again.';
  }
  if (status >= 500) {
    return `DeepSeek had a server error (${status}). Trying again shortly.`;
  }
  if (status === 400) {
    const hint = body.includes('reasoner') ? ' The reasoner model does not support tools — use deepseek-chat.' : '';
    return `DeepSeek could not understand the request (400).${hint}`;
  }
  return `DeepSeek returned an error (${status}). ${body.slice(0, 200)}`;
}
