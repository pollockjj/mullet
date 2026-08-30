import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
const portraitVideoSource = readFileSync(new URL('../src/lib/portrait-video.ts', import.meta.url), 'utf8');
const portraitMotionPanel = pageSource.match(
  /<section class="portrait-panel motion-panel" aria-label="Generated portrait motion">[\s\S]*?<\/section>/
)?.[0] ?? '';

test('generated expression stage is fixed 9:16 at the 0.5 MP default with no aspect selector', () => {
  assert.match(pageSource, /const portraitAspectRatio: PortraitAspectRatio = '9:16';/);
  assert.match(pageSource, /let portraitMegapixels: PortraitMegapixels = 0\.5;/);
  assert.match(pageSource, /\.portrait\.generated \{ aspect-ratio: 9 \/ 16; border-color:/);
  assert.match(pageSource, /portraitMegapixelsStorageKey = 'mullet\.portrait-megapixels\.v4'/);
  assert.doesNotMatch(pageSource, /bind:value=\{portraitAspectRatio\}/);
  assert.doesNotMatch(pageSource, /aria-label="Portrait aspect ratio"/);
  assert.doesNotMatch(pageSource, /portraitDisplayAspectRatio/);
  assert.doesNotMatch(pageSource, /style:--portrait-aspect-ratio/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-aspect/);
  assert.match(pageSource, /aria-label="Inline scene aspect ratio"/);
});

test('portrait image models are one additive persisted inventory, not a replacement slot', () => {
  assert.match(pageSource, /portraitModelTemplateStorageKey = 'mullet\.portrait-model-template\.v1'/);
  assert.match(pageSource, /bind:value=\{portraitModelTemplate\}/);
  assert.match(pageSource, /aria-label="Portrait image model"/);
  assert.match(pageSource, /\{#each portraitCapabilities\.templates as capability\}/);
  assert.match(pageSource, /<option value=\{capability\.template\.id\}>/);
  assert.doesNotMatch(pageSource, /value=\{capability\.template\.id\} disabled=/);
  assert.match(pageSource, /` · unavailable · missing \$\{capability\.missing\.join\(', '\)\}`/);
  assert.match(pageSource, /missing \$\{selectedPortraitCapability\.missing\.join\(', '\)\}/);
  assert.match(pageSource, /localStorage\.setItem\(portraitModelTemplateStorageKey, portraitModelTemplate\)/);
  assert.doesNotMatch(pageSource, /portraitCapabilities\.referenceTemplate/);
});

test('portrait motion defaults to the bound LTX template and persists a real additive video-model selection', () => {
  assert.match(portraitVideoSource, /export const PORTRAIT_VIDEO_TEMPLATE_ID = LTX25_PORTRAIT_VIDEO_TEMPLATE_ID;/);
  assert.match(portraitVideoSource, /export const PORTRAIT_VIDEO_DURATION_SECONDS = 2 as const;/);
  assert.match(pageSource, /let portraitVideoModelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID;/);
  assert.match(pageSource, /let portraitVideoDurationSeconds: PortraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATION_SECONDS;/);
  assert.match(pageSource, /portraitVideoModelTemplateStorageKey = 'mullet\.portrait-video-model-template\.v1'/);
  assert.match(portraitMotionPanel, /bind:value=\{portraitVideoModelTemplate\}/);
  assert.match(portraitMotionPanel, /on:change=\{persistPortraitVideoModelTemplate\}/);
  assert.match(portraitMotionPanel, /aria-label="Portrait video model"/);
  assert.match(portraitMotionPanel, /\{#each portraitVideoCapabilities\.templates as capability\}/);
  assert.match(portraitMotionPanel, /<option value=\{capability\.template\.id\}>/);
  assert.doesNotMatch(portraitMotionPanel, /value=\{capability\.template\.id\} disabled=/);
  assert.match(pageSource, /localStorage\.setItem\(portraitVideoModelTemplateStorageKey, portraitVideoModelTemplate\)/);
});

test('selected portrait-video template controls modes and durations without hiding unavailable options', () => {
  assert.match(pageSource, /portraitVideoTemplateCapability\(\s*portraitVideoCapabilities,\s*portraitVideoModelTemplate\s*\)/);
  assert.match(portraitMotionPanel, /\{#each selectedPortraitVideoTemplateCapability\?\.modes \?\? \[\] as mode\}/);
  assert.match(portraitMotionPanel, /\{#each selectedPortraitVideoTemplateCapability\?\.durations \?\? \[\] as duration\}/);
  assert.match(portraitMotionPanel, /<option value=\{mode\.id\}>/);
  assert.doesNotMatch(portraitMotionPanel, /value=\{mode\.id\} disabled=/);
  assert.match(portraitMotionPanel, /` · unavailable · missing \$\{mode\.missing\.join\(', '\)\}`/);
  assert.match(portraitMotionPanel, /` · unavailable · missing \$\{capability\.missing\.join\(', '\)\}`/);
  assert.match(pageSource, /missing \$\{selectedPortraitVideoModeCapability\.missing\.join\(', '\)\}/);
  assert.match(pageSource, /buildPortraitVideoRequest\(portrait, aspectRatio, imageSha256, mode, durationSeconds, modelTemplate\)/);
  assert.match(pageSource, /portraitVideoModeAvailable\(\s*portraitVideoCapabilities,\s*selectedRequest\.mode,\s*selectedRequest\.modelTemplate\s*\)/);
  assert.match(pageSource, /!portraitVideoSelectedModeAvailable \|\| !portraitMotionEnabled/);
});

test('a scenario uses the selected available model and supplies identity only to reference editors', () => {
  assert.match(pageSource, /if \(!result \|\| !current \|\| !modelAvailable\) return null;/);
  assert.match(pageSource, /portraitModelTemplateAvailable\(portraitCapabilities, portraitModelTemplate\)/);
  assert.match(pageSource, /referenceImage: modelUsesReference \? profile\.referenceImage : null/);
  assert.match(pageSource, /promptOverride: modelUsesReference\s+\? profile\.expressionPrompts\[result\.output\.expression\] \?\? null\s+: null/);
  assert.match(pageSource, /if \(modelUsesReference\) return null;/);
  assert.match(pageSource, /Canonical reference · \$\{scenarioPortraitProfile\.referenceImage\.width\}×\$\{scenarioPortraitProfile\.referenceImage\.height\} · \$\{scenarioPortraitProfile\.referenceImage\.aspectRatio\}/);
  assert.doesNotMatch(pageSource, /referenceTemplateAvailable/);
  assert.doesNotMatch(pageSource, /No scenario expression portrait will be generated/);
});
