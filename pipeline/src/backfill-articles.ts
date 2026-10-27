import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { summariseEach } from './article-summary.ts';
import { loadArticlesToSummarise, storeFromEnv } from './store.ts';
import { parseJson } from './workers-ai.ts';

// Issue #52's one-off backfill: summarises every long article the store still has text for and no summary, on a local
// Ollama model, so the first pass doesn't spend the Workers AI allowance the ingest reads with. Run at home, once:
//   npm run backfill:articles [-- --model qwen3:8b --limit 5]
// Needs STORE_TOKEN (in .env) and Ollama running (OLLAMA_HOST, default http://localhost:11434). New articles are
// summarised by the ingest on Workers AI as before.

const ROOT = resolve(import.meta.dirname, '../..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

export function ollama(model: string, host = process.env.OLLAMA_HOST || 'http://localhost:11434') {
  return {
    async generateJson(prompt: string, schema: object): Promise<unknown> {
      const res = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: `${prompt}\n\nReply with one JSON object only.` }],
          format: schema,
          stream: false,
          think: false,
          options: { temperature: 0.2, num_ctx: 8_192 },
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string };
      if (!res.ok) throw new Error(`Ollama ${model} HTTP ${res.status}: ${body.error ?? ''}`);
      return parseJson(body.message?.content ?? '');
    },
  };
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const store = storeFromEnv();
  if (!store) throw new Error('No STORE_TOKEN set.');
  const model = arg('model') ?? 'qwen3:8b';
  const waiting = await loadArticlesToSummarise(store, new Date(), Number(arg('limit') ?? 1_000));
  console.log(`${waiting.length} long articles to summarise on ${model}.`);
  const started = Date.now();
  const done = await summariseEach(store, ollama(model), waiting, console.log);
  console.log(`Summarised ${done} of ${waiting.length} in ${Math.round((Date.now() - started) / 1000)}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
