import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const comfyServerDirectory = new URL('../src/lib/server/', import.meta.url);
const sourceDirectory = new URL('../src/', import.meta.url);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) return sourceFiles(url);
    if (!entry.isFile() || !/\.(?:ts|js|svelte)$/.test(entry.name)) return [];
    return [{ filename: decodeURIComponent(url.pathname), source: await readFile(url, 'utf8') }];
  }));
  return nested.flat();
}

async function comfyServerSources() {
  const filenames = (await readdir(comfyServerDirectory))
    .filter((name) => /^comfy-.*\.ts$/.test(name))
    .sort();
  return Promise.all(filenames.map(async (filename) => ({
    filename,
    source: await readFile(new URL(filename, comfyServerDirectory), 'utf8')
  })));
}

function cancellationFunction(source) {
  const declaration = source.indexOf('async function cancelComfyJob');
  assert.notEqual(declaration, -1, 'queued Comfy integration must define targeted failure cancellation');
  const openingBrace = source.indexOf('{', declaration);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(declaration, index + 1);
  }
  assert.fail('targeted Comfy cancellation function is incomplete');
}

test('shared Comfy integrations contain no global install or service mutations', async () => {
  const implementations = await comfyServerSources();
  assert.ok(implementations.length > 0, 'expected at least one production Comfy integration');

  const forbiddenGlobalRoutes = [
    /\/(?:interrupt|free|queue)(?:[/?'"`]|$)/,
    /\/(?:manager|customnode|install|restart|unload|cleanup|delete)(?:[/?'"`]|$)/,
    /\/api\/(?:queue|manager|userdata)(?:[/?'"`]|$)/
  ];

  for (const { filename, source } of implementations) {
    const requestLines = source.split('\n').filter((line) => /\bfetcher\s*\(\s*endpoint\s*\(\s*baseUrl\s*,/.test(line));
    for (const line of requestLines) {
      for (const pattern of forbiddenGlobalRoutes) {
        assert.doesNotMatch(line, pattern, `${filename} must not mutate the shared Comfy service globally`);
      }
    }

    assert.doesNotMatch(source, /\b(?:unload_models|free_memory|clear_queue|delete_outputs)\b/, `${filename} must not send global service-mutation flags`);
    assert.doesNotMatch(source, /method\s*:\s*['"]DELETE['"]/, `${filename} must not clean up shared Comfy outputs`);
    assert.doesNotMatch(source, /from\s+['"]node:(?:child_process|fs(?:\/promises)?)['"]/, `${filename} must not mutate the Comfy installation or output store`);
  }
});

test('production code cannot manage Comfy processes or installation-wide roots', async () => {
  const implementations = await sourceFiles(sourceDirectory);
  const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const executableSurface = [
    ...implementations,
    { filename: 'package.json', source: packageJson }
  ];
  const prohibited = [
    /\b(?:systemctl|launchctl|service)\s+(?:--user\s+)?(?:start|stop|restart|enable|disable|daemon-reload)\b/,
    /--(?:input|output)-directory\b/,
    /\bCOMFY(?:UI)?_(?:INPUT|OUTPUT|MODEL|CUSTOM_NODE)_?(?:DIR|DIRECTORY|ROOT|PATH)\b/,
    /from\s+['"]node:child_process['"]/,
    /\b(?:exec|execFile|spawn|fork)Sync?\s*\(/
  ];

  for (const { filename, source } of executableSurface) {
    for (const pattern of prohibited) {
      assert.doesNotMatch(source, pattern, `${filename} must not control a shared Comfy process or global root`);
    }
  }
});

test('every queued failure cancels only the prompt ID returned by Comfy', async () => {
  const implementations = (await comfyServerSources()).filter(({ source }) => /['"]\/prompt['"]/.test(source));
  assert.ok(implementations.length > 0, 'expected queued production Comfy integrations');

  for (const { filename, source } of implementations) {
    const cancellation = cancellationFunction(source);
    assert.match(cancellation, /\/api\/jobs\//, `${filename} cancellation must use the job route`);
    assert.match(cancellation, /encodeURIComponent\(id\)/, `${filename} cancellation must bind the returned prompt ID`);
    assert.match(cancellation, /\/cancel/, `${filename} cancellation must target that job only`);
    assert.match(cancellation, /method\s*:\s*['"]POST['"]/, `${filename} cancellation must post to the targeted route`);

    const failureCalls = [...source.matchAll(/cancelComfyJob\s*\(\s*fetcher\s*,\s*baseUrl\s*,\s*([^\s,)]+)\s*\)/g)];
    assert.ok(failureCalls.length > 0, `${filename} must cancel an incomplete prompt on failure`);
    for (const call of failureCalls) {
      assert.equal(call[1], 'id', `${filename} must pass only its own returned prompt ID to cancellation`);
      const guard = source.slice(Math.max(0, call.index - 80), call.index);
      assert.match(guard, /if\s*\(\s*id\s*&&\s*![A-Za-z]+\s*\)\s*await\s*$/, `${filename} must cancel only after a queued prompt remains incomplete`);
    }
  }
});
