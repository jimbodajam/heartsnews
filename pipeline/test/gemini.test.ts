// Gemini running out of quota (25 Oct): once both models had said "come back tomorrow", the next request threw
// nothing at all, and the error handling around it crashed the build instead of falling back to templates.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geminiFromEnv } from '../src/script/llm.ts';

test('with every model out of quota for the day, a request fails with an error that says so', async () => {
  const realFetch = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY;
  let calls = 0;
  process.env.GEMINI_API_KEY = 'test';
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota', details: [{ retryDelay: '14400s' }] } }), { status: 429 });
  }) as typeof fetch;
  try {
    const model = geminiFromEnv([1_000, 1_000], ['quota-test-flash', 'quota-test-lite'])!;
    await assert.rejects(model.generateJson('Say hi', {}), /quota/i);
    const before = calls;
    // Both are now known to be out for the day: no more calls, and a real error rather than `undefined`.
    const err = await model.generateJson('Say hi', {}).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    assert.match(err.message, /quota-test-flash and quota-test-lite out of quota for today/);
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
  }
});
