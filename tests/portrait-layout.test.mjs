import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
const portraitVideoSource = readFileSync(new URL('../src/lib/portrait-video.ts', import.meta.url), 'utf8');
const inlineSceneVideoSource = readFileSync(new URL('../src/lib/inline-scene-video.ts', import.meta.url), 'utf8');
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
  assert.match(portraitImagePanel, /576×1024 · fixed 9:16 · H3 Ref2VA five-frame keeper · frame 0 · 20-step res_multistep\/simple · shifts 12\/3 · no LoRA/);
  assert.doesNotMatch(portraitImagePanel, /aria-label="Portrait output dimensions"/);
  assert.match(pageSource, /aria-label="Inline scene aspect ratio"/);
});

test('H3 is the versioned expression-image default while alternatives remain additive selections', () => {
  assert.match(pageSource, /let portraitModelTemplate: PortraitModelTemplate = PORTRAIT_H3_REFERENCE_TEMPLATE_ID;/);
  assert.match(pageSource, /portraitModelTemplateStorageKey = 'mullet\.portrait-model-template\.v4'/);
  assert.match(pageSource, /previousPortraitModelTemplateStorageKey = 'mullet\.portrait-model-template\.v3'/);
  assert.match(pageSource, /localStorage\.removeItem\(previousPortraitModelTemplateStorageKey\)/);
  assert.match(pageSource, /migratePortraitModelTemplateSelection\(\s*currentSavedModelTemplate,\s*null\s*\)/);
  assert.match(pageSource, /portraitModelTemplate = PORTRAIT_H3_REFERENCE_TEMPLATE_ID;/);
  assert.doesNotMatch(pageSource, /portraitModelTemplate = starterProfile\.modelTemplate/);
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

test('portrait motion defaults visibly to H3 with an invalidating versioned selection', () => {
  assert.match(portraitVideoSource, /export const PORTRAIT_VIDEO_TEMPLATE_ID = MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID;/);
  assert.match(portraitVideoSource, /export const PORTRAIT_VIDEO_DURATION_SECONDS = 2 as const;/);
  assert.match(pageSource, /let portraitVideoModelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID;/);
  assert.match(pageSource, /let portraitVideoDurationSeconds: PortraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATION_SECONDS;/);
  assert.match(pageSource, /portraitVideoModelTemplateStorageKey = 'mullet\.portrait-video-model-template\.v4'/);
  assert.match(pageSource, /portraitVideoModeStorageKey = 'mullet\.portrait-video-mode\.v7'/);
  assert.match(pageSource, /portraitVideoDurationStorageKey = 'mullet\.portrait-video-duration\.v7'/);
  assert.match(pageSource, /portraitVideoDimensions\('9:16', PORTRAIT_VIDEO_DURATION_SECONDS, portraitVideoModelTemplate\)/);
  assert.match(pageSource, /portraitVideoDimensions\(\s*portraitAspectRatio,\s*portraitVideoDurationSeconds,\s*portraitVideoModelTemplate\s*\)/);
  assert.match(portraitMotionPanel, /silent, no speech or talking/);
  assert.match(portraitMotionPanel, /portraitVideoTiming\.frames\} frames @ \{portraitVideoTiming\.fps\} FPS/);
  assert.match(portraitMotionPanel, /bind:value=\{portraitVideoModelTemplate\}/);
  assert.match(portraitMotionPanel, /on:change=\{persistPortraitVideoModelTemplate\}/);
  assert.match(portraitMotionPanel, /aria-label="Portrait video model"/);
  assert.match(portraitMotionPanel, /\{#each portraitVideoCapabilities\.templates as capability\}/);
  assert.match(portraitMotionPanel, /<option value=\{capability\.template\.id\}>/);
  assert.doesNotMatch(portraitMotionPanel, /value=\{capability\.template\.id\} disabled=/);
  assert.match(pageSource, /localStorage\.setItem\(portraitVideoModelTemplateStorageKey, portraitVideoModelTemplate\)/);
});

test('scene motion visibly defaults to H3 Ref2VA quality after the versioned selection migration', () => {
  assert.match(pageSource, /let inlineSceneVideoModelTemplate: InlineSceneVideoTemplateId = MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID;/);
  assert.match(pageSource, /inlineSceneVideoModelTemplateStorageKey = 'mullet\.inline-scene-video-model-template\.v3'/);
  assert.doesNotMatch(pageSource, /mullet\.inline-scene-video-model-template(?:'|\.v0|\.v1|\.v2)/);
  assert.match(pageSource, /savedInlineSceneVideoModelTemplate === LTX25_INLINE_SCENE_VIDEO_TEMPLATE_ID/);
  assert.match(pageSource, /savedInlineSceneVideoModelTemplate === MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID/);
  assert.match(pageSource, /savedInlineSceneVideoModelTemplate === MINIMAX_H3_LIGHTX_PREVIEW_INLINE_SCENE_VIDEO_TEMPLATE_ID/);
  assert.match(pageSource, /: MINIMAX_H3_INLINE_SCENE_VIDEO_TEMPLATE_ID;/);
  assert.match(pageSource, /localStorage\.setItem\(inlineSceneVideoModelTemplateStorageKey, inlineSceneVideoModelTemplate\)/);
  assert.match(pageSource, /bind:value=\{inlineSceneVideoModelTemplate\}/);
  assert.match(pageSource, /on:change=\{persistInlineSceneVideoModelTemplate\}/);
  assert.match(pageSource, /\{#each inlineSceneVideoCapabilities\.templates as capability\}/);
  assert.doesNotMatch(pageSource, /value=\{capability\.template\.id\} disabled=/);
  assert.match(pageSource, /buildInlineSceneVideoRequest\(scene, modelTemplate\)/);
  assert.match(pageSource, /LTX 2\.5 Distilled · silent/);
  assert.match(inlineSceneVideoSource, /MiniMax H3 Ref2VA · Default quality \(20-step\)/);
  assert.match(pageSource, /LightX four-step preview · 544p training envelope · Euler\/simple · shifts 12\/3/);
  assert.match(pageSource, /'20-step quality'/);
  assert.match(pageSource, /\{inlineSceneH3ReferenceSummary \|\| 'reference plan resolves after the current scene'\} · native audio/);
  assert.match(inlineSceneVideoSource, /const references = \['P1 scene'\];/);
  assert.match(inlineSceneVideoSource, /`P\$\{priorMaster\.picture\} prior`/);
  assert.match(inlineSceneVideoSource, /`\$\{identity\.displayName\} \$\{slots\.join\('\/'\)\}`/);
  assert.match(pageSource, /describeInlineSceneH3ReferencePlan\(inlineSceneVideoRequest\)/);
  assert.doesNotMatch(pageSource, /current scene \+ prior master \+ canonical cast/);
  assert.doesNotMatch(pageSource, /MiniMax H3 FL2VA Turbo/);
  assert.match(pageSource, /!inlineSceneVideoSelectedModelAvailable\}[\s\S]*?Retry scene motion models/);
  assert.match(pageSource, /on:click=\{\(\) => void loadInlineSceneVideoGenerator\(\)\}/);
});

test('scene stills visibly default to the H3 five-frame keeper after the versioned selection migration', () => {
  assert.match(inlineScenePanel, /<small class="scene-cast-status">/);
  assert.match(inlineScenePanel, /Selecting visible cast…/);
  assert.match(inlineScenePanel, /generatedInlineScene\.request\.cast\.kind === 'solo' \? 'Solo'/);
  assert.match(inlineScenePanel, /generatedInlineScene\.request\.cast\.identities\.map\(\(identity\) => identity\.displayName\)\.join\(' \+ '\)/);
  assert.match(inlineScenePanel, /inlineSceneStillDriverLabel\(generatedInlineScene\.request\.modelTemplate\)/);
  assert.match(pageSource, /return 'Qwen multi-reference master';/);
  assert.match(inlineScenePanel, /aria-label="Inline scene still model"/);
  assert.match(pageSource, /let inlineSceneStillMode: InlineSceneStillMode = MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID;/);
  assert.match(inlineScenePanel, /Automatic alternative · Z-Image solo \/ Qwen references/);
  assert.match(inlineScenePanel, /MiniMax H3 Ref2VA · Keeper still \(5-frame, 20-step\)/);
  assert.match(inlineScenePanel, /Five-frame Ref2VA keeper · base H3 · no LoRA · res_multistep\/simple · shifts 12\/3 · frame 0/);
  assert.match(pageSource, /inlineSceneStillModeStorageKey = 'mullet\.inline-scene-still-mode\.v2'/);
  assert.doesNotMatch(pageSource, /mullet\.inline-scene-still-mode(?:'|\.v0|\.v1)/);
  assert.match(pageSource, /savedInlineSceneStillMode === 'automatic'/);
  assert.match(pageSource, /: MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID;/);
  assert.match(pageSource, /localStorage\.setItem\(inlineSceneStillModeStorageKey, inlineSceneStillMode\)/);
  assert.match(inlineScenePanel, /No deterministic static-scene driver is currently available for this scenario state/);
  assert.match(inlineScenePanel, /scenarioSceneProfiles\.length < 1\}[\s\S]*A validated scenario cast is required/);
  assert.doesNotMatch(inlineScenePanel, /aria-label="Inline scene image model"/);
  assert.doesNotMatch(inlineScenePanel, /aria-label="Inline scene identity driver"/);
  assert.doesNotMatch(inlineScenePanel, /<span>Image model<\/span>/);
  assert.doesNotMatch(inlineScenePanel, /<span>Identity driver<\/span>/);
  assert.doesNotMatch(inlineScenePanel, /inlineSceneProfileDriver/);
});

test('managed body references stay collapsed, exact, accessible, and planner-bound', () => {
  assert.match(inlineScenePanel, /<details class="h3-reference-pack" open=\{bodyReferenceOverlayCorruptProfileIds\.length > 0\}>/);
  assert.match(inlineScenePanel, /Scene reference library/);
  assert.match(inlineScenePanel, /Body anchors are exact 576×1024 PNGs/);
  assert.match(inlineScenePanel, /class="body-reference-file-input"/);
  assert.match(inlineScenePanel, /accept="image\/png"/);
  assert.match(inlineScenePanel, /aria-label=\{`Add or replace \$\{profile\.displayName\} body and wardrobe reference`\}/);
  assert.match(inlineScenePanel, /`Remove corrupt saved body and wardrobe reference for \$\{profile\.displayName\}`/);
  assert.match(inlineScenePanel, /`Remove \$\{profile\.displayName\} managed body and wardrobe reference`/);
  assert.match(pageSource, /request\.modelTemplate === INLINE_SCENE_QWEN_TEMPLATE_ID/);
  assert.match(pageSource, /portraitH3ReferencePlan\(request\)/);
  assert.match(pageSource, /entry\.kind === 'body_wardrobe' \? \[entry\.referenceImage\.sha256\] : \[\]/);
  assert.match(pageSource, /appendManagedBodyReferenceParts\(\s*h3ReferenceForm,\s*portraitManagedBodyReferenceHashes\(selectedRequest\)\s*\)/);
  assert.match(pageSource, /entry\.kind === 'body_wardrobe' \? \[entry\.referenceImage\.sha256\] : \[\]/);
  assert.match(pageSource, /request\.modelTemplate === MINIMAX_H3_INLINE_SCENE_STILL_TEMPLATE_ID/);
  assert.match(pageSource, /entry\.kind === 'body_identity' \? \[entry\.referenceImage\.sha256\] : \[\]/);
  assert.match(pageSource, /if \(!isMiniMaxH3InlineSceneVideoTemplate\(request\.modelTemplate\)\) return \[\];/);
  assert.match(pageSource, /appendManagedBodyReferenceParts\(imageForm, inlineSceneManagedBodyReferenceHashes\(imageRequest\)\)/);
  assert.match(pageSource, /appendManagedBodyReferenceParts\(form, inlineSceneVideoManagedBodyReferenceHashes\(selectedRequest\)\)/);
  assert.doesNotMatch(pageSource, /appendManagedBodyReferenceParts\([^\n]*\.cast\)/);
  assert.match(pageSource, /!bodyReferenceOverlayReady \|\| Boolean\(bodyReferenceOverlayBusyProfileId\)/);
});

test('managed body-reference restore is race-safe, preserves valid profiles, and exposes explicit corrupt-record recovery', () => {
  const restore = pageSource.match(
    /async function restoreBodyReferenceOverlays\([\s\S]*?\n  }\n\n  function managedBodyReferenceForProfile/
  )?.[0] ?? '';
  const importReference = pageSource.match(
    /async function importBodyReference\([\s\S]*?\n  }\n\n  async function clearBodyReference/
  )?.[0] ?? '';
  const removeReference = pageSource.match(
    /async function clearBodyReference\([\s\S]*?\n  }\n\n  function appendManagedBodyReferenceParts/
  )?.[0] ?? '';

  assert.match(pageSource, /let bodyReferenceOverlayRestoreGeneration = 0;/);
  assert.match(pageSource, /let bodyReferenceOverlayCorruptProfileIds: string\[\] = \[\];/);
  assert.match(restore, /const restoreGeneration = \+\+bodyReferenceOverlayRestoreGeneration;/);
  assert.match(restore, /await Promise\.allSettled\(profiles\.map/);
  assert.match(restore, /restoreGeneration !== bodyReferenceOverlayRestoreGeneration/);
  assert.match(restore, /bodyReferenceOverlayProfileSetKey !== profileSetKey/);
  assert.match(restore, /if \(result\.value\) restored\.push\(result\.value\);/);
  assert.match(restore, /corruptProfileIds\.push\(profiles\[index\]\.id\);/);
  assert.match(restore, /bodyReferenceOverlays = restored;/);
  assert.match(restore, /bodyReferenceOverlayCorruptProfileIds = corruptProfileIds;/);
  assert.match(restore, /Portrait, scene-image, and scene-motion generation are blocked until Remove corrupt saved ref/);
  assert.doesNotMatch(restore, /removeBodyReferenceOverlay/);

  assert.match(inlineScenePanel, /body corrupt saved reference/);
  assert.match(inlineScenePanel, /\{#if managedBody \|\| corruptBody\}/);
  assert.match(inlineScenePanel, /Remove corrupt saved ref/);
  assert.match(inlineScenePanel, /\(!bodyReferenceOverlayReady && !corruptBody\)/);
  assert.match(inlineScenePanel, /inlineSceneBusy \|\| inlineSceneVideoBusy/);
  assert.match(portraitImagePanel, /Portrait generation is blocked by a corrupt saved body reference/);
  assert.match(portraitImagePanel, /!bodyReferenceOverlayReady && bodyReferenceOverlayCorruptProfileIds\.length === 0/);
  assert.match(
    inlineScenePanel,
    /bodyReferenceOverlayError[\s\S]*?<details class="h3-reference-pack"[\s\S]*?\{#if inlineSceneCapabilities\}/
  );
  assert.match(importReference, /\|\| portraitBusy\s+\|\| inlineSceneBusy\s+\|\| inlineSceneVideoBusy/);
  assert.match(importReference, /await saveBodyReferenceOverlay\(overlay\);[\s\S]*?await restoreBodyReferenceOverlays\(operationProfileSetKey, operationProfiles\);/);
  assert.doesNotMatch(importReference, /bodyReferenceOverlays = \[/);
  assert.match(removeReference, /\|\| portraitBusy\s+\|\| inlineSceneBusy\s+\|\| inlineSceneVideoBusy/);
  assert.match(removeReference, /\(!bodyReferenceOverlayReady && !corruptReference\)/);
  assert.match(removeReference, /await removeBodyReferenceOverlay\(profile\.id, profile\.fingerprint\);[\s\S]*?await restoreBodyReferenceOverlays\(operationProfileSetKey, operationProfiles\);/);
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

test('a scenario defaults every starter to H3 while retaining explicit Qwen and Z-Image alternatives', () => {
  assert.match(pageSource, /let scenarioCatalogSettled = false;/);
  assert.match(pageSource, /scenarioPortraitGenerationReady\(activeCard, scenarioCatalogSettled\)/);
  assert.match(
    pageSource,
    /async function loadScenarioCatalog\(\)[\s\S]*?finally \{\s*scenarioCatalogSettled = true;\s*restoreInlineSceneFinalizedSource\(\);\s*restoreScenarioOpeningInlineSceneSourceIfNeeded\(\);/
  );
  assert.match(pageSource, /if \(!result \|\| !current \|\| !modelAvailable \|\| \(isScenarioCard\(card\) && !bodyReferencesReady\)\) return null;/);
  assert.match(pageSource, /portraitModelTemplateAvailable\(portraitCapabilities, portraitModelTemplate\)/);
  assert.match(pageSource, /portraitCapabilities\?\.loras\.includes\(scenarioPortraitProfile\.subjectLora\.name\)/);
  assert.match(pageSource, /portraitSelectedModelAvailable && portraitSelectedSubjectLoraAvailable/);
  assert.match(pageSource, /lora: modelUsesReference \? null : profile\.subjectLora\?\.name \?\? null/);
  assert.match(pageSource, /`\$\{profile\.subjectLora\.trigger\}, \$\{profile\.subject\}`/);
  assert.match(pageSource, /referenceImage: modelUsesReference \? profile\.referenceImage : null/);
  assert.match(pageSource, /bodyReferenceImage: isPortraitH3ReferenceTemplateId\(modelTemplate\)[\s\S]*?profile\.bodyReferenceImage[\s\S]*?: null/);
  assert.match(pageSource, /promptOverride: modelUsesReference\s+\? profile\.expressionPrompts\[result\.output\.expression\] \?\? null\s+: null/);
  assert.match(pageSource, /if \(modelUsesReference\) return null;/);
  assert.match(pageSource, /Canonical reference · \$\{portraitDisplayProfile\.referenceImage\.width\}×\$\{portraitDisplayProfile\.referenceImage\.height\} · \$\{portraitDisplayProfile\.referenceImage\.aspectRatio\}/);
  assert.match(pageSource, /Z-Image LoRA · \$\{portraitDisplayProfile\.subjectLora\.name\.replace/);
  assert.match(pageSource, /trigger \$\{portraitDisplayProfile\.subjectLora\.trigger\}/);
  assert.match(pageSource, /portraitModelTemplate = PORTRAIT_H3_REFERENCE_TEMPLATE_ID;/);
  assert.match(pageSource, /effectiveScenarioPortraitProfile = scenarioPortraitProfile[\s\S]*?scenarioSceneProfiles\.find\(\(profile\) => profile\.id === scenarioPortraitProfile\?\.id\)/);
  assert.match(pageSource, /localStorage\.setItem\(portraitModelTemplateStorageKey, portraitModelTemplate\);/);
  assert.doesNotMatch(pageSource, /referenceTemplateAvailable/);
  assert.doesNotMatch(pageSource, /No scenario expression portrait will be generated/);
});
