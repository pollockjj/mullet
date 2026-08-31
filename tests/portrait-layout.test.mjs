import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
const portraitVideoSource = readFileSync(new URL('../src/lib/portrait-video.ts', import.meta.url), 'utf8');
const portraitImagePanel = pageSource.match(
  /<section class="portrait-panel" aria-label="Generated expression portrait">[\s\S]*?<\/section>/
)?.[0] ?? '';
const portraitMotionPanel = pageSource.match(
  /<section class="portrait-panel motion-panel" aria-label="Generated portrait motion">[\s\S]*?<\/section>/
)?.[0] ?? '';
const inlineScenePanel = pageSource.match(
  /<section class="portrait-panel scene-panel" aria-label="Inline landscape scene">[\s\S]*?<\/section>/
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
  assert.match(pageSource, /portraitModelTemplateStorageKey = 'mullet\.portrait-model-template\.v3'/);
  assert.match(pageSource, /previousPortraitModelTemplateStorageKey = 'mullet\.portrait-model-template\.v2'/);
  assert.match(pageSource, /localStorage\.removeItem\(previousPortraitModelTemplateStorageKey\)/);
  assert.match(pageSource, /bind:value=\{portraitModelTemplate\}/);
  assert.match(pageSource, /aria-label="Portrait image model"/);
  assert.match(pageSource, /\{#each portraitCapabilities\.templates as capability\}/);
  assert.match(pageSource, /<option value=\{capability\.template\.id\}>/);
  assert.doesNotMatch(portraitImagePanel, /value=\{capability\.template\.id\} disabled=/);
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
  assert.match(pageSource, /portraitVideoModelTemplateStorageKey = 'mullet\.portrait-video-model-template\.v3'/);
  assert.match(pageSource, /portraitVideoModeStorageKey = 'mullet\.portrait-video-mode\.v6'/);
  assert.match(pageSource, /portraitVideoDurationStorageKey = 'mullet\.portrait-video-duration\.v6'/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-video-model-template\.v2/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-video-mode\.v5/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-video-duration\.v5/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-video-model-template\.v1/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-video-mode\.v4/);
  assert.doesNotMatch(pageSource, /mullet\.portrait-video-duration\.v4/);
  assert.match(portraitMotionPanel, /bind:value=\{portraitVideoModelTemplate\}/);
  assert.match(portraitMotionPanel, /on:change=\{persistPortraitVideoModelTemplate\}/);
  assert.match(portraitMotionPanel, /aria-label="Portrait video model"/);
  assert.match(portraitMotionPanel, /\{#each portraitVideoCapabilities\.templates as capability\}/);
  assert.match(portraitMotionPanel, /<option value=\{capability\.template\.id\}>/);
  assert.doesNotMatch(portraitMotionPanel, /value=\{capability\.template\.id\} disabled=/);
  assert.match(pageSource, /localStorage\.setItem\(portraitVideoModelTemplateStorageKey, portraitVideoModelTemplate\)/);
});

test('scene motion visibly defaults to LTX after refresh while retaining additive MiniMax selection', () => {
  assert.match(pageSource, /let inlineSceneVideoModelTemplate: InlineSceneVideoTemplateId = INLINE_SCENE_VIDEO_TEMPLATE_ID;/);
  assert.match(pageSource, /inlineSceneVideoModelTemplateStorageKey = 'mullet\.inline-scene-video-model-template\.v2'/);
  assert.doesNotMatch(pageSource, /mullet\.inline-scene-video-model-template(?:'|\.v0|\.v1)/);
  assert.match(pageSource, /savedInlineSceneVideoModelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID/);
  assert.match(pageSource, /savedInlineSceneVideoModelTemplate === MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID/);
  assert.match(pageSource, /: INLINE_SCENE_VIDEO_TEMPLATE_ID;/);
  assert.match(pageSource, /localStorage\.setItem\(inlineSceneVideoModelTemplateStorageKey, inlineSceneVideoModelTemplate\)/);
  assert.match(pageSource, /bind:value=\{inlineSceneVideoModelTemplate\}/);
  assert.match(pageSource, /on:change=\{persistInlineSceneVideoModelTemplate\}/);
  assert.match(pageSource, /\{#each inlineSceneVideoCapabilities\.templates as capability\}/);
  assert.doesNotMatch(pageSource, /value=\{capability\.template\.id\} disabled=/);
  assert.match(pageSource, /buildInlineSceneVideoRequest\(scene, modelTemplate\)/);
  assert.match(pageSource, /LTX 2\.5 Distilled · silent/);
  assert.match(pageSource, /MiniMax H3 Ref2VA · current scene \+ prior master \+ canonical cast · native audio/);
  assert.doesNotMatch(pageSource, /MiniMax H3 FL2VA Turbo/);
  assert.match(pageSource, /!inlineSceneVideoSelectedModelAvailable\}[\s\S]*?Retry scene motion models/);
  assert.match(pageSource, /on:click=\{\(\) => void loadInlineSceneVideoGenerator\(\)\}/);
});

test('scene cast readiness is one compact status instead of permanent disabled model and identity controls', () => {
  assert.match(inlineScenePanel, /<small class="scene-cast-status">/);
  assert.match(inlineScenePanel, /Selecting visible cast…/);
  assert.match(inlineScenePanel, /generatedInlineScene\.request\.cast\.kind === 'solo' \? 'Solo'/);
  assert.match(inlineScenePanel, /generatedInlineScene\.request\.cast\.identities\.map\(\(identity\) => identity\.displayName\)\.join\(' \+ '\)/);
  assert.match(inlineScenePanel, /generatedInlineScene\.request\.modelTemplate === INLINE_SCENE_TEMPLATE_ID \? 'Z-Image \+ exact linked LoRA' : 'Qwen multi-reference master'/);
  assert.match(inlineScenePanel, /Qwen multi-reference master/);
  assert.match(inlineScenePanel, /No deterministic static-scene driver is currently available for this scenario state/);
  assert.doesNotMatch(inlineScenePanel, /H3 \{generatedInlineScene/);
  assert.match(inlineScenePanel, /scenarioSceneProfiles\.length < 1\}[\s\S]*A validated scenario cast is required/);
  assert.doesNotMatch(inlineScenePanel, /aria-label="Inline scene image model"/);
  assert.doesNotMatch(inlineScenePanel, /aria-label="Inline scene identity driver"/);
  assert.doesNotMatch(inlineScenePanel, /<span>Image model<\/span>/);
  assert.doesNotMatch(inlineScenePanel, /<span>Identity driver<\/span>/);
  assert.doesNotMatch(inlineScenePanel, /inlineSceneProfileDriver/);
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

test('a scenario binds its selected starter to Z-Image LoRA or the additive Qwen reference path', () => {
  assert.match(pageSource, /let scenarioCatalogSettled = false;/);
  assert.match(pageSource, /scenarioPortraitGenerationReady\(activeCard, scenarioCatalogSettled\)/);
  assert.match(
    pageSource,
    /async function loadScenarioCatalog\(\)[\s\S]*?finally \{\s*scenarioCatalogSettled = true;\s*restoreInlineSceneFinalizedSource\(\);\s*restoreScenarioOpeningInlineSceneSourceIfNeeded\(\);/
  );
  assert.match(pageSource, /if \(!result \|\| !current \|\| !modelAvailable\) return null;/);
  assert.match(pageSource, /portraitModelTemplateAvailable\(portraitCapabilities, portraitModelTemplate\)/);
  assert.match(pageSource, /portraitCapabilities\?\.loras\.includes\(scenarioPortraitProfile\.subjectLora\.name\)/);
  assert.match(pageSource, /portraitSelectedModelAvailable && portraitSelectedSubjectLoraAvailable/);
  assert.match(pageSource, /lora: modelUsesReference \? null : profile\.subjectLora\?\.name \?\? null/);
  assert.match(pageSource, /`\$\{profile\.subjectLora\.trigger\}, \$\{profile\.subject\}`/);
  assert.match(pageSource, /referenceImage: modelUsesReference \? profile\.referenceImage : null/);
  assert.match(pageSource, /promptOverride: modelUsesReference\s+\? profile\.expressionPrompts\[result\.output\.expression\] \?\? null\s+: null/);
  assert.match(pageSource, /if \(modelUsesReference\) return null;/);
  assert.match(pageSource, /Canonical reference · \$\{scenarioPortraitProfile\.referenceImage\.width\}×\$\{scenarioPortraitProfile\.referenceImage\.height\} · \$\{scenarioPortraitProfile\.referenceImage\.aspectRatio\}/);
  assert.match(pageSource, /Z-Image LoRA · \$\{scenarioPortraitProfile\.subjectLora\.name\.replace/);
  assert.match(pageSource, /trigger \$\{scenarioPortraitProfile\.subjectLora\.trigger\}/);
  assert.match(pageSource, /portraitModelTemplate = starterProfile\.modelTemplate;/);
  assert.match(pageSource, /localStorage\.setItem\(portraitModelTemplateStorageKey, portraitModelTemplate\);/);
  assert.doesNotMatch(pageSource, /referenceTemplateAvailable/);
  assert.doesNotMatch(pageSource, /No scenario expression portrait will be generated/);
});
