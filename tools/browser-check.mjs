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
    // The generated portrait and its motion render in the sidebar .portrait element;
    // the "Generated expression portrait" panel holds only the controls.
    const root = label === 'Generated expression portrait'
      ? document.querySelector('.portrait')
      : panel(label);
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

// Enable a feature toggle by the panel it lives in, then confirm it actually flipped.
async function enablePanelToggle(page, panelLabel) {
  const selector = `[aria-label="${panelLabel}"] input[type="checkbox"]`;
  return page.evaluate(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)});
    if (!box) return 'no-toggle';
    if (box.checked) return 'already-on';
    box.click();
    return box.checked ? 'enabled' : 'click-ignored';
  })()`);
}

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

    // Scenario activation asks for confirmation when a transcript exists. Headless Chrome
    // leaves window.confirm unanswered, so the starter click silently does nothing.
    await page.evaluate('window.confirm = () => true; window.alert = () => undefined; true');

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
      // Enable expressions BEFORE the scenario loads. The classifier fires on the
      // finalized-response transition; switching it on afterwards leaves it idle.
      if (argValue('generate') === 'portrait') {
        record.drove.expressionsToggle = await enablePanelToggle(page, 'Expression sidecar');
      }
      if (scenario) {
        record.drove.scenario = await page.selectByText('Bundled scenario', scenario);
        await page.waitFor('true', { timeoutMs: 1_000, pollMs: 250 }).catch(() => {});
      }
      if (starter) {
        await page.evaluate('window.confirm = () => true; true');
        record.drove.starter = await page.clickText('button', starter);
        // Scenario activation is async (package load, lore, sidecar reset). INTERACTIVE is
        // already true, so waiting on it measures nothing. Wait for the starter button to
        // report itself pressed, which only happens once the scenario is actually active.
        record.timings.starterSettledMs = await page
          .waitFor(
            `(() => [...document.querySelectorAll('button.scenario-starter')]
                .some((b) => b.getAttribute('aria-pressed') === 'true'))()`,
            { timeoutMs: 60_000, pollMs: 250, label: 'scenario active' }
          )
          .catch((error) => {
            record.drove.starterNotActive = error.message;
            return null;
          });
      }
    }

    // Click-to-visible: the only latency number that matches what the operator feels.
    const generate = argValue('generate');
    if (generate === 'portrait' && record.timings.interactiveMs !== null) {
      record.generate = { expressionsToggle: record.drove.expressionsToggle };
      const model = argValue('model');
      if (model) record.generate.model = await page.selectByText('Portrait image model', model);
      record.generate.selectedModel = await page.evaluate(
        `(() => { const s = document.querySelector('select[aria-label="Portrait image model"]');
                  return s ? s.options[s.selectedIndex].textContent.trim() : null; })()`
      );
      // The expression classifier must land a label before the portrait can be requested.
      // Clicking before then hits a disabled button and silently measures nothing.
      record.timings.expressionLabelMs = await page
        .waitFor(
          `(() => { const b = [...document.querySelectorAll('[aria-label="Generated expression portrait"] button')]
              .find((x) => /generate portrait|regenerate portrait/i.test(x.textContent));
            return b && !b.disabled; })()`,
          { timeoutMs: 120_000, pollMs: 500, label: 'generate button enabled' }
        )
        .catch((error) => {
          record.generate.notReady = error.message;
          record.generate.sidecar = document.title;
          return null;
        });

      // MULLET submits a fixed seed, so an identical repeat request is served from
      // ComfyUI's execution cache in milliseconds. That is real product behaviour but it
      // is not the number the latency gate is about. --setting perturbs the prompt so the
      // measurement is a genuine first generation.
      const setting = argValue('setting');
      if (setting) {
        record.generate.setting = await page.evaluate(`(() => {
          const input = document.querySelector('input[aria-label="Portrait setting"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(setting)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        await page.waitFor('true', { timeoutMs: 1500, pollMs: 400 }).catch(() => {});
      }

      // An image may already be on screen (card avatar, or a restored portrait).
      // Measure the arrival of a NEW one, not the presence of any.
      const previousSrc = await page.evaluate(
        `document.querySelector('.portrait img')?.src ?? ''`
      );
      record.generate.previousSrc = previousSrc;
      const clickedAt = Date.now();
      record.generate.clicked = await page.clickText(
        '[aria-label="Generated expression portrait"] button',
        'generate portrait'
      );
      if (record.generate.clicked) {
        record.timings.clickToVisibleMs = await page
          .waitFor(
            `(() => { const i = document.querySelector('.portrait img');
                      return i && i.complete && i.naturalWidth > 0
                        && i.src !== ${JSON.stringify(previousSrc)}; })()`,
            { timeoutMs: 360_000, pollMs: 250, label: 'portrait image visible' }
          )
          .catch((error) => {
            record.generate.error = error.message;
            return null;
          });
        record.generate.elapsedMs = Date.now() - clickedAt;
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
