// Repository-owned browser check.
// This is the evidence for a milestone. `node --test` is not.
// It boots a real Chrome against a served build, waits for the app to actually be
// interactive, drives it, and records what is on the screen plus how long it took.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const DEFAULT_URL = process.env.MULLET_CHECK_URL ?? 'http://127.0.0.1:8781/mullet/';

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

// The app server-renders the shell, so an <h1> exists long before Svelte hydrates and
// long before the ComfyUI capability probes populate the model selectors. Driving the
// UI in that window silently does nothing. Gate on a control that only exists after
// hydration AND after capabilities land.
const INTERACTIVE = `Boolean(
  document.querySelector('select[aria-label="Portrait image model"]')
  && document.querySelector('select[aria-label="Portrait video model"]')
  && !/Connecting…/.test(document.body.textContent)
)`;

// Read the panels the operator actually looks at, by the aria-labels the markup already
// exposes. No data-* instrumentation: these labels are the accessibility contract.
const READ_PANELS = `(() => {
  const text = (node) => (node ? node.textContent.trim().replace(/\\s+/g, ' ') : null);
  const panel = (label) => document.querySelector('[aria-label="' + label + '"]');
  const selectState = (label) => {
    const element = document.querySelector('select[aria-label="' + label + '"]');
    if (!element) return null;
    const selected = element.options[element.selectedIndex];
    return {
      selected: selected ? selected.textContent.trim() : null,
      value: element.value,
      options: [...element.options].map((option) => option.textContent.trim())
    };
  };
  const media = (label) => {
    const root = panel(label);
    if (!root) return null;
    const image = root.querySelector('img');
    const video = root.querySelector('video');
    return {
      image: image
        ? { src: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight, complete: image.complete }
        : null,
      video: video
        ? {
            src: video.currentSrc || video.src,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            readyState: video.readyState,
            paused: video.paused,
            muted: video.muted,
            hasAudio: Boolean(video.mozHasAudio ?? (video.webkitAudioDecodedByteCount > 0) ?? null)
          }
        : null
    };
  };
  return {
    title: document.title,
    heading: text(document.querySelector('h1')),
    panels: {
      expressionSidecar: text(panel('Expression sidecar')),
      expressionPortrait: text(panel('Generated expression portrait')),
      portraitMotion: text(panel('Generated portrait motion')),
      inlineScene: text(panel('Inline landscape scene'))
    },
    selectors: {
      portraitImageModel: selectState('Portrait image model'),
      portraitMegapixels: selectState('Portrait megapixels'),
      portraitVideoModel: selectState('Portrait video model'),
      portraitVideoMode: selectState('Portrait video mode'),
      portraitVideoDuration: selectState('Portrait video duration'),
      inlineSceneStillModel: selectState('Inline scene still model'),
      inlineSceneVideoModel: selectState('Inline scene video model'),
      inlineSceneAspectRatio: selectState('Inline scene aspect ratio'),
      bundledScenario: selectState('Bundled scenario'),
      startingScenario: selectState('Starting scenario')
    },
    media: {
      expressionPortrait: media('Generated expression portrait'),
      portraitMotion: media('Generated portrait motion'),
      inlineScene: media('Inline landscape scene')
    },
    toggles: [...document.querySelectorAll('input[type="checkbox"]')].map((box) => ({
      label: (box.closest('label')?.textContent ?? box.getAttribute('aria-label') ?? '').trim().replace(/\\s+/g, ' '),
      checked: box.checked
    })),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => text(node))
  };
})()`;

async function main() {
  const url = argValue('url', DEFAULT_URL);
  const outDir = argValue('out', 'scratch/browser-check');
  const scenario = argValue('scenario');
  const starter = argValue('starter');
  const headless = !hasFlag('headed');
  const startedAt = Date.now();

  await mkdir(outDir, { recursive: true });
  const { page, close } = await launch({ headless });

  const record = { url, headless, timings: {}, drove: {}, ok: false };

  try {
    const navigationStarted = Date.now();
    await page.goto(url, { timeoutMs: 45_000 });
    record.timings.navigateMs = Date.now() - navigationStarted;

    record.timings.shellVisibleMs = await page.waitFor('document.querySelector("h1")', {
      timeoutMs: 30_000,
      label: 'server-rendered shell'
    });

    // Everything below depends on this. Do not drive before it resolves.
    record.timings.interactiveMs = await page
      .waitFor(INTERACTIVE, { timeoutMs: 60_000, label: 'hydration and ComfyUI capabilities' })
      .catch((error) => {
        record.notInteractive = error.message;
        return null;
      });

    if (record.timings.interactiveMs !== null) {
      if (scenario) {
        record.drove.scenario = await page.selectByText('Bundled scenario', scenario);
        await page.waitFor('true', { timeoutMs: 1_000, pollMs: 250 }).catch(() => {});
      }
      if (starter) {
        record.drove.starter = await page.clickText('button', starter);
        record.timings.starterSettledMs = await page
          .waitFor(INTERACTIVE, { timeoutMs: 30_000, label: 'capabilities after starter' })
          .catch(() => null);
      }
    }

    record.observed = await page.evaluate(READ_PANELS);

    await page.screenshot(join(outDir, 'app.png'));
    await page.screenshot(join(outDir, 'app-full.png'), { fullPage: true });
    record.screenshot = join(outDir, 'app.png');
    record.screenshotFull = join(outDir, 'app-full.png');

    record.console = page.consoleMessages.filter((entry) => entry.level === 'error');
    record.pageErrors = page.pageErrors;
    record.failedRequests = page.failedRequests;

    const blocking = [];
    if (record.notInteractive) blocking.push(`never became interactive: ${record.notInteractive}`);
    if (!record.observed.heading) blocking.push('no h1 rendered');
    if (record.pageErrors.length > 0) blocking.push(`${record.pageErrors.length} uncaught page error(s)`);
    for (const alert of record.observed.alerts) blocking.push(`alert: ${alert}`);
    if (scenario && record.drove.scenario === false) blocking.push(`could not select scenario "${scenario}"`);
    if (starter && record.drove.starter === false) blocking.push(`could not click starter "${starter}"`);

    // A selector offering an option marked unavailable is not fatal, but it is the
    // exact condition that silently demotes a default. Always surface it.
    for (const [name, state] of Object.entries(record.observed.selectors)) {
      if (!state) continue;
      const unavailable = state.options.filter((option) => option.includes('unavailable'));
      if (unavailable.length > 0) {
        record.unavailableOptions = { ...(record.unavailableOptions ?? {}), [name]: unavailable };
      }
    }

    record.blocking = blocking;
    record.ok = blocking.length === 0;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    try {
      await page.screenshot(join(outDir, 'failure.png'));
      record.screenshot = join(outDir, 'failure.png');
    } catch {}
  } finally {
    record.timings.totalMs = Date.now() - startedAt;
    await close();
  }

  await writeFile(join(outDir, 'check.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
  process.exit(record.ok ? 0 : 1);
}

await main();
