// Repository-owned browser check.
// This is the evidence for a milestone. `node --test` is not.
// It boots a real Chrome against a served build, waits for the app to actually be
// interactive, drives it, and records what is on the screen plus how long it took.
//
// Modes:
//   (none)               load, select scenario/starter, read the panels, screenshot
//   --generate portrait  click "Generate portrait" and time click-to-visible
//   --generate loop      the whole loop from the starter click: label, portrait, caption,
//                        portrait motion, scene clip (a single reference-to-video clip in
//                        the scene card; there is no scene still any more), then reload
//                        the page in the same profile and prove that every media item
//                        comes back from storage without a new generation
//   --generate scene     (legacy) scene clip only
//   --turn "text"        after the first loop lands, send one chat turn and time the
//                        stages again from the send click (two consecutive scene clips)
//   --storage key=value  set a localStorage entry (repeatable) before the app mounts, e.g.
//                        --storage mullet.inline-scene-megapixels=0.5 to pair a setting
//                        that has no UI control any more
//
// Every multipart POST to 127.0.0.1 is rejected by the ORIGIN check, so the default URL
// is the real origin. Override with MULLET_CHECK_URL or --url.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './cdp.mjs';

const DEFAULT_URL = process.env.MULLET_CHECK_URL ?? 'https://barracuda.meteor-tegu.ts.net/mullet/';
const GENERATION_ROUTES = ['/api/portrait', '/api/portrait/video', '/api/scene', '/api/scene/video'];

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argValues(name) {
  const values = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}` && index < process.argv.length - 1) values.push(process.argv[index + 1]);
  });
  return values;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// The app server-renders the shell, so an <h1> exists long before Svelte hydrates and
// long before the ComfyUI capability probes populate the model selectors. Driving the
// UI in that window silently does nothing. Gate on a control that only exists after
// hydration AND after capabilities land.
const INTERACTIVE = `Boolean(
  document.querySelector('[aria-label="Media"]')
  && document.querySelector('button.scenario-starter')
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
      : label === 'Inline landscape scene'
        ? document.querySelector('.scene-card')
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
      media: text(panel('Media'))
    },
    selectors: {
      bundledScenario: selectState('Bundled scenario'),
      inlineSceneAspectRatio: selectState('Inline scene aspect ratio')
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

// Predicates for each media item, as the operator sees them.
const PORTRAIT_IMAGE = `(() => { const i = document.querySelector('.portrait img'); return i && i.complete && i.naturalWidth > 0; })()`;
const PORTRAIT_VIDEO = `(() => { const v = document.querySelector('.portrait video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`;
const SCENE_IMAGE = `(() => { const i = document.querySelector('.scene-card img'); return i && i.complete && i.naturalWidth > 0; })()`;
const SCENE_VIDEO = `(() => { const v = document.querySelector('.scene-card video'); return v && v.readyState >= 2 && v.videoWidth > 0; })()`;
const EXPRESSION_LABEL = `(() => { const m = document.querySelector('[aria-label="Media"]')?.textContent ?? '';
  const match = m.replace(/\\s+/g, ' ').match(/Expression\\s+([a-z]+)/i);
  return match && !/^determining$/i.test(match[1]) ? match[1] : ''; })()`;

// "Continuity current · <caption>" from the Media panel text, or '' when absent.
function continuityFromPanel(text) {
  const match = (text ?? '').match(/Continuity ([^·]+?)(?: · (.*?))? Turn media off/);
  return match ? { status: match[1].trim(), caption: (match[2] ?? '').trim() } : { status: '', caption: '' };
}

function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/^\/mullet/, '');
  } catch {
    return url;
  }
}

function requestsSince(page, startedAt) {
  return page.requests.filter((request) => request.startedAt >= startedAt);
}

function generationRequests(page, startedAt) {
  return requestsSince(page, startedAt).filter((request) => (
    request.method === 'POST' && GENERATION_ROUTES.includes(pathOf(request.url))
  ));
}

function firstRequest(page, startedAt, path, method = 'POST') {
  return requestsSince(page, startedAt).find((request) => request.method === method && pathOf(request.url) === path) ?? null;
}

async function waitStage(page, record, name, expression, { timeoutMs, pollMs, since }) {
  try {
    await page.waitFor(expression, { timeoutMs, pollMs, label: name });
    record.timings[name] = Date.now() - since;
    return true;
  } catch (error) {
    record.stages[name] = error.message;
    return false;
  }
}

