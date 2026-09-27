import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('document key wraps each Svelte Flow provider', () => {
  const source = readFileSync(new URL('../src/components/GeometryWorkspace.svelte', import.meta.url), 'utf8');
  const keyStart = source.indexOf('{#key');
  const providerStart = source.indexOf('<SvelteFlowProvider>');
  const providerEnd = source.indexOf('</SvelteFlowProvider>');
  const keyEnd = source.indexOf('{/key}');

  assert.ok(keyStart !== -1 && keyStart < providerStart, 'key block must start before provider');
  assert.ok(providerEnd !== -1 && providerEnd < keyEnd, 'key block must end after provider');
});
