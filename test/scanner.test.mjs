import test from 'node:test';
import assert from 'node:assert/strict';

test('package exposes the Codex package identity', async () => {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  assert.equal(pkg.default.name, 'dsh-plugin-wallpaper-engine-codex');
  assert.equal(pkg.default.license, 'MIT');
});

test('generated client artifact uses the package id', async () => {
  const { readFile } = await import('node:fs/promises');
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.match(client, /dsh-plugin-wallpaper-engine-codex/);
  assert.match(client, /__ModuleLoader__\.load/);
});