async function main() {
  const url = argValue('url', DEFAULT_URL);
  const outDir = argValue('out', 'scratch/browser-check');
  const scenario = argValue('scenario');
  const starter = argValue('starter');
  const headless = !hasFlag('headed');
  const generate = argValue('generate');
  const settleMs = Number(argValue('settle', '30000'));
  const startedAt = Date.now();

  await mkdir(outDir, { recursive: true });
  const { page, close } = await launch({ headless });
  // A check that dies mid-run must not leave a Chrome behind, submitting to the lanes.
  const teardown = () => { void close().finally(() => process.exit(130)); };
  process.once('SIGINT', teardown);
  process.once('SIGTERM', teardown);

  const record = { url, headless, timings: {}, drove: {}, stages: {}, ok: false };

  try {
    const navigationStarted = Date.now();
    await page.goto(url, { timeoutMs: 45_000 });
    record.timings.navigateMs = Date.now() - navigationStarted;

    // Settings without a UI control are seeded into storage, then the page is loaded
    // again so the app reads them on mount exactly as a returning browser would.
    const storage = argValues('storage').map((entry) => entry.split(/=(.*)/s).slice(0, 2));
    if (storage.length > 0) {
      record.drove.storage = Object.fromEntries(storage);
      await page.evaluate(`(() => { ${storage.map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join(' ')} return true; })()`);
      await page.goto(url, { timeoutMs: 45_000 });
    }

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

    let starterClickedAt = null;
    if (record.timings.interactiveMs !== null) {
      // Media is always on; there are no per-feature toggles left to click.
      record.drove.mediaState = await page.evaluate(
        `document.querySelector('[aria-label="Media"] strong')?.textContent.trim() ?? null`
      );
      if (scenario) {
        record.drove.scenario = await page.selectByText('Bundled scenario', scenario);
        await delay(250);
      }
      if (starter) {
        await page.evaluate('window.confirm = () => true; true');
        starterClickedAt = Date.now();
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
    if (generate === 'portrait' && record.timings.interactiveMs !== null) {
      record.generate = {};
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
        await delay(1_500);
      }

      // An image may already be on screen (card avatar, or a restored portrait).
      // Measure the arrival of a NEW one, not the presence of any.
      const previousSrc = await page.evaluate(`document.querySelector('.portrait img')?.src ?? ''`);
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

    // The whole loop, timed from the starter click, then a reload that must restore
    // every item from storage and submit nothing.
    if (generate === 'loop' && record.timings.interactiveMs !== null && starterClickedAt !== null) {
      const since = starterClickedAt;
      record.loop = {};

      // [0] the label shows up in the Media panel as "Expression <label>".
      if (await waitStage(page, record, 'expressionLabelMs', `${EXPRESSION_LABEL} !== ''`, { timeoutMs: 120_000, pollMs: 500, since })) {
        record.loop.expression = await page.evaluate(EXPRESSION_LABEL);
      }
      // [1]-[4] arrive in whatever order the lanes allow, so every stage is watched at
      // once and each records the moment it actually appeared. The scene stage is the
      // clip itself: the scene card carries only <video class="scene-motion">.
      const captionWatch = (async () => {
        const captionDeadline = Date.now() + 400_000;
        while (Date.now() < captionDeadline) {
          const caption = firstRequest(page, since, '/api/sidecar/caption');
          if (caption && caption.finishedAt) {
            record.timings.captionStartedMs = caption.startedAt - since;
            record.timings.captionRoundTripMs = caption.finishedAt - caption.startedAt;
            record.loop.captionStatus = caption.status;
            return;
          }
          await delay(500);
        }
        record.stages.caption = 'no completed caption request within 400 s of the starter click';
      })();
      await Promise.all([
        waitStage(page, record, 'portraitVisibleMs', PORTRAIT_IMAGE, { timeoutMs: 360_000, pollMs: 250, since }),
        captionWatch,
        waitStage(page, record, 'portraitMotionMs', PORTRAIT_VIDEO, { timeoutMs: 400_000, pollMs: 1_000, since }),
        waitStage(page, record, 'sceneMotionMs', SCENE_VIDEO, { timeoutMs: 900_000, pollMs: 2_000, since })
      ]);

      record.loop.generationRequests = generationRequests(page, since).map((request) => ({
        path: pathOf(request.url), status: request.status, startedMs: request.startedAt - since,
        durationMs: request.finishedAt ? request.finishedAt - request.startedAt : null
      }));
      record.loop.beforeReload = await page.evaluate(READ_PANELS);
      record.loop.continuity = continuityFromPanel(record.loop.beforeReload?.panels?.media);
      if (record.loop.continuity.status !== 'current' || !record.loop.continuity.caption) {
        record.stages.continuity = `Media panel shows continuity "${record.loop.continuity.status}" with caption "${record.loop.continuity.caption}"`;
      }
      await page.screenshot(join(outDir, 'loop.png'));

      // A second turn in the same place: the next scene must land the same way and carry
      // the caption of the portrait made for that turn.
      const turnText = argValue('turn');
      if (turnText) {
        record.turn = {};
        const previous = await page.evaluate(`(() => ({
          portrait: document.querySelector('.portrait img')?.src ?? '',
          sceneVideo: document.querySelector('.scene-card video')?.currentSrc ?? ''
        }))()`);
        record.turn.typed = await page.evaluate(`(() => {
          const area = document.querySelector('textarea[aria-label="Message"]');
          if (!area || area.disabled) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(area, ${JSON.stringify(turnText)});
          area.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await delay(300);
        const sentAt = Date.now();
        record.turn.sent = await page.clickText('button.send', 'send');
        if (record.turn.sent) {
          const turnRecord = { timings: {}, stages: {} };
          // Streaming ends when the Stop button gives way to Send again.
          try {
            turnRecord.timings.responseMs = await page.waitFor(
              `(() => !document.querySelector('button.stop') && document.querySelector('button.send'))()`,
              { timeoutMs: 300_000, pollMs: 500, label: 'second response finalized' }
            );
          } catch (error) { turnRecord.stages.response = error.message; }
          const newSrc = (selector, attribute, before) => `(() => { const n = document.querySelector(${JSON.stringify(selector)});
            return n && (n.${attribute} || '') !== ${JSON.stringify(before)} && ${attribute === 'src' ? 'n.complete && n.naturalWidth > 0' : 'n.readyState >= 2 && n.videoWidth > 0'}; })()`;
          const since = sentAt;
          const captionsBefore = page.requests.filter((request) => request.method === 'POST' && pathOf(request.url) === '/api/sidecar/caption').length;
          await Promise.all([
            waitStage(page, turnRecord, 'portraitVisibleMs', newSrc('.portrait img', 'src', previous.portrait), { timeoutMs: 360_000, pollMs: 250, since }),
            waitStage(page, turnRecord, 'portraitMotionMs', PORTRAIT_VIDEO, { timeoutMs: 400_000, pollMs: 1_000, since }),
            waitStage(page, turnRecord, 'sceneMotionMs', newSrc('.scene-card video', 'currentSrc', previous.sceneVideo), { timeoutMs: 900_000, pollMs: 2_000, since })
          ]);
          turnRecord.captionRequests = page.requests.filter((request) => request.method === 'POST' && pathOf(request.url) === '/api/sidecar/caption').length - captionsBefore;
          turnRecord.generationRequests = generationRequests(page, since).map((request) => ({
            path: pathOf(request.url), status: request.status, startedMs: request.startedAt - since,
            durationMs: request.finishedAt ? request.finishedAt - request.startedAt : null
          }));
          turnRecord.mediaPanel = await page.evaluate(`document.querySelector('[aria-label="Media"]')?.textContent.replace(/\\s+/g,' ').trim().slice(0,600) ?? null`);
          turnRecord.continuity = continuityFromPanel(turnRecord.mediaPanel);
          if (turnRecord.continuity.status !== 'current' || !turnRecord.continuity.caption) {
            turnRecord.stages.continuity = `second turn shows continuity "${turnRecord.continuity.status}" with caption "${turnRecord.continuity.caption}"`;
          }
          for (const [stage, error] of Object.entries(turnRecord.stages)) record.stages[`turn2:${stage}`] = error;
          record.turn = { ...record.turn, ...turnRecord };
          await page.screenshot(join(outDir, 'turn2.png'));
        } else {
          record.stages['turn2:send'] = 'could not send the second turn';
        }
      }

      // Reload in the same profile: everything must come back from storage, and no
      // generation may be submitted. A caption re-run is tolerated but recorded. The
      // scene card holds only the clip now, so sceneImage is observed, never required.
      const reloadAt = Date.now();
      await page.goto(url, { timeoutMs: 45_000 });
      await page.evaluate('window.confirm = () => true; window.alert = () => undefined; true');
      record.timings.reloadInteractiveMs = await page
        .waitFor(INTERACTIVE, { timeoutMs: 60_000, label: 'interactive after reload' })
        .catch((error) => { record.stages.reloadInteractive = error.message; return null; });
      await delay(settleMs);
      record.reload = {
        settleMs,
        portraitImage: await page.evaluate(PORTRAIT_IMAGE),
        portraitVideo: await page.evaluate(PORTRAIT_VIDEO),
        sceneImage: await page.evaluate(SCENE_IMAGE),
        sceneVideo: await page.evaluate(SCENE_VIDEO),
        generationRequests: generationRequests(page, reloadAt).map((request) => ({
          path: pathOf(request.url), status: request.status, startedMs: request.startedAt - reloadAt
        })),
        captionRequests: requestsSince(page, reloadAt)
          .filter((request) => request.method === 'POST' && pathOf(request.url) === '/api/sidecar/caption').length,
        mediaPanel: await page.evaluate(`document.querySelector('[aria-label="Media"]')?.textContent.replace(/\\s+/g,' ').trim().slice(0,320) ?? null`)
      };
      for (const item of ['portraitImage', 'portraitVideo', 'sceneVideo']) {
        if (!record.reload[item]) record.stages[`reload:${item}`] = `${item} not restored within ${settleMs} ms of reload`;
      }
      if (record.reload.generationRequests.length > 0) {
        record.stages['reload:regeneration'] = `${record.reload.generationRequests.length} generation request(s) submitted after reload: ` +
          record.reload.generationRequests.map((request) => request.path).join(', ');
      }
    }

    // (legacy) scene clip only.
    if (generate === 'scene' && record.timings.interactiveMs !== null) {
      record.scene = {};
      const sceneStart = Date.now();
      await waitStage(page, record, 'sceneMotionMs', SCENE_VIDEO, { timeoutMs: 900_000, pollMs: 2_000, since: sceneStart });
      record.scene.mediaPanel = await page.evaluate(
        `document.querySelector('[aria-label="Media"]')?.textContent.replace(/\\s+/g,' ').trim().slice(0,320) ?? null`
      );
    }

    record.observed = await page.evaluate(READ_PANELS);

    await page.screenshot(join(outDir, 'app.png'));
    await page.screenshot(join(outDir, 'app-full.png'), { fullPage: true });
    record.screenshot = join(outDir, 'app.png');
    record.screenshotFull = join(outDir, 'app-full.png');

    record.console = page.consoleMessages.filter((entry) => entry.level === 'error');
    record.pageErrors = page.pageErrors;
    record.failedRequests = page.failedRequests;
    record.serverErrors = page.requests
      .filter((request) => typeof request.status === 'number' && request.status >= 500)
      .map((request) => ({ method: request.method, path: pathOf(request.url), status: request.status, atMs: request.startedAt - startedAt }));

    const blocking = [];
    if (record.notInteractive) blocking.push(`never became interactive: ${record.notInteractive}`);
    if (!record.observed.heading) blocking.push('no h1 rendered');
    if (record.pageErrors.length > 0) blocking.push(`${record.pageErrors.length} uncaught page error(s)`);
    for (const alert of record.observed.alerts) blocking.push(`alert: ${alert}`);
    if (scenario && record.drove.scenario === false) blocking.push(`could not select scenario "${scenario}"`);
    if (starter && record.drove.starter === false) blocking.push(`could not click starter "${starter}"`);
    if (generate && !starter) blocking.push('--generate needs --starter');
    // A stage that did not land, a generation submitted on reload, or any 5xx from the
    // app is a failed check. "ok" means the operator would have seen the whole loop.
    for (const [stage, error] of Object.entries(record.stages)) blocking.push(`${stage}: ${error}`);
    if (record.generate?.error) blocking.push(`portrait: ${record.generate.error}`);
    for (const failure of record.serverErrors) {
      if (failure.path === '/favicon.ico') continue;
      blocking.push(`server ${failure.status} on ${failure.method} ${failure.path}`);
    }

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
    record.ok = false;
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
