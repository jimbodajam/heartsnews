import type { ScriptModel } from './script/llm.ts';

// Cloudflare Workers AI, for the story engine's reading in the ingest (storylines.ts, issue #25): free up to 10,000
// "neurons" a day, reached from GitHub or the PC through Cloudflare's OpenAI-compatible REST API. Kept apart from
// Gemini, whose free quota the bulletins use.
// Needs CLOUDFLARE_ACCOUNT_ID and an API token with the Workers AI permission: CLOUDFLARE_AI_TOKEN, or else the
// CLOUDFLARE_API_TOKEN wrangler uses.

/**
 * Workers AI's free allowance. Cloudflare counts it over a rolling 24 hours, not from midnight (seen 24 Oct 2026:
 * refused at 3,184 for the day, with 7,060 used the evening before), so the budget goes by its own analytics.
 */
export const DAILY_NEURONS = 10_000;

export interface WorkersModel {
  id: string;
  /** Neurons per million tokens, from Cloudflare's pricing page. Reasoning counts as output. */
  inputRate: number;
  outputRate: number;
}

export const GPT_OSS_120B: WorkersModel = { id: '@cf/openai/gpt-oss-120b', inputRate: 31_818, outputRate: 68_182 };
export const QWEN3_30B: WorkersModel = { id: '@cf/qwen/qwen3-30b-a3b-fp8', inputRate: 4_625, outputRate: 30_475 };

/** The main model until the 24 hours' use reaches `lightAt`, then the light one; nothing at all past `stopAt`. */
export interface Budget {
  /** Neurons already used in the last 24 hours. */
  used: number;
  lightAt: number;
  stopAt: number;
}

export const DEFAULT_BUDGET = { lightAt: 7_000, stopAt: 9_500 };

export class OutOfBudget extends Error {}

export interface MeteredModel extends ScriptModel {
  /** Neurons used by this run so far. */
  readonly neurons: number;
}

/** The first JSON object in a reply, in case a model wraps it in a code fence or a sentence. */
export function parseJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`no JSON object in the reply (${text.length} chars)`);
  return JSON.parse(text.slice(start, end + 1));
}

export interface WorkersAiOptions {
  accountId: string;
  token: string;
  budget: Budget;
  main?: WorkersModel;
  light?: WorkersModel;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export function workersAi(o: WorkersAiOptions): MeteredModel {
  const main = o.main ?? GPT_OSS_120B;
  const light = o.light ?? QWEN3_30B;
  const fetchFn = o.fetchFn ?? fetch;
  let neurons = 0;
  const used = new Set<string>();

  async function call(model: WorkersModel, prompt: string, schema: object): Promise<unknown> {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${o.accountId}/ai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: `${prompt}\n\nReply with one JSON object only.` }],
        response_format: { type: 'json_schema', json_schema: { name: 'reply', schema } },
        reasoning_effort: 'low',
        max_tokens: 8_000,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number };
      errors?: { message?: string }[];
    };
    const u = body.usage;
    // Cloudflare says what a request cost; failing that, work it out from the tokens.
    if (u?.neurons != null) neurons += u.neurons;
    else if (u) neurons += ((u.prompt_tokens ?? 0) * model.inputRate + (u.completion_tokens ?? 0) * model.outputRate) / 1e6;
    const said = body.errors?.map((e) => e.message).join('; ') ?? '';
    // Over the free allowance: every model is refused alike, so the run stops here.
    // Cloudflare's own words go in the log: its refusals don't always match the usage its analytics show.
    if (res.status === 429 && /free allocation/i.test(said)) throw new OutOfBudget(`Workers AI: Cloudflare says the free allowance is used up ("${said.replace(/^(AiError: )+/, '').slice(0, 160)}"); leaving the rest for later`);
    if (!res.ok) throw new Error(`${model.id} HTTP ${res.status}: ${said}`);
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error(`${model.id} returned an empty response`);
    used.add(model.id);
    return parseJson(text);
  }

  return {
    get name() {
      return `Workers AI (${(used.size ? [...used] : [main.id]).join(' + ')})`;
    },
    get neurons() {
      return neurons;
    },
    async generateJson(prompt, schema) {
      const spent = o.budget.used + neurons;
      if (spent >= o.budget.stopAt) throw new OutOfBudget(`Workers AI: ${Math.round(spent)} neurons used in the last 24 hours; leaving the rest for later`);
      const model = spent >= o.budget.lightAt ? light : main;
      try {
        return await call(model, prompt, schema);
      } catch (err) {
        if (model === light || err instanceof OutOfBudget) throw err;
        // One more go on the light model: the big one being busy or garbled shouldn't hold up the run.
        console.log(`  ${(err as Error).message.slice(0, 120)}; trying ${light.id}`);
        return call(light, prompt, schema);
      }
    },
  };
}

const credentials = (env: NodeJS.ProcessEnv) => {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN;
  return accountId && token ? { accountId, token } : undefined;
};

export function workersAiFromEnv(budget: Budget, env = process.env): MeteredModel | undefined {
  const c = credentials(env);
  return c && workersAi({ ...c, budget });
}

/**
 * Neurons Cloudflare counts as used in the 24 hours to `now`, from its GraphQL analytics (which the Workers AI token
 * can read). Undefined when there are no credentials or it can't be read.
 */
export async function neuronsLast24h(now: Date, env = process.env, fetchFn: typeof fetch = fetch): Promise<number | undefined> {
  const c = credentials(env);
  if (!c) return undefined;
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const query = `{ viewer { accounts(filter: { accountTag: "${c.accountId}" }) {
    aiInferenceAdaptiveGroups(limit: 1, filter: { datetime_geq: "${since}" }) { sum { totalNeurons } } } } }`;
  try {
    const res = await fetchFn('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${c.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json()) as { data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[] } } };
    const groups = body.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (!res.ok || !groups) return undefined;
    return groups[0]?.sum?.totalNeurons ?? 0;
  } catch {
    return undefined;
  }
}
