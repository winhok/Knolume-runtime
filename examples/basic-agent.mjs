import assert from 'node:assert/strict';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { agentLoop } from '../dist/harness/agent/loop.js';

// Deterministic model: this example requires no credentials or network calls.
const model = new MockLanguageModelV4({
  doStream: async () => ({ stream: simulateReadableStream({ chunks: [
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: 'Hello from Knolume Runtime!' },
    { type: 'text-end', id: 'answer' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } } },
  ] }) }),
});
const events = [];
const result = await agentLoop({
  model,
  toolRuntime: { getTools: () => ({}) },
  messages: [{ role: 'user', content: 'Say hello' }],
  system: 'Answer briefly.',
  eventSink: (event) => { events.push(event.type); },
});
assert.equal(result.text, 'Hello from Knolume Runtime!');
assert.equal(result.termination, 'completed');
assert.ok(events.includes('run_started'));
console.log(result.text);
console.log(events.join(' → '));
