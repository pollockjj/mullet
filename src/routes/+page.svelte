<script lang="ts">
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    embeddedLoreEntryCount,
    characterSourceIdentifier,
    firstCharacterMessage,
    normalizeCharacterCard,
    parseCharacterCardJson,
    type ImportedCharacterCard
  } from '$lib/character-card';
  import {
    DEFAULT_LOREBOOK_SETTINGS,
    combineLorebooks,
    emptyLoreTimedState,
    normalizeLorebook,
    normalizeLoreTimedState,
    parseLorebookJson,
    reconcileLorebookRecursionControls,
    resolveLorebookSettings,
    type ImportedLorebook,
    type LoreActivation,
    type LorebookRecursionControl,
    type LorebookSettings
    , type LoreTimedState
  } from '$lib/lorebook';
  import { extractPngCharacterCard, MAX_CHARACTER_CARD_PNG_BYTES } from '$lib/png-character-card';
  import { extractPngLorebook, MAX_LOREBOOK_PNG_BYTES } from '$lib/png-lorebook';
  import { loadStoredLorebooks, saveStoredLorebooks, type StoredLorebook } from '$lib/lorebook-storage';
  import {
    INLINE_SCENE_IMAGE_TIMEOUT_MS,
    INLINE_SCENE_QWEN_TEMPLATE_ID,
    INLINE_SCENE_TEMPLATE_ID,
    INLINE_SCENE_KREA_TEMPLATE_ID,
    INLINE_SCENE_TIMEOUT_MS,
    MINIMAX_H3_INLINE_SCENE_STILL_TIMEOUT_MS,
    buildInlineSceneImageRequest,
    buildInlineSceneRequest,
    createInlineSceneContinuityMaster,
    inlineSceneQwenReferencePlan,
    inlineSceneContinuityMasterEligible,
    inlineSceneImageRequestKey,
    inlineSceneModelTemplateAvailable,
    inlineSceneResultMatchesRequest,
    inlineSceneSourceForCompletedTurn,
    inlineSceneSourceForScenarioOpening,
    inlineSceneSourceMatchesMessages,
    inlineSceneSourcesMatch,
    normalizeInlineSceneCapabilities,
    normalizeInlineSceneResult,
    normalizeInlineSceneSource,
    type InlineSceneAspectRatio,
    type InlineSceneCapabilities,
    type InlineSceneCast,
    type InlineSceneContinuityMaster,
    type InlineSceneIdentity,
    type InlineSceneImageRequest,
    type InlineSceneMegapixels,
    type InlineSceneRequest,
    type InlineSceneResult,
    type InlineSceneScenarioOpeningIdentity,
    type InlineSceneSource,
    type InlineSceneSubjectCandidate
  } from '$lib/inline-scene';
  import {
    INLINE_SCENE_VIDEO_DURATION_SECONDS,
    INLINE_SCENE_VIDEO_FPS,
    INLINE_SCENE_VIDEO_TIMEOUT_MS,
    MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID,
    buildInlineSceneVideoRequest,
    isMiniMaxH3InlineSceneVideoTemplate,
    inlineSceneMasterToggleEnabled,
    inlineSceneVideoDecodeFailureTransition,
    inlineSceneVideoDimensions,
    inlineSceneVideoMasterToggleAction,
    inlineSceneVideoReconciliationAllowed,
    inlineSceneVideoReferencesSha256,
    inlineSceneVideoRequestKey,
    inlineSceneVideoSourceRequestSha256,
    type InlineSceneVideoReference,
    inlineSceneVideoTemplateAvailable,
    inlineSceneVideoTemplateCapability,
    normalizeInlineSceneVideoCapabilities,
    parseInlineSceneVideoIntegerHeader,
    parseInlineSceneVideoNumberHeader,
    type InlineSceneVideoCapabilities,
    type InlineSceneVideoRequest,
    type InlineSceneVideoTemplateId
  } from '$lib/inline-scene-video';
  import {
    STORED_INLINE_SCENE_VIDEO_SPEC,
    StoredInlineSceneVideoIntegrityError,
    clearStoredInlineSceneVideo,
    commitStoredInlineSceneVideo,
    loadAllStoredInlineSceneVideos,
    loadStoredInlineSceneVideo,
    pruneStoredInlineSceneVideos,
    normalizeStoredInlineSceneVideo,
    restoreStoredInlineSceneVideo,
    rollbackStoredInlineSceneVideoWrite,
    runStoredInlineSceneVideoExclusive,
    saveStoredInlineSceneVideo,
    unwrapStoredInlineSceneVideo,
    verifyStoredInlineSceneVideo,
    type StoredInlineSceneVideo
  } from '$lib/inline-scene-video-storage';
  import {
    MEDIA_PLAYBACK_START_TIMEOUT_MS,
    mediaPlaybackTimeAdvanced,
    type PlaybackState
  } from '$lib/media-playback';
  import {
    STORED_INLINE_SCENE_SPEC,
    StoredInlineSceneIntegrityError,
    clearStoredInlineScene,
    commitStoredInlineScene,
    loadStoredInlineScene,
    normalizeStoredInlineScene,
    restoreStoredInlineScene,
    rollbackStoredInlineSceneWrite,
    runStoredInlineSceneExclusive,
    saveStoredInlineScene,
    verifyStoredInlineScene,
    type StoredInlineScene
  } from '$lib/inline-scene-storage';
  import {
    PORTRAIT_H3_TIMEOUT_MS,
    PORTRAIT_TEMPLATE_ID,
    isPortraitReferenceTemplateId,
    PORTRAIT_KREA_TEMPLATE_ID,
    PORTRAIT_TIMEOUT_MS,
    buildPortraitRequest,
    migratePortraitModelTemplateSelection,
    normalizePortraitCapabilities,
    portraitModelTemplateAvailable,
    portraitRequestKey,
    type PortraitAspectRatio,
    type PortraitCapabilities,
    type PortraitMegapixels,
    type PortraitModelTemplate,
    type PortraitRequest
  } from '$lib/portrait';
  import {
    STORED_PORTRAIT_SPEC,
    commitStoredPortrait,
    clearStoredPortrait,
    loadStoredPortrait,
    normalizeStoredPortrait,
    restoreStoredPortrait,
    rollbackStoredPortraitWrite,
    runStoredPortraitExclusive,
    saveStoredPortrait,
    type StoredPortrait
  } from '$lib/portrait-storage';
  import {
    MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID,
    PORTRAIT_VIDEO_DURATION_SECONDS,
    PORTRAIT_VIDEO_DURATIONS,
    PORTRAIT_VIDEO_MODE_GENERATED_FLF,
    PORTRAIT_VIDEO_MODE_LOOP_FLF,
    PORTRAIT_VIDEO_MODES,
    PORTRAIT_VIDEO_TEMPLATE_ID,
    PORTRAIT_VIDEO_TIMEOUT_MS,
    buildPortraitVideoRequest,
    normalizePortraitVideoCapabilities,
    portraitVideoDimensions,
    portraitVideoModeAvailable,
    portraitVideoRequestKey,
    portraitVideoTemplateCapability,
    type PortraitVideoCapabilities,
    type PortraitVideoDurationSeconds,
    type PortraitVideoMode,
    type PortraitVideoRequest,
    type PortraitVideoTemplateId
  } from '$lib/portrait-video';
  import { validateH264VideoOnlyMp4 } from '$lib/mp4';
  import {
    STORED_PORTRAIT_VIDEO_SPEC,
    clearStoredPortraitVideo,
    commitStoredPortraitVideo,
    loadStoredPortraitVideo,
    normalizeStoredPortraitVideo,
    restoreStoredPortraitVideo,
    rollbackStoredPortraitVideoWrite,
    runStoredPortraitVideoExclusive,
    saveStoredPortraitVideo,
    type StoredPortraitVideo
  } from '$lib/portrait-video-storage';
  import {
    emptySidecarState,
    expressionResultMatchesRequest,
    expressionSourceFingerprint,
    isSidecarConversationId,
    normalizeExpressionSidecarResult,
    normalizeSidecarState,
    withExpressionSidecarResult,
    SIDECAR_TIMEOUT_MS,
    type ExpressionSidecarRequest,
    type ExpressionSidecarResult,
    type SidecarState
  } from '$lib/sidecar';
  import {
    createAuthoredOpeningReceipt,
    createCompletedFictionResponseReceipt,
    expressionRequestForFinalizedFictionResponse,
    type FictionResponseReceipt
  } from '$lib/fiction-finalization';
  import { loadStoredSidecarState, saveStoredSidecarState } from '$lib/sidecar-storage';
  import { serializeChatRequest } from '$lib/chat-request-size';
  import { assertFinalizedChatStream, parseChatStreamPayload } from '$lib/chat-stream';
  import {
    defaultScenarioPortraitProfile,
    isScenarioCard,
    normalizeScenarioCatalog,
    scenarioPortraitCast,
    scenarioPortraitGenerationReady,
    scenarioStarterMessage,
    scenarioStarterPortraitProfile,
    scenarioStarters,
    validateScenarioPackage,
    type ScenarioCatalog,
    type ScenarioCatalogEntry,
    type ScenarioPackage,
    type ScenarioPortraitProfile
  } from '$lib/scenario';
  import {
    applyBodyReferenceOverlay,
    createBodyReferenceOverlay,
    loadBodyReferenceOverlay,
    removeBodyReferenceOverlay,
    saveBodyReferenceOverlay,
    type StoredBodyReferenceOverlay
  } from '$lib/body-reference-storage';
  import {
    WORKSPACE_MAX_MESSAGES,
    createStoredWorkspace,
    loadStoredWorkspace,
    rollbackFailedWorkspaceTurn,
    saveStoredWorkspace,
    workspaceCompletedTurnCapacityError,
    workspaceMutationFingerprint,
    workspaceReadyForCompletedTurn
  } from '$lib/workspace-state';
  import { normalizeTranscriptSource, transcriptSourceForMessages } from '$lib/transcript-source';
  import {
    createSubjectDescriptor,
    normalizeSubjectDescriptor,
    subjectContinuityClause,
    type SubjectDescriptor
  } from '$lib/subject-continuity';
  import type { PageData } from './$types';

  type Role = 'user' | 'assistant';
  type Message = { role: Role; content: string };
  type InlineSceneImageDriver = Pick<InlineSceneImageRequest, 'modelTemplate' | 'lora'>;
  type InlineSceneStillMode = 'automatic';
  export let data: PageData;

  let messages: Message[] = [];
  let draft = '';
  let streaming = false;
  let errorMessage = '';
  let noticeMessage = '';
  let tokenLimit = data.defaultMaxTokens;
  let finalizedFictionResponse: FictionResponseReceipt | null = null;
  let activeCard: ImportedCharacterCard | null = null;
  let cardSourceIdentifier = '';
  let portraitDataUrl = '';
  let generatedPortraitUrl = '';
  let generatedPortrait: StoredPortrait | null = null;
  let portraitCapabilities: PortraitCapabilities | null = null;
  let portraitCapabilitiesLoading = false;
  let portraitPersistenceReady = false;
  let portraitPersistenceAvailable = true;
  let portraitBusy = false;
  let portraitError = '';
  let portraitSubject = '';
  let portraitSetting = '';
  let portraitAttire = '';
  let portraitLora = '';
  const portraitAspectRatio: PortraitAspectRatio = '9:16';
  let portraitMegapixels: PortraitMegapixels = 0.5;
  let portraitModelTemplate: PortraitModelTemplate = PORTRAIT_TEMPLATE_ID;
  let portraitModelSelectionPersisted = false;
  let portraitRequest: PortraitRequest | null = null;
  let portraitH3ReferenceSummary = '';
  let portraitCurrent = false;
  let lastPortraitAttemptKey = '';
  // Every stage retries a failed generation with backoff (15, 30, 60 s) for the same
  // attempt key. A served-build restart costs the operator under a minute this way; a
  // single retry 1.5 s later landed inside the restart window and latched the turn.
  type StageRetry = { key: string; attempts: number; timer: number | null };
  const STAGE_RETRY_DELAYS_MS = [15_000, 30_000, 60_000] as const;
  const portraitRetry: StageRetry = { key: '', attempts: 0, timer: null };
  const portraitVideoRetry: StageRetry = { key: '', attempts: 0, timer: null };
  const inlineSceneRetry: StageRetry = { key: '', attempts: 0, timer: null };
  const inlineSceneVideoRetry: StageRetry = { key: '', attempts: 0, timer: null };
  // Bumped when a retry releases a latch, so the reactive schedulers re-run.
  let stageRetryTick = 0;

  function queueStageRetry(state: StageRetry, key: string, stillLatched: () => boolean, release: () => void) {
    if (!browser || !key || !stillLatched()) return;
    if (state.key !== key) {
      state.key = key;
      state.attempts = 0;
    }
    const delayMs = STAGE_RETRY_DELAYS_MS[state.attempts];
    if (delayMs === undefined) return;
    state.attempts += 1;
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.timer = null;
      if (!stillLatched()) return;
      release();
      stageRetryTick += 1;
    }, delayMs);
  }

  function clearStageRetry(state: StageRetry, key: string) {
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = null;
    if (state.key === key) {
      state.key = '';
      state.attempts = 0;
    }
  }
  let portraitController: AbortController | null = null;
  let portraitMotionEnabled = true;
  let portraitVideoModelTemplate: PortraitVideoTemplateId = PORTRAIT_VIDEO_TEMPLATE_ID;
  let portraitVideoMode: PortraitVideoMode = PORTRAIT_VIDEO_MODE_LOOP_FLF;
  let portraitVideoDurationSeconds: PortraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATION_SECONDS;
  let portraitVideoTiming = portraitVideoDimensions('9:16', PORTRAIT_VIDEO_DURATION_SECONDS, portraitVideoModelTemplate);
  let generatedPortraitVideoUrl = '';
  let generatedPortraitVideo: StoredPortraitVideo | null = null;
  let portraitVideoElement: HTMLVideoElement | null = null;
  let portraitVideoPlaybackState: PlaybackState = 'idle';
  let portraitVideoPlaybackError = '';
  let portraitVideoPlaybackToken = 0;
  let portraitVideoPlaybackAttemptedToken = -1;
  let portraitVideoPlaybackStartSeconds = 0;
  let portraitVideoPlaybackTimer: number | null = null;
  let portraitVideoMounted = false;
  let portraitVideoVisible = false;
  let portraitVideoCapabilities: PortraitVideoCapabilities | null = null;
  let portraitVideoCapabilitiesLoading = false;
  let portraitVideoPersistenceReady = false;
  let portraitVideoPersistenceAvailable = true;
  let portraitVideoPersistenceOperations = 0;
  let portraitVideoBusy = false;
  let portraitVideoError = '';
  let portraitVideoRequest: PortraitVideoRequest | null = null;
  // True until a restore attempt has run with a derivable loop request. On page load the
  // first attempt runs before capabilities and the scenario catalog resolve, when the
  // request is still null; without this flag the reconciliation regenerated a 45-90 s
  // loop on every reload instead of restoring the stored one.
  let portraitVideoRestoreNeeded = true;
  let portraitVideoCurrent = false;
  let lastPortraitVideoAttemptKey = '';
  let portraitVideoController: AbortController | null = null;
  let portraitVideoGeneration = 0;
  let portraitImageDigestPromptId = '';
  let portraitImageSha256 = '';
  let embeddedLorebook: ImportedLorebook | null = null;
  let importedLorebooks: ImportedLorebook[] = [];
  let loreEnabled = true;
  let loreSettings: LorebookSettings = { ...DEFAULT_LOREBOOK_SETTINGS };
  let lastLoreActivations: LoreActivation[] | null = null;
  let lastLoreActivationCount = 0;
  let lastLoreBudget = 0;
  let lorePersistenceReady = false;
  let lorePersistenceBusy = false;
  let lorePersistenceAvailable = true;
  let loreTimedState: LoreTimedState = emptyLoreTimedState();
  let inlineScenesEnabled = true;
  let finalizedInlineSceneSource: InlineSceneSource | null = null;
  let inlineSceneEpoch = '';
  let inlineSceneCapabilities: InlineSceneCapabilities | null = null;
  let inlineSceneCapabilitiesLoading = false;
  let inlineScenePersistenceReady = false;
  let inlineScenePersistenceAvailable = true;
  let inlineScenePersistenceOperations = 0;
  let inlineSceneBusy = false;
  let inlineSceneError = '';
  let inlineSceneAspectRatio: InlineSceneAspectRatio = '16:9';
  // 0.5 MP (944x528 at 16:9): the scene loop renders at 0.59 MP from this still anyway,
  // and the paired lane measurement is 15.5 s versus 34-45 s cold at 1 MP.
  let inlineSceneMegapixels: InlineSceneMegapixels = 0.5;
  let inlineSceneSidecarRequest: InlineSceneRequest | null = null;
  let generatedInlineScene: StoredInlineScene | null = null;
  let inlineSceneApplies = false;
  let inlineSceneCurrent = false;
  let inlineSceneGeneration = 0;
  let inlineSceneController: AbortController | null = null;
  let lastInlineSceneAttemptKey = '';
  let inlineSceneMotionEnabled = true;
  let inlineSceneVideoCapabilities: InlineSceneVideoCapabilities | null = null;
  let inlineSceneVideoCapabilitiesLoading = false;
  let inlineSceneVideoPersistenceReady = false;
  let inlineSceneVideoPersistenceAvailable = true;
  let inlineSceneVideoPersistenceOperations = 0;
  let inlineSceneVideoRestorationOperations = 0;
  let inlineSceneVideoRestorationPending = false;
  let inlineSceneVideoBusy = false;
  let inlineSceneVideoError = '';
  let inlineSceneVideoRequest: InlineSceneVideoRequest | null = null;
  let generatedInlineSceneVideo: StoredInlineSceneVideo | null = null;
  let generatedInlineSceneVideoUrl = '';
  // The transcript keeps a clip per finalized response, the way SillyTavern keeps
  // per-message media (operator order, 2026-09-03), keyed by that message's index.
  let inlineSceneClips = new Map<number, { video: StoredInlineSceneVideo; url: string; failed: boolean }>();
  let inlineSceneVideoElement: HTMLVideoElement | null = null;
  let inlineSceneVideoPlaybackState: PlaybackState = 'idle';
  let inlineSceneVideoPlaybackError = '';
  let inlineSceneVideoPlaybackToken = 0;
  let inlineSceneVideoPlaybackAttemptedToken = -1;
  let inlineSceneVideoPlaybackStartSeconds = 0;
  let inlineSceneVideoPlaybackTimer: number | null = null;
  let inlineSceneVideoMounted = false;
  let inlineSceneVideoCurrent = false;
  let inlineSceneVideoVisible = false;
  let inlineSceneVideoGeneration = 0;
  let inlineSceneVideoController: AbortController | null = null;
  let lastInlineSceneVideoAttemptKey = '';
  // One automatic retry per scene loop attempt, so a single 5xx or network failure does
  // not leave the still without motion until the next still. Mirrors the portrait loop.
  // Capability probes that fail while a lane is loading H3 used to disable a stage for
  // the whole page session. They now retry, bounded.
  const capabilityRetryDelayMs = 15_000;
  const capabilityRetryLimit = 6;
  let capabilityRetryCounts: Record<string, number> = {};
  let capabilityRetryTimers: Record<string, number> = {};
  let inlineSceneVideoComponentDestroying = false;
  let inlineSceneVideoModelTemplate: InlineSceneVideoTemplateId = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID;
  let inlineSceneVideoTiming = inlineSceneVideoDimensions(inlineSceneAspectRatio, inlineSceneVideoModelTemplate);
  let inlineSceneH3ReferenceSummary = '';
  let inlineSceneH3StillReferenceSummary = '';
  let personaDescription = '';
  let scenarioCatalog: ScenarioCatalog | null = null;
  let scenarioCatalogSettled = false;
  let selectedScenarioId = '';
  let selectedScenario: ScenarioCatalogEntry | null = null;
  let activeScenarioStarterId = '';
  let scenarioPortraitProfile: ScenarioPortraitProfile | null = null;
  let effectiveScenarioPortraitProfile: ScenarioPortraitProfile | null = null;
  let portraitDisplayProfile: ScenarioPortraitProfile | null = null;
  let scenarioBaseSceneProfiles: ScenarioPortraitProfile[] = [];
  let scenarioSceneProfiles: ScenarioPortraitProfile[] = [];
  let bodyReferenceOverlays: StoredBodyReferenceOverlay[] = [];
  let bodyReferenceOverlayProfileSetKey = '';
  let bodyReferenceOverlayRequestedKey = '\u0000';
  let bodyReferenceOverlayRestoreGeneration = 0;
  let bodyReferenceOverlayReady = false;
  let bodyReferenceOverlayCorruptProfileIds: string[] = [];
  let bodyReferenceOverlayBusyProfileId = '';
  let bodyReferenceOverlayError = '';
  let inlineSceneSelectedModelAvailable = false;
  let inlineSceneStillMode: InlineSceneStillMode = 'automatic';
  let inlineSceneH3StillCapability: InlineSceneCapabilities['templates'][number] | null = null;
  let scenarioLoading = false;
  let conversationId = '';
  let expressionsEnabled = true;
  // Media is one thing. The four stages are never independently switchable.
  let mediaEnabled = true;
  // Live appearance facts captioned from the expression still that is currently on
  // screen, keyed by character. Injected verbatim into every later image and clip.
  let subjectDescriptors: Record<string, SubjectDescriptor> = {};
  // Which portrait each descriptor was captioned from, so a descriptor is never treated
  // as current for a portrait it does not describe.
  let subjectDescriptorPortraitKeys: Record<string, string> = {};
  // Which portrait each character's most recent caption attempt has finished for, whether
  // it succeeded or not. The scene waits for this turn's portrait to reach this point.
  let subjectCaptionSettledKeys: Record<string, string> = {};
  // When the scene first started waiting for a portrait's caption, so the wait is bounded
  // and can never latch.
  let continuityWaitStartedAt: Record<string, number> = {};
  let continuityWaitTick = 0;
  let continuityWaitTimer: number | null = null;
  let subjectCaptionError = '';
  const SUBJECT_CONTINUITY_WAIT_MS = 60_000;
  const subjectDescriptorStorageKey = 'mullet.subject-descriptors.v1';
  // Which portrait a caption attempt is currently in flight for. The scene waits only
  // while an attempt is genuinely running; any terminal outcome, success or failure,
  // releases it. Continuity must never be able to block media indefinitely.
  let subjectCaptionInFlight: Record<string, string> = {};
  let sidecarState: SidecarState | null = null;
  let expressionSnapshot: ExpressionSidecarRequest | null = null;
  let expressionResult: ExpressionSidecarResult | null = null;
  let expressionCurrent = false;
  let sidecarPersistenceReady = false;
  let sidecarPersistenceAvailable = true;
  let sidecarBusy = false;
  let sidecarError = '';
  let lastExpressionAttemptKey = '';
  let expressionRetriedKey = '';
  let expressionRetryTimer: number | null = null;
  let sidecarController: AbortController | null = null;
  let assistantTurnBusy = false;
  let workspaceBusy = false;
  let controller: AbortController | null = null;
  let transcript: HTMLDivElement;
  let cardInput: HTMLInputElement;
  let loreInput: HTMLInputElement;

  const cardStorageKey = 'mullet.active-character-card';
  const portraitStorageKey = 'mullet.active-character-portrait';
  const cardSourceIdentifierStorageKey = 'mullet.active-character-source';
  const activeScenarioStarterStorageKey = 'mullet.active-scenario-starter.v1';
  const selectedScenarioStorageKey = 'mullet.selected-scenario.v1';
  const lorebookStorageKey = 'mullet.active-lorebook';
  const loreEnabledStorageKey = 'mullet.lorebook-enabled';
  const loreSettingsStorageKey = 'mullet.lorebook-settings';
  const personaDescriptionStorageKey = 'mullet.persona-description';
  const loreTimedStateStorageKey = 'mullet.lore-timed-state';
  const mediaEnabledStorageKey = 'mullet.media-enabled.v1';
  const expressionsEnabledStorageKey = 'mullet.expressions-enabled';
  const portraitSubjectStorageKey = 'mullet.portrait-subject';
  const portraitSettingStorageKey = 'mullet.portrait-setting';
  const portraitAttireStorageKey = 'mullet.portrait-attire';
  const portraitLoraStorageKey = 'mullet.portrait-lora';
  const portraitMegapixelsStorageKey = 'mullet.portrait-megapixels.v4';
  const portraitModelTemplateStorageKey = 'mullet.portrait-model-template.v4';
  const previousPortraitModelTemplateStorageKey = 'mullet.portrait-model-template.v3';
  const portraitMotionEnabledStorageKey = 'mullet.portrait-motion-enabled';
  const portraitVideoModelTemplateStorageKey = 'mullet.portrait-video-model-template.v4';
  const portraitVideoModeStorageKey = 'mullet.portrait-video-mode.v7';
  const portraitVideoDurationStorageKey = 'mullet.portrait-video-duration.v7';
  const inlineScenesEnabledStorageKey = 'mullet.inline-scenes-enabled';
  const inlineSceneFinalizedStorageKey = 'mullet.inline-scene-finalized';
  const inlineSceneAspectStorageKey = 'mullet.inline-scene-aspect';
  // v2: the 1 MP default was retired; browsers that stored it get the new default.
  const inlineSceneMegapixelsStorageKey = 'mullet.inline-scene-megapixels.v2';
  // v3: discards persisted selections of the 20-step H3 keeper still, which never
  // met the latency gate. Explicit re-selection still works and is respected.
  const inlineSceneStillModeStorageKey = 'mullet.inline-scene-still-mode.v3';
  const inlineSceneMotionEnabledStorageKey = 'mullet.inline-scene-motion-enabled';
  // v4: discards persisted selections of the unaccelerated 20-step H3 scene video,
  // which never completed inside the 900s timeout.
  const inlineSceneVideoModelTemplateStorageKey = 'mullet.inline-scene-video-model-template.v5';
  const maxActiveLorebookBytes = 24 * 1024 * 1024;
  const automaticExpressionRetryDelayMs = 1_500;
  const bodyReferenceWidth = 576;
  const bodyReferenceHeight = 1024;

  $: activeLorebooks = combineLorebooks(
    embeddedLorebook,
    importedLorebooks,
    isScenarioCard(activeCard)
  );
  $: selectedScenario = scenarioCatalog?.scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
  $: scenarioPortraitProfile = true && isScenarioCard(activeCard)
    ? scenarioStarterPortraitProfile(activeCard, activeScenarioStarterId)
    : null;
  $: scenarioBaseSceneProfiles = true && isScenarioCard(activeCard)
    ? scenarioPortraitCast(activeCard)?.profiles ?? []
    : [];
  $: bodyReferenceOverlayProfileSetKey = scenarioBaseSceneProfiles
    .map((profile) => `${profile.id}:${profile.fingerprint}`)
    .join('|');
  $: if (browser && bodyReferenceOverlayProfileSetKey !== bodyReferenceOverlayRequestedKey) {
    bodyReferenceOverlayRequestedKey = bodyReferenceOverlayProfileSetKey;
    void restoreBodyReferenceOverlays(bodyReferenceOverlayProfileSetKey, scenarioBaseSceneProfiles);
  }
  $: scenarioSceneProfiles = scenarioBaseSceneProfiles.map((profile) => {
    const overlay = bodyReferenceOverlays.find((candidate) => (
      candidate.profileId === profile.id
      && candidate.baseProfileFingerprint === profile.fingerprint
    ));
    return overlay ? applyBodyReferenceOverlay(profile, overlay) : profile;
  });
  $: effectiveScenarioPortraitProfile = scenarioPortraitProfile
    ? scenarioSceneProfiles.find((profile) => profile.id === scenarioPortraitProfile?.id) ?? null
    : null;
  $: portraitDisplayProfile = effectiveScenarioPortraitProfile ?? scenarioPortraitProfile;
  $: inlineSceneSelectedModelAvailable = inlineScenePotentialDriverAvailable(
    inlineSceneCapabilities,
    scenarioSceneProfiles,
    inlineSceneAncestralMasterScene(
      generatedInlineScene,
      inlineSceneSidecarRequest,
      conversationId,
      messages
    ),
    inlineSceneStillMode
  );
  $: inlineSceneH3StillCapability = inlineSceneCapabilities?.templates.find(
    ({ template }) => false
  ) ?? null;
  $: selectedPortraitCapability = portraitCapabilities?.templates.find(
    ({ template }) => template.id === portraitModelTemplate
  ) ?? null;
  $: portraitSelectedModelAvailable = Boolean(
    selectedPortraitCapability?.available
    && portraitModelTemplateAvailable(portraitCapabilities, portraitModelTemplate)
  );
  $: portraitSelectedModelUsesReference = isPortraitReferenceTemplateId(portraitModelTemplate);
  $: portraitSelectedSubjectLoraAvailable = Boolean(
    !scenarioPortraitProfile?.subjectLora
    || portraitSelectedModelUsesReference
    || portraitCapabilities?.loras.includes(scenarioPortraitProfile.subjectLora.name)
  );
  $: selectedPortraitVideoTemplateCapability = portraitVideoTemplateCapability(
    portraitVideoCapabilities,
    portraitVideoModelTemplate
  );
  $: selectedPortraitVideoModeCapability = selectedPortraitVideoTemplateCapability?.modes.find(
    ({ id }) => id === portraitVideoMode
  ) ?? null;
  $: portraitVideoSelectedModeAvailable = portraitVideoModeAvailable(
    portraitVideoCapabilities,
    portraitVideoMode,
    portraitVideoModelTemplate
  );
  $: expressionSnapshot = true
    ? currentExpressionSnapshot(finalizedFictionResponse, conversationId, messages)
    : null;
  $: expressionResult = sidecarState?.channels.expression ?? null;
  $: expressionCurrent = Boolean(expressionResult && expressionSnapshot && expressionResultMatchesRequest(expressionResult, expressionSnapshot));
  $: portraitRequest = currentPortraitRequest(
    expressionResult,
    expressionCurrent,
    activeCard,
    effectiveScenarioPortraitProfile,
    !isScenarioCard(activeCard) || (
      bodyReferenceOverlayReady
      && bodyReferenceOverlayCorruptProfileIds.length === 0
      && !bodyReferenceOverlayBusyProfileId
    ),
    portraitModelTemplate,
    portraitSelectedModelAvailable && portraitSelectedSubjectLoraAvailable,
    portraitSelectedModelUsesReference,
    portraitSubject,
    portraitSetting,
    portraitAttire,
    portraitLora,
    portraitAspectRatio,
    portraitMegapixels
  );
  $: portraitCurrent = Boolean(generatedPortrait && portraitRequest && generatedPortrait.requestKey === portraitRequestKey(portraitRequest));
  $: portraitH3ReferenceSummary = '';
  $: portraitVideoRequest = currentPortraitVideoRequest(
    generatedPortrait,
    portraitCurrent,
    portraitImageDigestPromptId,
    portraitImageSha256,
    portraitAspectRatio,
    portraitVideoMode,
    portraitVideoDurationSeconds,
    portraitVideoModelTemplate
  );
  $: portraitVideoTiming = portraitVideoDimensions(
    portraitAspectRatio,
    portraitVideoDurationSeconds,
    portraitVideoModelTemplate
  );
  // Reload restore, second chance: the loop request only becomes derivable once the
  // portrait capabilities, the scenario profile and the portrait digest have landed.
  $: if (
    browser
    && portraitVideoRestoreNeeded
    && portraitVideoRequest
    && portraitVideoPersistenceReady
    && !portraitVideoBusy
  ) void restoreGeneratedPortraitVideo();
  $: selectedInlineSceneVideoTemplateCapability = inlineSceneVideoTemplateCapability(
    inlineSceneVideoCapabilities,
    inlineSceneVideoModelTemplate
  );
  $: inlineSceneVideoSelectedModelAvailable = inlineSceneVideoTemplateAvailable(
    inlineSceneVideoCapabilities,
    inlineSceneVideoModelTemplate
  );
  $: inlineSceneVideoTiming = inlineSceneVideoDimensions(inlineSceneAspectRatio, inlineSceneVideoModelTemplate);
  $: portraitVideoCurrent = Boolean(
    generatedPortraitVideo
    && portraitVideoRequest
    && generatedPortraitVideo.requestKey === portraitVideoRequestKey(portraitVideoRequest)
  );
  $: portraitVideoMounted = Boolean(
    expressionsEnabled
    && portraitMotionEnabled
    && generatedPortraitVideoUrl
    && portraitVideoCurrent
    && !portraitBusy
    && !portraitVideoBusy
  );
  $: portraitVideoVisible = portraitVideoMounted && portraitVideoPlaybackState === 'playing';
  $: inlineSceneSidecarRequest = true
    ? currentInlineSceneSidecarRequest(
        conversationId,
        messages,
        finalizedInlineSceneSource,
        scenarioSceneProfiles
      )
    : null;
  $: inlineSceneApplies = true && inlineSceneAppliesToTranscript(
    generatedInlineScene,
    finalizedInlineSceneSource,
    inlineSceneEpoch,
    conversationId,
    messages
  );
  $: inlineSceneCurrent = inlineSceneApplies && inlineSceneMatchesSettings(
    generatedInlineScene,
    inlineSceneAspectRatio,
    inlineSceneMegapixels,
    scenarioSceneProfiles,
    inlineSceneStillMode
  );
  $: inlineSceneVideoRequest = currentInlineSceneVideoRequest(
    generatedInlineScene,
    inlineSceneCurrent,
    inlineSceneVideoModelTemplate
  );
  $: inlineSceneH3ReferenceSummary = inlineSceneVideoRequest && isMiniMaxH3InlineSceneVideoTemplate(inlineSceneVideoRequest.modelTemplate)
    ? ''
    : '';
  $: inlineSceneH3StillReferenceSummary = '';
  $: inlineSceneVideoCurrent = Boolean(
    generatedInlineSceneVideo
    && inlineSceneVideoRequest
    && generatedInlineSceneVideo.requestKey === inlineSceneVideoRequestKey(inlineSceneVideoRequest)
  );
  $: inlineSceneVideoMounted = Boolean(
    inlineSceneMotionEnabled
    && generatedInlineSceneVideoUrl
    && inlineSceneVideoCurrent
    && !inlineSceneBusy
    && !inlineSceneVideoBusy
  );
  $: inlineSceneVideoVisible = inlineSceneVideoMounted && inlineSceneVideoPlaybackState === 'playing';
  $: scheduleExpressionReconciliation(
    true && expressionsEnabled,
    sidecarPersistenceReady,
    sidecarPersistenceAvailable,
    streaming,
    sidecarBusy,
    expressionSnapshot,
    expressionCurrent
  );
  $: schedulePortraitReconciliation(
    true
      && expressionsEnabled
      && scenarioPortraitGenerationReady(activeCard, scenarioCatalogSettled),
    portraitCapabilities,
    portraitPersistenceReady && (
      !isScenarioCard(activeCard)
      || (bodyReferenceOverlayReady
        && bodyReferenceOverlayCorruptProfileIds.length === 0
        && !bodyReferenceOverlayBusyProfileId)
    ),
    portraitPersistenceAvailable,
    portraitBusy,
    portraitRequest,
    portraitCurrent,
    stageRetryTick
  );
  $: schedulePortraitVideoReconciliation(
    true && expressionsEnabled,
    portraitMotionEnabled,
    portraitVideoCapabilities,
    portraitVideoPersistenceReady,
    portraitVideoPersistenceAvailable,
    portraitBusy,
    portraitVideoBusy,
    portraitVideoRequest,
    portraitVideoCurrent,
    portraitVideoRestoreNeeded,
    stageRetryTick
  );
  $: scheduleInlineSceneReconciliation(
    true && inlineScenesEnabled,
    inlineSceneCapabilities,
    inlineScenePersistenceReady && bodyReferenceOverlayReady && !bodyReferenceOverlayBusyProfileId,
    inlineScenePersistenceAvailable,
    streaming,
    inlineSceneBusy,
    inlineSceneSidecarRequest,
    inlineSceneCurrent,
    inlineSceneAspectRatio,
    inlineSceneMegapixels,
    scenarioSceneProfiles,
    inlineSceneStillMode,
    // Continuity inputs: the caption landing, the portrait failing, or the bounded wait
    // expiring must each re-run this, otherwise a deferred scene waits for an unrelated
    // change.
    [
      subjectCaptionSettledKeys,
      portraitRequest,
      portraitError,
      sidecarError,
      expressionSnapshot,
      expressionCurrent,
      portraitCapabilities,
      portraitDisplayProfile,
      continuityWaitTick,
      stageRetryTick
    ]
  );
  $: scheduleInlineSceneVideoReconciliation(
    true && inlineScenesEnabled,
    inlineSceneMotionEnabled,
    inlineSceneVideoCapabilities,
    inlineSceneVideoPersistenceReady && bodyReferenceOverlayReady && !bodyReferenceOverlayBusyProfileId,
    inlineSceneVideoPersistenceAvailable,
    inlineSceneVideoRestorationPending,
    streaming,
    inlineSceneBusy,
    inlineSceneVideoBusy,
    inlineSceneVideoError,
    inlineSceneVideoRequest,
    inlineSceneVideoCurrent,
    stageRetryTick
  );

  const fictionStarters = [
    'Write the opening beat of a tense science-fiction scene.',
    'Help me develop a character with a dangerous secret.',
    'Continue a conversation aboard a damaged starship.'
  ];
  const assistantStarters = [
    'Help me prioritize the three outcomes that matter today.',
    'Turn these rough notes into a concrete plan.',
    'Draft a concise message from the context I provide.'
  ];
  $: starters = false
    ? assistantStarters
    : fictionStarters;

  function handleInlineSceneVideoPageHide() {
    inlineSceneVideoComponentDestroying = true;
    portraitVideoElement?.pause();
    inlineSceneVideoElement?.pause();
    resetPortraitVideoPlayback();
    resetInlineSceneVideoPlayback();
  }

  async function handleInlineSceneVideoPageShow() {
    inlineSceneVideoComponentDestroying = false;
    if (portraitVideoMounted) resetPortraitVideoPlayback('starting');
    if (inlineSceneVideoMounted) resetInlineSceneVideoPlayback('starting');
    await tick();
    if (portraitVideoElement && portraitVideoMounted) attemptPortraitVideoPlayback(portraitVideoElement);
    if (inlineSceneVideoElement && inlineSceneVideoMounted) attemptInlineSceneVideoPlayback(inlineSceneVideoElement);
  }

  onMount(() => {
    window.addEventListener('pagehide', handleInlineSceneVideoPageHide);
    window.addEventListener('pageshow', handleInlineSceneVideoPageShow);
    restoreWorkspaceState();
    activeScenarioStarterId = localStorage.getItem(activeScenarioStarterStorageKey) ?? '';

    const savedCard = localStorage.getItem(cardStorageKey);
    if (savedCard) {
      try {
        activeCard = normalizeCharacterCard(JSON.parse(savedCard));
        cardSourceIdentifier = characterSourceIdentifier(localStorage.getItem(cardSourceIdentifierStorageKey) ?? '');
        portraitDataUrl = localStorage.getItem(portraitStorageKey) ?? '';
        embeddedLorebook = embeddedLoreFromCard(activeCard);
        if (messages.length === 0 && true) {
          messages = freshConversation();
          bindAuthoredFictionOpeningReceipt();
          persist();
        } else if (recoverCanonicalAuthoredOpeningReceipt()) {
          persist();
        }
      } catch {
        localStorage.removeItem(cardStorageKey);
        localStorage.removeItem(portraitStorageKey);
        localStorage.removeItem(cardSourceIdentifierStorageKey);
      }
    }

    void restoreLorebooks();
    loreEnabled = localStorage.getItem(loreEnabledStorageKey) !== 'false';
    personaDescription = localStorage.getItem(personaDescriptionStorageKey) ?? '';
    const savedLoreTimedState = localStorage.getItem(loreTimedStateStorageKey);
    if (savedLoreTimedState && messages.length > 0) {
      try {
        loreTimedState = normalizeLoreTimedState(JSON.parse(savedLoreTimedState));
      } catch {
        localStorage.removeItem(loreTimedStateStorageKey);
      }
    } else {
      localStorage.removeItem(loreTimedStateStorageKey);
    }
    const savedLoreSettings = localStorage.getItem(loreSettingsStorageKey);
    if (savedLoreSettings) {
      try {
        loreSettings = resolveLorebookSettings(JSON.parse(savedLoreSettings));
      } catch {
        localStorage.removeItem(loreSettingsStorageKey);
      }
    }

    const savedTokenLimit = Number(localStorage.getItem('mullet.response-token-limit.v2'));
    if (Number.isInteger(savedTokenLimit) && savedTokenLimit >= 1 && savedTokenLimit <= data.maxTokens) {
      tokenLimit = savedTokenLimit;
    }
    sidecarState = emptySidecarState(conversationId);
    mediaEnabled = localStorage.getItem(mediaEnabledStorageKey) !== 'false';
    expressionsEnabled = mediaEnabled;
    portraitMotionEnabled = mediaEnabled;
    const savedPortraitVideoModelTemplate = localStorage.getItem(portraitVideoModelTemplateStorageKey);
    portraitVideoModelTemplate = savedPortraitVideoModelTemplate === PORTRAIT_VIDEO_TEMPLATE_ID
      || savedPortraitVideoModelTemplate === MINIMAX_H3_PORTRAIT_VIDEO_TEMPLATE_ID
      ? savedPortraitVideoModelTemplate as PortraitVideoTemplateId
      : PORTRAIT_VIDEO_TEMPLATE_ID;
    const savedPortraitVideoMode = localStorage.getItem(portraitVideoModeStorageKey);
    portraitVideoMode = PORTRAIT_VIDEO_MODES.some(({ id }) => id === savedPortraitVideoMode)
      ? savedPortraitVideoMode as PortraitVideoMode
      : PORTRAIT_VIDEO_MODE_LOOP_FLF;
    const savedPortraitVideoDuration = Number(localStorage.getItem(portraitVideoDurationStorageKey));
    portraitVideoDurationSeconds = PORTRAIT_VIDEO_DURATIONS.includes(savedPortraitVideoDuration as PortraitVideoDurationSeconds)
      ? savedPortraitVideoDuration as PortraitVideoDurationSeconds
      : PORTRAIT_VIDEO_DURATION_SECONDS;
    localStorage.setItem(portraitVideoModelTemplateStorageKey, portraitVideoModelTemplate);
    localStorage.setItem(portraitVideoModeStorageKey, portraitVideoMode);
    localStorage.setItem(portraitVideoDurationStorageKey, String(portraitVideoDurationSeconds));
    inlineScenesEnabled = mediaEnabled;
    inlineSceneMotionEnabled = mediaEnabled;
    const savedInlineSceneStillMode = localStorage.getItem(inlineSceneStillModeStorageKey);
    inlineSceneStillMode = savedInlineSceneStillMode === 'automatic'
      || false
      ? savedInlineSceneStillMode as InlineSceneStillMode
      : 'automatic';
    localStorage.setItem(inlineSceneStillModeStorageKey, inlineSceneStillMode);
    const savedInlineSceneVideoModelTemplate = localStorage.getItem(inlineSceneVideoModelTemplateStorageKey);
    inlineSceneVideoModelTemplate = savedInlineSceneVideoModelTemplate === MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID
      || savedInlineSceneVideoModelTemplate === 'removed'
      || savedInlineSceneVideoModelTemplate === 'removed'
      || savedInlineSceneVideoModelTemplate === MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID
      ? savedInlineSceneVideoModelTemplate as InlineSceneVideoTemplateId
      : MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID;
    localStorage.setItem(inlineSceneVideoModelTemplateStorageKey, inlineSceneVideoModelTemplate);
    restorePortraitSettings();
    restoreInlineSceneSettings();
    restoreInlineSceneFinalizedSource();
    restoreScenarioOpeningInlineSceneSourceIfNeeded();
    restoreSubjectDescriptors();
    void restoreExpressionAndGeneratedMedia();
    void restoreInlineSceneAndMotion();
    void loadPortraitGenerator();
    void loadPortraitVideoGenerator();
    void loadInlineSceneVideoGenerator();
    void loadScenarioCatalog();
  });

  function restoreWorkspaceState() {
    const loaded = loadStoredWorkspace(localStorage, crypto.randomUUID());
    conversationId = loaded.workspace.conversationId;
    messages = loaded.workspace.messages;
    finalizedFictionResponse = loaded.workspace.finalizedFictionResponse;
    if (loaded.disposition === 'repaired') {
      noticeMessage = 'Stored response-finalization state was repaired; conversation retained.';
    } else if (loaded.disposition === 'reset') {
      errorMessage = 'Stored workspace was invalid and was reset.';
    }
  }

  onDestroy(() => {
    inlineSceneVideoComponentDestroying = true;
    portraitVideoPlaybackToken += 1;
    inlineSceneVideoPlaybackToken += 1;
    clearPortraitVideoPlaybackTimer();
    clearInlineSceneVideoPlaybackTimer();
    portraitVideoElement?.pause();
    inlineSceneVideoElement?.pause();
    if (browser) window.removeEventListener('pagehide', handleInlineSceneVideoPageHide);
    if (browser) window.removeEventListener('pageshow', handleInlineSceneVideoPageShow);
    portraitController?.abort();
    for (const state of [portraitRetry, portraitVideoRetry, inlineSceneRetry, inlineSceneVideoRetry]) {
      if (state.timer !== null) window.clearTimeout(state.timer);
      state.timer = null;
    }
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    if (expressionRetryTimer !== null) window.clearTimeout(expressionRetryTimer);
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneVideoGeneration += 1;
    inlineSceneVideoController?.abort();
    if (generatedPortraitUrl) URL.revokeObjectURL(generatedPortraitUrl);
    if (generatedPortraitVideoUrl) URL.revokeObjectURL(generatedPortraitVideoUrl);
    for (const { url } of inlineSceneClips.values()) URL.revokeObjectURL(url);
  });

  function restorePortraitSettings() {
    portraitSubject = localStorage.getItem(portraitSubjectStorageKey)?.trim()
      || (activeCard && !isScenarioCard(activeCard) ? activeCard.data.name : '');
    portraitSetting = localStorage.getItem(portraitSettingStorageKey) ?? '';
    portraitAttire = localStorage.getItem(portraitAttireStorageKey) ?? '';
    portraitLora = localStorage.getItem(portraitLoraStorageKey) ?? '';
    const currentSavedModelTemplate = localStorage.getItem(portraitModelTemplateStorageKey);
    const savedModelTemplate = migratePortraitModelTemplateSelection(
      currentSavedModelTemplate,
      null
    );
    if (savedModelTemplate) localStorage.setItem(portraitModelTemplateStorageKey, savedModelTemplate);
    else localStorage.removeItem(portraitModelTemplateStorageKey);
    localStorage.removeItem(previousPortraitModelTemplateStorageKey);
    portraitModelSelectionPersisted = savedModelTemplate !== null;
    // The scenario declares the model per character; a stored selection from the days
    // when a selector existed must not override it (Jan and Kristi moved to Krea while
    // browsers still held "z-image-turbo-v1").
    portraitModelTemplate = declaredPortraitModelTemplate();
    const savedMegapixels = Number(localStorage.getItem(portraitMegapixelsStorageKey));
    if (savedMegapixels === 0.5 || savedMegapixels === 0.75 || savedMegapixels === 0.9 || savedMegapixels === 1 || savedMegapixels === 1.5 || savedMegapixels === 2) {
      portraitMegapixels = savedMegapixels;
    }
    if (false) portraitMegapixels = 0.5;
  }

  function persistPortraitSettings() {
    localStorage.setItem(portraitSubjectStorageKey, portraitSubject.trim());
    localStorage.setItem(portraitSettingStorageKey, portraitSetting.trim());
    localStorage.setItem(portraitAttireStorageKey, portraitAttire.trim());
    if (portraitLora) localStorage.setItem(portraitLoraStorageKey, portraitLora);
    else localStorage.removeItem(portraitLoraStorageKey);
    localStorage.setItem(portraitMegapixelsStorageKey, String(portraitMegapixels));
    portraitController?.abort();
    lastPortraitAttemptKey = '';
    portraitError = '';
    invalidatePortraitVideoForPortraitChange(true);
  }

  // The scenario data declares model_template per character: Blake's 7 subjects are
  // qwen-image-edit-2511-reference-v1 (identity reference), cabin subjects are
  // z-image-turbo-v1 (trained subject LoRA). Honour that instead of forcing one model
  // on every scenario, which is what the H3 default did.
  function declaredPortraitModelTemplate(): PortraitModelTemplate {
    if (!isScenarioCard(activeCard)) return PORTRAIT_TEMPLATE_ID;
    return scenarioStarterPortraitProfile(activeCard, activeScenarioStarterId)?.modelTemplate
      ?? PORTRAIT_TEMPLATE_ID;
  }

  function persistPortraitModelTemplate() {
    if (!portraitCapabilities?.templates.some(({ template }) => template.id === portraitModelTemplate)) {
      portraitModelTemplate = declaredPortraitModelTemplate();
    }
    if (false) portraitMegapixels = 0.5;
    portraitModelSelectionPersisted = true;
    localStorage.setItem(portraitModelTemplateStorageKey, portraitModelTemplate);
    portraitController?.abort();
    lastPortraitAttemptKey = '';
    portraitError = '';
    invalidatePortraitVideoForPortraitChange(true);
  }

  function restoreInlineSceneSettings() {
    const savedAspect = localStorage.getItem(inlineSceneAspectStorageKey);
    if (savedAspect === '3:2' || savedAspect === '4:3' || savedAspect === '5:4' || savedAspect === '16:9') {
      inlineSceneAspectRatio = savedAspect;
    }
    const savedMegapixels = Number(localStorage.getItem(inlineSceneMegapixelsStorageKey));
    if (savedMegapixels === 0.5 || savedMegapixels === 0.75 || savedMegapixels === 0.9 || savedMegapixels === 1 || savedMegapixels === 1.5 || savedMegapixels === 2) {
      inlineSceneMegapixels = savedMegapixels;
    }
  }

  function persistInlineSceneSettings() {
    localStorage.setItem(inlineSceneAspectStorageKey, inlineSceneAspectRatio);
    localStorage.setItem(inlineSceneMegapixelsStorageKey, String(inlineSceneMegapixels));
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    inlineSceneError = '';
    lastInlineSceneAttemptKey = '';
    suspendInlineSceneVideoForStaticChange();
  }

  function persistInlineSceneStillMode() {
    if (
      inlineSceneStillMode !== 'automatic'
      && true
    ) inlineSceneStillMode = 'automatic';
    localStorage.setItem(inlineSceneStillModeStorageKey, inlineSceneStillMode);
    persistInlineSceneSettings();
  }

  function inlineSceneStoredEpochIsCurrent(epoch: string): boolean {
    const saved = localStorage.getItem(inlineSceneFinalizedStorageKey);
    if (!saved) return false;
    try {
      const parsed = JSON.parse(saved);
      return parsed && typeof parsed === 'object' && parsed.epoch === epoch;
    } catch {
      return false;
    }
  }

  function restoreInlineSceneFinalizedSource() {
    const saved = localStorage.getItem(inlineSceneFinalizedStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || !isSidecarConversationId(parsed.epoch)) throw new Error('invalid inline-scene epoch');
      let migratedLegacySource = false;
      let source: InlineSceneSource;
      try {
        source = normalizeInlineSceneSource(parsed.source);
      } catch {
        source = inlineSceneSourceForCompletedTurn(normalizeTranscriptSource(parsed.source));
        migratedLegacySource = true;
      }
      if (source.sourceKind === 'scenario_opening' && !scenarioCatalogSettled) return;
      if (
        source.conversationId !== conversationId
        || !inlineSceneSourceMatchesMessages(source, conversationId, messages)
        || !inlineSceneSourceMatchesActiveScenario(source)
      ) {
        throw new Error('inline-scene finalized source does not match this transcript');
      }
      inlineSceneEpoch = parsed.epoch;
      finalizedInlineSceneSource = source;
      if (migratedLegacySource) {
        localStorage.setItem(inlineSceneFinalizedStorageKey, JSON.stringify({ epoch: parsed.epoch, source }));
      }
    } catch {
      inlineSceneEpoch = '';
      finalizedInlineSceneSource = null;
      localStorage.removeItem(inlineSceneFinalizedStorageKey);
    }
  }

  async function restoreBodyReferenceOverlays(
    profileSetKey: string,
    profiles: readonly ScenarioPortraitProfile[]
  ) {
    const restoreGeneration = ++bodyReferenceOverlayRestoreGeneration;
    bodyReferenceOverlayReady = false;
    bodyReferenceOverlayCorruptProfileIds = [];
    bodyReferenceOverlayError = '';
    const settled = await Promise.allSettled(profiles.map((profile) => (
      loadBodyReferenceOverlay(profile.id, profile.fingerprint)
    )));
    if (
      restoreGeneration !== bodyReferenceOverlayRestoreGeneration
      || bodyReferenceOverlayProfileSetKey !== profileSetKey
    ) return;
    const restored: StoredBodyReferenceOverlay[] = [];
    const corruptProfileIds: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value) restored.push(result.value);
        return;
      }
      corruptProfileIds.push(profiles[index].id);
    });
    bodyReferenceOverlays = restored;
    bodyReferenceOverlayCorruptProfileIds = corruptProfileIds;
    if (corruptProfileIds.length > 0) {
      bodyReferenceOverlayReady = false;
      bodyReferenceOverlayError = `Saved body and wardrobe references failed verification for profile IDs: ${corruptProfileIds.join(', ')}. Portrait, scene-image, and scene-motion generation are blocked until Remove corrupt saved ref is used for each listed profile.`;
      return;
    }
    bodyReferenceOverlayReady = true;
  }

  function managedBodyReferenceForProfile(profile: ScenarioPortraitProfile): StoredBodyReferenceOverlay | null {
    return bodyReferenceOverlays.find((overlay) => (
      overlay.profileId === profile.id
      && overlay.baseProfileFingerprint === profile.fingerprint
    )) ?? null;
  }

  function corruptBodyReferenceForProfile(profile: ScenarioPortraitProfile): boolean {
    return bodyReferenceOverlayCorruptProfileIds.includes(profile.id);
  }

  function bodyReferenceReadyCount(): number {
    return scenarioSceneProfiles.filter((profile) => profile.bodyReferenceImage !== null).length;
  }

  async function fileAsBodyReferencePng(file: File): Promise<Blob> {
    if (
      file.size < 24
      || file.size > 20 * 1024 * 1024
      || (file.type !== '' && file.type.toLowerCase() !== 'image/png')
    ) {
      throw new Error('Body and wardrobe reference must be a PNG no larger than 20 MiB.');
    }
    const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    if (
      header[0] !== 0x89 || header[1] !== 0x50 || header[2] !== 0x4e || header[3] !== 0x47
      || header[4] !== 0x0d || header[5] !== 0x0a || header[6] !== 0x1a || header[7] !== 0x0a
      || header[8] !== 0x00 || header[9] !== 0x00 || header[10] !== 0x00 || header[11] !== 0x0d
      || header[12] !== 0x49 || header[13] !== 0x48 || header[14] !== 0x44 || header[15] !== 0x52
    ) throw new Error('Body and wardrobe reference has an invalid PNG header.');
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(16, false) !== bodyReferenceWidth || view.getUint32(20, false) !== bodyReferenceHeight) {
      throw new Error(`Body and wardrobe reference must be exactly ${bodyReferenceWidth}×${bodyReferenceHeight} (9:16).`);
    }
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width !== bodyReferenceWidth || bitmap.height !== bodyReferenceHeight) {
        throw new Error(`Body and wardrobe reference must decode as exactly ${bodyReferenceWidth}×${bodyReferenceHeight}.`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = bodyReferenceWidth;
      canvas.height = bodyReferenceHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare the body and wardrobe reference.');
      context.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('This browser could not encode the body and wardrobe reference.'));
        }, 'image/png');
      });
      if (png.size > 20 * 1024 * 1024) {
        throw new Error('Encoded body and wardrobe reference exceeds 20 MiB.');
      }
      return png;
    } finally {
      bitmap.close();
    }
  }

  async function importBodyReference(profile: ScenarioPortraitProfile, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (
      !file
      || !bodyReferenceOverlayReady
      || bodyReferenceOverlayCorruptProfileIds.length > 0
      || bodyReferenceOverlayBusyProfileId
      || portraitBusy
      || inlineSceneBusy
      || inlineSceneVideoBusy
    ) return;
    const operationProfileSetKey = bodyReferenceOverlayProfileSetKey;
    const operationProfiles = [...scenarioBaseSceneProfiles];
    bodyReferenceOverlayBusyProfileId = profile.id;
    bodyReferenceOverlayError = '';
    try {
      const png = await fileAsBodyReferencePng(file);
      const overlay = await createBodyReferenceOverlay(profile, png);
      await saveBodyReferenceOverlay(overlay);
      if (bodyReferenceOverlayProfileSetKey === operationProfileSetKey) {
        await restoreBodyReferenceOverlays(operationProfileSetKey, operationProfiles);
      }
    } catch (cause) {
      if (bodyReferenceOverlayProfileSetKey === operationProfileSetKey) {
        bodyReferenceOverlayError = cause instanceof Error
          ? cause.message
          : 'Body and wardrobe reference could not be saved.';
      }
    } finally {
      bodyReferenceOverlayBusyProfileId = '';
    }
  }

  async function clearBodyReference(profile: ScenarioPortraitProfile) {
    const corruptReference = corruptBodyReferenceForProfile(profile);
    if (
      bodyReferenceOverlayBusyProfileId
      || portraitBusy
      || inlineSceneBusy
      || inlineSceneVideoBusy
      || (!bodyReferenceOverlayReady && !corruptReference)
    ) return;
    const operationProfileSetKey = bodyReferenceOverlayProfileSetKey;
    const operationProfiles = [...scenarioBaseSceneProfiles];
    bodyReferenceOverlayBusyProfileId = profile.id;
    bodyReferenceOverlayError = '';
    try {
      await removeBodyReferenceOverlay(profile.id, profile.fingerprint);
      if (bodyReferenceOverlayProfileSetKey === operationProfileSetKey) {
        await restoreBodyReferenceOverlays(operationProfileSetKey, operationProfiles);
      }
    } catch (cause) {
      if (bodyReferenceOverlayProfileSetKey === operationProfileSetKey) {
        bodyReferenceOverlayError = cause instanceof Error
          ? cause.message
          : 'Body and wardrobe reference could not be removed.';
      }
    } finally {
      bodyReferenceOverlayBusyProfileId = '';
    }
  }

  function appendManagedBodyReferenceParts(form: FormData, hashes: readonly string[]) {
    const requestedHashes = new Set(hashes);
    const appendedHashes = new Set<string>();
    for (const overlay of bodyReferenceOverlays) {
      if (
        !requestedHashes.has(overlay.referenceImage.sha256)
        || appendedHashes.has(overlay.referenceImage.sha256)
      ) continue;
      form.append('reference', overlay.image, overlay.referenceImage.name);
      appendedHashes.add(overlay.referenceImage.sha256);
    }
  }

  function portraitManagedBodyReferenceHashes(_request: PortraitRequest): string[] {
    // Managed body references belonged to the removed 20-step H3 still.
    return [];
  }

  function inlineSceneManagedBodyReferenceHashes(request: InlineSceneImageRequest): string[] {
    if (request.modelTemplate === INLINE_SCENE_QWEN_TEMPLATE_ID) {
      return inlineSceneQwenReferencePlan(request).flatMap((entry) => (
        entry.kind === 'body_wardrobe' ? [entry.referenceImage.sha256] : []
      ));
    }
    return [];
  }

  function inlineSceneVideoManagedBodyReferenceHashes(_request: InlineSceneVideoRequest): string[] {
    // The scene loop animates the accepted still and takes no identity references.
    return [];
  }


  function currentInlineSceneSidecarRequest(
    currentConversationId: string,
    currentMessages: readonly Message[],
    source: InlineSceneSource | null,
    profiles: readonly ScenarioPortraitProfile[]
  ): InlineSceneRequest | null {
    if (!source || profiles.length < 1) return null;
    try {
      const candidates: InlineSceneSubjectCandidate[] = profiles.map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        aliases: profile.aliases,
        profileFingerprint: profile.fingerprint
      }));
      return buildInlineSceneRequest(currentConversationId, currentMessages, source, candidates);
    } catch {
      return null;
    }
  }

  function inlineSceneAppliesToTranscript(
    scene: StoredInlineScene | null,
    source: InlineSceneSource | null,
    epoch: string,
    currentConversationId: string,
    currentMessages: readonly Message[]
  ): boolean {
    return Boolean(
      scene
      && source
      && scene.epoch === epoch
      && scene.conversationId === currentConversationId
      && inlineSceneSourcesMatch(scene.request.source, source)
      && inlineSceneSourceMatchesMessages(scene.request.source, currentConversationId, currentMessages)
    );
  }

  function inlineSceneSourceBelongsToCurrentAncestry(
    candidate: InlineSceneSource,
    current: InlineSceneSource,
    currentConversationId: string,
    currentMessages: readonly Message[]
  ): boolean {
    return candidate.conversationId === currentConversationId
      && current.conversationId === currentConversationId
      && candidate.messageCount <= current.messageCount
      && inlineSceneSourceMatchesMessages(candidate, currentConversationId, currentMessages)
      && inlineSceneSourceMatchesMessages(current, currentConversationId, currentMessages);
  }

  function inlineSceneAncestralMasterScene(
    scene: StoredInlineScene | null,
    request: InlineSceneRequest | null,
    currentConversationId: string,
    currentMessages: readonly Message[]
  ): StoredInlineScene | null {
    if (
      !scene
      || !request
      || scene.request.source.messageCount >= request.source.messageCount
      || !inlineSceneSourceBelongsToCurrentAncestry(
        scene.request.source,
        request.source,
        currentConversationId,
        currentMessages
      )
    ) return null;
    return scene;
  }

  function inlineSceneContinuityMasterForScene(_scene: StoredInlineScene): InlineSceneContinuityMaster | null {
    // Continuity now comes from the reference pack, which is identical every turn; there is
    // no still to promote to a master.
    return null;
  }

  // The reference pack for a cast, prepared once per profile fingerprint set and reused
  // every turn (that reuse is what keeps identities and clothing consistent).
  const inlineSceneReferenceCache = new Map<string, InlineSceneVideoReference[]>();
  async function prepareInlineSceneReferences(
    cast: InlineSceneCast,
    profiles: readonly ScenarioPortraitProfile[],
    signal: AbortSignal
  ): Promise<InlineSceneVideoReference[]> {
    const castProfiles = cast.identities.map((identity) => {
      const profile = profiles.find((candidate) => candidate.id === identity.profileId);
      if (!profile || profile.fingerprint !== identity.profileFingerprint) {
        throw new Error(`Scene subject ${identity.profileId} no longer matches the active scenario cast.`);
      }
      return profile;
    });
    const cacheKey = castProfiles.map(({ fingerprint }) => fingerprint).join('\u001f');
    const cached = inlineSceneReferenceCache.get(cacheKey);
    if (cached) return cached;
    const response = await fetch(`${base}/api/scene/references`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profiles: castProfiles.map((profile) => ({
          id: profile.id,
          fingerprint: profile.fingerprint,
          displayName: profile.displayName,
          subject: profile.subject,
          seed: profile.seed,
          subjectLora: profile.subjectLora
            ? { name: profile.subjectLora.name, trigger: profile.subjectLora.trigger, sha256: profile.subjectLora.sha256 }
            : null,
          referenceImage: profile.referenceImage
        }))
      }),
      signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload && typeof payload.message === 'string' ? payload.message : `Scene references failed (${response.status}).`;
      throw new Error(detail);
    }
    if (!payload || !Array.isArray(payload.references) || payload.references.length < 1) {
      throw new Error('Scene reference preparation returned no references.');
    }
    const references = payload.references as InlineSceneVideoReference[];
    inlineSceneReferenceCache.set(cacheKey, references);
    return references;
  }

  function inlineSceneDriverForCast(
    cast: InlineSceneCast,
    profiles: readonly ScenarioPortraitProfile[],
    continuityMaster: InlineSceneContinuityMaster | null,
    stillMode: InlineSceneStillMode
  ): InlineSceneImageDriver {
    // A subject with a trained LoRA is rendered by that LoRA on every solo scene, including
    // the second scene in a location: the alternative (a Qwen edit of the previous scene
    // as Picture 1) drops the trained face and evicts the still model from its lane.
    // Location continuity for these scenes comes from the director's prompt and the
    // caption clause, not from an image master.
    if (cast.kind === 'solo') {
      const [identity] = cast.identities;
      const profile = profiles.find((candidate) => (
        candidate.id === identity.profileId
        && candidate.fingerprint === identity.profileFingerprint
      ));
      if (profile?.subjectLora) {
        return {
          modelTemplate: profile.modelTemplate === PORTRAIT_KREA_TEMPLATE_ID ? INLINE_SCENE_KREA_TEMPLATE_ID : INLINE_SCENE_TEMPLATE_ID,
          lora: {
            path: profile.subjectLora.name,
            trigger: profile.subjectLora.trigger,
            modelHash: profile.subjectLora.sha256
          }
        };
      }
    }
    return { modelTemplate: INLINE_SCENE_QWEN_TEMPLATE_ID, lora: null };
  }

  function inlineSceneDriverAvailable(
    capabilities: InlineSceneCapabilities | null,
    driver: InlineSceneImageDriver
  ): boolean {
    return inlineSceneModelTemplateAvailable(capabilities, driver.modelTemplate)
      && (!driver.lora || capabilities?.loras.includes(driver.lora.path) === true);
  }

  function inlineSceneStillDriverLabel(modelTemplate: InlineSceneImageRequest['modelTemplate']): string {
    if (modelTemplate === INLINE_SCENE_TEMPLATE_ID) return 'Z-Image + exact linked LoRA';
    if (modelTemplate === INLINE_SCENE_KREA_TEMPLATE_ID) return 'Krea 2 + exact linked LoRA';
    if (false) return 'MiniMax H3 Ref2VA keeper still';
    return 'Qwen multi-reference master';
  }

  function inlineScenePotentialDriverAvailable(
    capabilities: InlineSceneCapabilities | null,
    profiles: readonly ScenarioPortraitProfile[],
    continuityScene: StoredInlineScene | null,
    stillMode: InlineSceneStillMode
  ): boolean {
    if (!capabilities || profiles.length < 1) return false;
    if (continuityScene) {
      return inlineSceneModelTemplateAvailable(capabilities, INLINE_SCENE_QWEN_TEMPLATE_ID);
    }
    if (inlineSceneModelTemplateAvailable(capabilities, INLINE_SCENE_QWEN_TEMPLATE_ID)) return true;
    if (!inlineSceneModelTemplateAvailable(capabilities, INLINE_SCENE_TEMPLATE_ID)) return false;
    return profiles.some((profile) => Boolean(
      profile.subjectLora
      && capabilities.loras.includes(profile.subjectLora.name)
    ));
  }

  function inlineSceneCastForResult(
    result: InlineSceneResult,
    profiles: readonly ScenarioPortraitProfile[]
  ): InlineSceneCast {
    const identities = result.output.subjectIds.map((profileId): InlineSceneIdentity => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      const resultCandidate = result.candidates.find((candidate) => candidate.id === profileId);
      if (
        !profile
        || !resultCandidate
        || resultCandidate.profileFingerprint !== profile.fingerprint
        || resultCandidate.displayName !== profile.displayName
      ) throw new Error(`Scene subject ${profileId} no longer matches the active scenario cast.`);
      return {
        profileId: profile.id,
        profileFingerprint: profile.fingerprint,
        displayName: profile.displayName,
        subject: profile.subject,
        referenceImage: profile.referenceImage,
        bodyReferenceImage: profile.bodyReferenceImage
      };
    });
    if (identities.length === 1) return { kind: 'solo', identities: identities as [InlineSceneIdentity] };
    if (identities.length === 2) return { kind: 'duo', identities: identities as [InlineSceneIdentity, InlineSceneIdentity] };
    if (identities.length === 3) return { kind: 'trio', identities: identities as [InlineSceneIdentity, InlineSceneIdentity, InlineSceneIdentity] };
    throw new Error('Scene sidecar must select one, two, or three subjects.');
  }

  function inlineSceneMatchesSettings(
    scene: StoredInlineScene | null,
    aspectRatio: InlineSceneAspectRatio,
    megapixels: InlineSceneMegapixels,
    profiles: readonly ScenarioPortraitProfile[],
    stillMode: InlineSceneStillMode
  ): boolean {
    if (!scene || profiles.length < 1) return false;
    const driver = inlineSceneDriverForCast(
      scene.request.cast,
      profiles,
      scene.request.continuityMaster ?? null,
      stillMode
    );
    return Boolean(
      scene.request.aspectRatio === aspectRatio
      && scene.request.megapixels === megapixels
      && scene.request.modelTemplate === driver.modelTemplate
      && (scene.request.lora?.path ?? null) === (driver.lora?.path ?? null)
      && (scene.request.lora?.trigger ?? null) === (driver.lora?.trigger ?? null)
      && (scene.request.lora?.modelHash ?? null) === (driver.lora?.modelHash ?? null)
      && scene.request.cast.identities.every((identity) => {
        const profile = profiles.find((candidate) => candidate.id === identity.profileId);
        return Boolean(
          profile
          && profile.fingerprint === identity.profileFingerprint
          && profile.displayName === identity.displayName
          && profile.referenceImage.name === identity.referenceImage.name
          && profile.referenceImage.sha256 === identity.referenceImage.sha256
          && profile.referenceImage.width === identity.referenceImage.width
          && profile.referenceImage.height === identity.referenceImage.height
          && (profile.bodyReferenceImage?.name ?? null) === (identity.bodyReferenceImage?.name ?? null)
          && (profile.bodyReferenceImage?.sha256 ?? null) === (identity.bodyReferenceImage?.sha256 ?? null)
          && (profile.bodyReferenceImage?.width ?? null) === (identity.bodyReferenceImage?.width ?? null)
          && (profile.bodyReferenceImage?.height ?? null) === (identity.bodyReferenceImage?.height ?? null)
        );
      })
    );
  }

  function removeInstalledInlineScene() {
    generatedInlineScene = null;
  }

  function clearInlineSceneVideoPlaybackTimer() {
    if (inlineSceneVideoPlaybackTimer === null) return;
    window.clearTimeout(inlineSceneVideoPlaybackTimer);
    inlineSceneVideoPlaybackTimer = null;
  }

  function resetInlineSceneVideoPlayback(nextState: PlaybackState = 'idle') {
    clearInlineSceneVideoPlaybackTimer();
    inlineSceneVideoPlaybackToken += 1;
    inlineSceneVideoPlaybackAttemptedToken = -1;
    inlineSceneVideoPlaybackStartSeconds = 0;
    inlineSceneVideoPlaybackState = nextState;
    inlineSceneVideoPlaybackError = '';
  }

  function inlineSceneVideoPlaybackContextIsCurrent(
    element: HTMLVideoElement,
    sourceUrl: string,
    token: number
  ): boolean {
    return Boolean(
      !inlineSceneVideoComponentDestroying
      && element === inlineSceneVideoElement
      && sourceUrl === generatedInlineSceneVideoUrl
      && token === inlineSceneVideoPlaybackToken
      && inlineSceneVideoMounted
      && inlineSceneVideoCurrent
    );
  }

  function showInlineSceneVideoStaticFallback(
    element: HTMLVideoElement,
    sourceUrl: string,
    token: number
  ) {
    if (!inlineSceneVideoPlaybackContextIsCurrent(element, sourceUrl, token)) return;
    const transition = inlineSceneVideoDecodeFailureTransition(
      inlineSceneVideoComponentDestroying,
      inlineSceneVideoRequest
    );
    if (transition.action === 'ignore') return;
    clearInlineSceneVideoPlaybackTimer();
    element.pause();
    inlineSceneVideoPlaybackState = 'fallback';
    inlineSceneVideoPlaybackError = transition.error;
    if (transition.attemptKey) lastInlineSceneVideoAttemptKey = transition.attemptKey;
  }

  function attemptInlineSceneVideoPlayback(element: HTMLVideoElement) {
    if (element !== inlineSceneVideoElement || !inlineSceneVideoMounted) return;
    const sourceUrl = generatedInlineSceneVideoUrl;
    const token = inlineSceneVideoPlaybackToken;
    const elementSourceUrl = element.currentSrc || element.src;
    if (
      !sourceUrl
      || elementSourceUrl !== sourceUrl
      || inlineSceneVideoPlaybackAttemptedToken === token
    ) return;
    inlineSceneVideoPlaybackAttemptedToken = token;
    inlineSceneVideoPlaybackState = 'starting';
    inlineSceneVideoPlaybackError = '';
    element.muted = true;
    element.defaultMuted = true;
    element.loop = true;
    element.playsInline = true;
    try {
      element.currentTime = 0;
    } catch {
      // A not-yet-seekable element can still begin from its current media time.
    }
    inlineSceneVideoPlaybackStartSeconds = element.currentTime;
    clearInlineSceneVideoPlaybackTimer();
    inlineSceneVideoPlaybackTimer = window.setTimeout(
      () => showInlineSceneVideoStaticFallback(element, sourceUrl, token),
      MEDIA_PLAYBACK_START_TIMEOUT_MS
    );
    void element.play().catch(() => showInlineSceneVideoStaticFallback(element, sourceUrl, token));
  }

  function handleInlineSceneVideoCanPlay(event: Event) {
    attemptInlineSceneVideoPlayback(event.currentTarget as HTMLVideoElement);
  }

  function handleInlineSceneVideoTimeUpdate(event: Event) {
    const element = event.currentTarget as HTMLVideoElement;
    const sourceUrl = generatedInlineSceneVideoUrl;
    const token = inlineSceneVideoPlaybackToken;
    if (
      inlineSceneVideoPlaybackState !== 'starting'
      || !inlineSceneVideoPlaybackContextIsCurrent(element, sourceUrl, token)
      || !generatedInlineSceneVideo
      || !mediaPlaybackTimeAdvanced(
        inlineSceneVideoPlaybackStartSeconds,
        element.currentTime,
        generatedInlineSceneVideo.fps,
        generatedInlineSceneVideo.durationSeconds
      )
    ) return;
    clearInlineSceneVideoPlaybackTimer();
    inlineSceneVideoPlaybackState = 'playing';
    inlineSceneVideoPlaybackError = '';
  }

  function retryInlineSceneVideoPlayback() {
    const element = inlineSceneVideoElement;
    if (!element || !inlineSceneVideoMounted) return;
    resetInlineSceneVideoPlayback('starting');
    attemptInlineSceneVideoPlayback(element);
  }

  function inlineSceneClipMessageIndex(video: StoredInlineSceneVideo): number {
    return video.request.source.sceneRequest.source.messageIndex;
  }

  // Drops the pointer to the newest clip. The transcript's clips are untouched: they
  // belong to their own messages and outlive every later turn.
  function removeInstalledInlineSceneVideo() {
    inlineSceneVideoElement?.pause();
    resetInlineSceneVideoPlayback();
    generatedInlineSceneVideoUrl = '';
    generatedInlineSceneVideo = null;
  }

  function rememberInlineSceneClip(video: StoredInlineSceneVideo): string {
    const index = inlineSceneClipMessageIndex(video);
    const previous = inlineSceneClips.get(index);
    if (previous) {
      if (previous.video.requestKey === video.requestKey) return previous.url;
      URL.revokeObjectURL(previous.url);
    }
    const url = URL.createObjectURL(video.video);
    inlineSceneClips.set(index, { video, url, failed: false });
    inlineSceneClips = inlineSceneClips;
    return url;
  }

  function failInlineSceneClip(messageIndex: number) {
    const entry = inlineSceneClips.get(messageIndex);
    if (!entry || entry.failed) return;
    inlineSceneClips.set(messageIndex, { ...entry, failed: true });
    inlineSceneClips = inlineSceneClips;
    if (generatedInlineSceneVideo && inlineSceneClipMessageIndex(generatedInlineSceneVideo) === messageIndex) {
      inlineSceneVideoError = 'The scene clip could not be played.';
    }
  }

  function forgetInlineSceneClips() {
    for (const { url } of inlineSceneClips.values()) URL.revokeObjectURL(url);
    inlineSceneClips = new Map();
    removeInstalledInlineSceneVideo();
  }

  function installGeneratedInlineSceneVideo(video: StoredInlineSceneVideo) {
    inlineSceneVideoElement?.pause();
    resetInlineSceneVideoPlayback();
    generatedInlineSceneVideo = video;
    generatedInlineSceneVideoUrl = rememberInlineSceneClip(video);
    resetInlineSceneVideoPlayback('starting');
  }

  function installGeneratedInlineScene(scene: StoredInlineScene, preserveStoredMotion = false) {
    removeInstalledInlineScene();
    generatedInlineScene = scene;
    if (!preserveStoredMotion) invalidateInlineSceneVideoForNewStaticScene();
  }

  function beginInlineScenePersistenceOperation() {
    inlineScenePersistenceOperations += 1;
    inlineScenePersistenceReady = false;
  }

  function endInlineScenePersistenceOperation() {
    inlineScenePersistenceOperations = Math.max(0, inlineScenePersistenceOperations - 1);
    inlineScenePersistenceReady = inlineScenePersistenceOperations === 0;
  }

  function disableInlineScenePersistence(cause: unknown) {
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    inlineScenePersistenceOperations = 0;
    inlineScenePersistenceAvailable = false;
    inlineScenePersistenceReady = true;
    inlineScenesEnabled = false;
    localStorage.setItem(inlineScenesEnabledStorageKey, 'false');
    inlineSceneError = cause instanceof Error ? cause.message : 'Inline-scene persistence failed.';
  }

  async function restoreGeneratedInlineScene() {
    const generation = inlineSceneGeneration;
    const epoch = inlineSceneEpoch;
    const source = finalizedInlineSceneSource;
    beginInlineScenePersistenceOperation();
    try {
      await restoreStoredInlineScene({
        exclusive: runStoredInlineSceneExclusive,
        load: loadStoredInlineScene,
        discardInvalid: clearStoredInlineScene,
        isCurrent: () => generation === inlineSceneGeneration
          && epoch === inlineSceneEpoch
          && Boolean(source && finalizedInlineSceneSource && inlineSceneSourcesMatch(source, finalizedInlineSceneSource))
          && inlineSceneStoredEpochIsCurrent(epoch),
        accepts: (scene) => scene.conversationId === conversationId
          && Boolean(source && inlineSceneSourceBelongsToCurrentAncestry(
            scene.request.source,
            source,
            conversationId,
            messages
          )),
        install: (scene) => installGeneratedInlineScene(scene, true)
      });
    } catch (cause) {
      if (cause instanceof StoredInlineSceneIntegrityError) {
        inlineSceneError = cause instanceof Error ? cause.message : 'Stored inline-scene integrity verification failed.';
      } else disableInlineScenePersistence(cause);
    } finally {
      endInlineScenePersistenceOperation();
    }
  }

  async function restoreInlineSceneAndMotion() {
    await runInlineSceneVideoRestoration(async () => {
      await restoreGeneratedInlineScene();
      await loadInlineSceneGenerator();
      await tick();
      await restoreInlineSceneClipHistory();
      await restoreGeneratedInlineSceneVideo();
    });
  }

  function currentInlineSceneVideoRequest(
    scene: StoredInlineScene | null,
    current: boolean,
    modelTemplate: InlineSceneVideoTemplateId
  ): InlineSceneVideoRequest | null {
    if (!scene || !current) return null;
    try {
      return buildInlineSceneVideoRequest({
        conversationId: scene.conversationId,
        epoch: scene.epoch,
        request: scene.request,
        references: scene.references
      }, modelTemplate);
    } catch {
      return null;
    }
  }

  function beginInlineSceneVideoPersistenceOperation() {
    inlineSceneVideoPersistenceOperations += 1;
    inlineSceneVideoPersistenceReady = false;
  }

  function endInlineSceneVideoPersistenceOperation() {
    inlineSceneVideoPersistenceOperations = Math.max(0, inlineSceneVideoPersistenceOperations - 1);
    inlineSceneVideoPersistenceReady = inlineSceneVideoPersistenceOperations === 0;
  }

  function beginInlineSceneVideoRestoration() {
    inlineSceneVideoRestorationOperations += 1;
    inlineSceneVideoRestorationPending = true;
  }

  function endInlineSceneVideoRestoration() {
    inlineSceneVideoRestorationOperations = Math.max(0, inlineSceneVideoRestorationOperations - 1);
    inlineSceneVideoRestorationPending = inlineSceneVideoRestorationOperations > 0;
  }

  async function runInlineSceneVideoRestoration(operation: () => Promise<void>) {
    beginInlineSceneVideoRestoration();
    try {
      await operation();
    } finally {
      endInlineSceneVideoRestoration();
    }
  }

  function disableInlineSceneVideoPersistence(cause: unknown) {
    inlineSceneVideoGeneration += 1;
    inlineSceneVideoController?.abort();
    inlineSceneVideoController = null;
    inlineSceneVideoBusy = false;
    inlineSceneVideoPersistenceOperations = 0;
    inlineSceneVideoPersistenceAvailable = false;
    inlineSceneVideoPersistenceReady = true;
    inlineSceneVideoRestorationOperations = 0;
    inlineSceneVideoRestorationPending = false;
    inlineSceneMotionEnabled = false;
    localStorage.setItem(inlineSceneMotionEnabledStorageKey, 'false');
    forgetInlineSceneClips();
    inlineSceneVideoError = cause instanceof Error ? cause.message : 'Inline-scene motion persistence failed.';
  }

  function suspendInlineSceneVideoForStaticChange() {
    inlineSceneVideoGeneration += 1;
    inlineSceneVideoController?.abort();
    inlineSceneVideoController = null;
    inlineSceneVideoBusy = false;
    inlineSceneVideoError = '';
    lastInlineSceneVideoAttemptKey = '';
  }

  async function clearInlineSceneVideoAtGeneration(generation: number) {
    beginInlineSceneVideoPersistenceOperation();
    try {
      await runStoredInlineSceneVideoExclusive(async () => {
        if (generation !== inlineSceneVideoGeneration) return;
        await clearStoredInlineSceneVideo();
      });
    } catch (cause) {
      disableInlineSceneVideoPersistence(cause);
    } finally {
      endInlineSceneVideoPersistenceOperation();
    }
  }

  function invalidateInlineSceneVideoForNewStaticScene() {
    // Only the pointer to the newest clip moves on. Earlier responses keep theirs, in the
    // transcript and in storage.
    suspendInlineSceneVideoForStaticChange();
    removeInstalledInlineSceneVideo();
  }

  function inlineSceneVideoSourceIsCurrent(
    generation: number,
    request: InlineSceneVideoRequest,
    key: string,
    signal?: AbortSignal
  ): boolean {
    if (
      signal?.aborted
      || generation !== inlineSceneVideoGeneration
      || !inlineScenesEnabled
      || !inlineSceneMotionEnabled
      || !inlineSceneCurrent
      || !inlineSceneStoredEpochIsCurrent(request.source.epoch)
    ) return false;
    const liveRequest = currentInlineSceneVideoRequest(
      generatedInlineScene,
      inlineSceneCurrent,
      inlineSceneVideoModelTemplate
    );
    return Boolean(liveRequest && inlineSceneVideoRequestKey(liveRequest) === key);
  }

  // Reload restores every clip the conversation produced, not just the newest, and drops
  // whatever no longer belongs to it.
  async function restoreInlineSceneClipHistory() {
    if (!inlineSceneVideoPersistenceAvailable) return;
    beginInlineSceneVideoPersistenceOperation();
    try {
      const stored = await runStoredInlineSceneVideoExclusive(loadAllStoredInlineSceneVideos);
      const keep = new Set<string>();
      for (const entry of stored) {
        let verified: StoredInlineSceneVideo;
        try {
          verified = await verifyStoredInlineSceneVideo(unwrapStoredInlineSceneVideo(entry));
        } catch {
          continue;
        }
        if (verified.conversationId !== conversationId) continue;
        const index = inlineSceneClipMessageIndex(verified);
        if (index < 0 || index >= messages.length) continue;
        keep.add(verified.requestKey);
        rememberInlineSceneClip(verified);
      }
      // Never prune against an empty transcript: that would be a restore ordering bug
      // erasing the conversation's clips.
      if (messages.length > 0) await runStoredInlineSceneVideoExclusive(() => pruneStoredInlineSceneVideos(keep));
    } catch (cause) {
      disableInlineSceneVideoPersistence(cause);
    } finally {
      endInlineSceneVideoPersistenceOperation();
    }
  }

  async function restoreGeneratedInlineSceneVideo() {
    const selectedRequest = currentInlineSceneVideoRequest(
      generatedInlineScene,
      inlineSceneCurrent,
      inlineSceneVideoModelTemplate
    );
    if (!selectedRequest) {
      inlineSceneVideoPersistenceReady = true;
      return;
    }
    const generation = inlineSceneVideoGeneration;
    const key = inlineSceneVideoRequestKey(selectedRequest);
    beginInlineSceneVideoPersistenceOperation();
    try {
      await restoreStoredInlineSceneVideo({
        exclusive: runStoredInlineSceneVideoExclusive,
        load: () => loadStoredInlineSceneVideo(key),
        discardInvalid: clearStoredInlineSceneVideo,
        isCurrent: () => inlineSceneVideoSourceIsCurrent(generation, selectedRequest, key),
        accepts: (video) => video.requestKey === key,
        install: installGeneratedInlineSceneVideo
      });
    } catch (cause) {
      if (cause instanceof StoredInlineSceneVideoIntegrityError) {
        inlineSceneVideoError = cause.message;
      } else {
        disableInlineSceneVideoPersistence(cause);
      }
    } finally {
      endInlineSceneVideoPersistenceOperation();
    }
  }

  async function loadInlineSceneVideoGenerator() {
    if (inlineSceneVideoCapabilitiesLoading) return;
    inlineSceneVideoCapabilitiesLoading = true;
    inlineSceneVideoError = '';
    try {
      const response = await fetch(base + '/api/scene/video', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : 'Inline-scene motion generator failed (' + response.status + ').';
        throw new Error(detail);
      }
      inlineSceneVideoCapabilities = normalizeInlineSceneVideoCapabilities(payload);
      if (!inlineSceneVideoCapabilities.templates.some(({ template }) => template.id === inlineSceneVideoModelTemplate)) {
        inlineSceneVideoModelTemplate = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID;
        localStorage.setItem(inlineSceneVideoModelTemplateStorageKey, inlineSceneVideoModelTemplate);
      }
    } catch (cause) {
      inlineSceneVideoCapabilities = null;
      inlineSceneVideoError = cause instanceof Error ? cause.message : 'Inline-scene motion generator is unavailable.';
      scheduleCapabilityRetry('scene-video', loadInlineSceneVideoGenerator);
    } finally {
      inlineSceneVideoCapabilitiesLoading = false;
    }
  }

  function scheduleInlineSceneVideoReconciliation(
    scenesEnabled: boolean,
    motionEnabled: boolean,
    capabilities: InlineSceneVideoCapabilities | null,
    persistenceReady: boolean,
    persistenceAvailable: boolean,
    restorationPending: boolean,
    isStreaming: boolean,
    sceneBusy: boolean,
    videoBusy: boolean,
    videoError: string,
    request: InlineSceneVideoRequest | null,
    current: boolean,
    _retrySignal: unknown = null
  ) {
    if (!request) return;
    if (!inlineSceneVideoReconciliationAllowed({
      scenesEnabled,
      motionEnabled,
      capabilitiesReady: inlineSceneVideoTemplateAvailable(capabilities, request.modelTemplate),
      persistenceReady,
      persistenceAvailable,
      restorationPending,
      streaming: isStreaming,
      sceneBusy,
      videoBusy,
      videoError: Boolean(videoError),
      requestReady: true,
      current
    })) return;
    const key = inlineSceneVideoRequestKey(request);
    if (key === lastInlineSceneVideoAttemptKey) return;
    lastInlineSceneVideoAttemptKey = key;
    void generateInlineSceneVideo(request);
  }

  function inlineSceneVideoHeaderSha256(response: Response, name: string): string {
    const value = response.headers.get(name) ?? '';
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Inline-scene motion response omitted ' + name + '.');
    return value;
  }

  function inlineSceneVideoHeaderInteger(
    response: Response,
    name: string,
    minimum: number,
    maximum: number
  ): number {
    return parseInlineSceneVideoIntegerHeader(response.headers.get(name), name, minimum, maximum);
  }

  function inlineSceneVideoHeaderNumber(
    response: Response,
    name: string,
    minimum: number,
    maximum: number
  ): number {
    return parseInlineSceneVideoNumberHeader(response.headers.get(name), name, minimum, maximum);
  }

  async function generateInlineSceneVideo(
    selectedRequest: InlineSceneVideoRequest | null = inlineSceneVideoRequest
  ) {
    const selectedScene = generatedInlineScene;
    if (
      !selectedRequest
      || !selectedScene
      || !inlineScenesEnabled
      || !inlineSceneMotionEnabled
      || !inlineSceneVideoCapabilities
      || !inlineSceneVideoTemplateAvailable(inlineSceneVideoCapabilities, selectedRequest.modelTemplate)
      || inlineSceneBusy
      || inlineSceneVideoBusy
      || !bodyReferenceOverlayReady
      || Boolean(bodyReferenceOverlayBusyProfileId)
      || !inlineSceneVideoPersistenceReady
      || !inlineSceneVideoPersistenceAvailable
    ) return;
    const key = inlineSceneVideoRequestKey(selectedRequest);
    const generation = inlineSceneVideoGeneration;
    if (!inlineSceneVideoSourceIsCurrent(generation, selectedRequest, key)) return;
    lastInlineSceneVideoAttemptKey = key;
    inlineSceneVideoBusy = true;
    inlineSceneVideoError = '';
    const activeController = new AbortController();
    inlineSceneVideoController = activeController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, INLINE_SCENE_VIDEO_TIMEOUT_MS + 5_000);
    try {
      const response = await fetch(base + '/api/scene/video', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: selectedRequest }),
        signal: activeController.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : 'Inline scene motion failed (' + response.status + ').';
        throw new Error(detail);
      }
      const video = await response.blob();
      const expectedContentType = 'video/mp4';
      const minimumBytes = 12;
      if (video.type !== expectedContentType || video.size < minimumBytes) {
        throw new Error('Inline-scene motion generator returned an invalid video.');
      }
      const signature = new Uint8Array(await video.slice(0, minimumBytes).arrayBuffer());
      if (
        signature[4] !== 0x66
        || signature[5] !== 0x74
        || signature[6] !== 0x79
        || signature[7] !== 0x70
      ) throw new Error('Inline-scene motion generator returned an invalid MP4 signature.');
      const modelTemplate = response.headers.get('x-mullet-model-template') ?? '';
      const mode = response.headers.get('x-mullet-video-mode') ?? '';
      const sourceRequestSha256 = inlineSceneVideoHeaderSha256(response, 'x-mullet-source-request-sha256');
      const referencesSha256 = inlineSceneVideoHeaderSha256(response, 'x-mullet-references-sha256');
      const audioTracks = inlineSceneVideoHeaderInteger(response, 'x-mullet-audio-tracks', 0, 1);
      if (
        modelTemplate !== selectedRequest.modelTemplate
        || mode !== selectedRequest.mode
        || audioTracks !== 0
        || sourceRequestSha256 !== inlineSceneVideoSourceRequestSha256(selectedRequest)
        || referencesSha256 !== inlineSceneVideoReferencesSha256(selectedRequest)
      ) throw new Error('Inline-scene motion response provenance does not match its scene and references.');
      const videoSha256 = inlineSceneVideoHeaderSha256(response, 'x-mullet-video-sha256');
      if (await blobSha256(video) !== videoSha256) {
        throw new Error('Inline-scene motion response hash does not match its video.');
      }
      const stored = normalizeStoredInlineSceneVideo({
        spec: STORED_INLINE_SCENE_VIDEO_SPEC,
        conversationId: selectedRequest.source.conversationId,
        epoch: selectedRequest.source.epoch,
        requestKey: key,
        request: selectedRequest,
        modelTemplate,
        mode,
        promptId: response.headers.get('x-mullet-prompt-id') ?? '',
        seed: inlineSceneVideoHeaderInteger(response, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
        width: inlineSceneVideoHeaderInteger(response, 'x-mullet-width', 16, 8192),
        height: inlineSceneVideoHeaderInteger(response, 'x-mullet-height', 16, 8192),
        frames: inlineSceneVideoHeaderInteger(response, 'x-mullet-frames', 1, 10_000),
        fps: inlineSceneVideoHeaderInteger(response, 'x-mullet-fps', 1, 1_000),
        durationSeconds: inlineSceneVideoHeaderNumber(response, 'x-mullet-duration-seconds', 0.001, 3_600),
        audioTracks,
        generatedAt: Date.now(),
        referencesSha256,
        videoSha256,
        video
      });
      await commitStoredInlineSceneVideo(stored, {
        exclusive: runStoredInlineSceneVideoExclusive,
        save: saveStoredInlineSceneVideo,
        rollback: rollbackStoredInlineSceneVideoWrite,
        isCurrent: () => inlineSceneVideoSourceIsCurrent(
          generation,
          selectedRequest,
          key,
          activeController.signal
        ),
        install: installGeneratedInlineSceneVideo
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) {
          inlineSceneVideoError = 'Inline scene motion timed out after '
            + (INLINE_SCENE_VIDEO_TIMEOUT_MS + 5_000) / 1000
            + ' seconds.';
        }
      } else {
        inlineSceneVideoError = cause instanceof Error ? cause.message : 'Inline scene motion failed.';
      }
      if (inlineSceneVideoError) queueInlineSceneVideoAutomaticRetry(key);
    } finally {
      window.clearTimeout(timeoutId);
      if (inlineSceneVideoController === activeController) {
        inlineSceneVideoBusy = false;
        inlineSceneVideoController = null;
      }
    }
  }

  function queueInlineSceneVideoAutomaticRetry(key: string) {
    queueStageRetry(inlineSceneVideoRetry, key, () => lastInlineSceneVideoAttemptKey === key, () => {
      lastInlineSceneVideoAttemptKey = '';
      inlineSceneVideoError = '';
    });
  }

  function scheduleCapabilityRetry(kind: string, load: () => Promise<void>) {
    if (!browser) return;
    const count = capabilityRetryCounts[kind] ?? 0;
    if (count >= capabilityRetryLimit) return;
    capabilityRetryCounts = { ...capabilityRetryCounts, [kind]: count + 1 };
    if (capabilityRetryTimers[kind] !== undefined) window.clearTimeout(capabilityRetryTimers[kind]);
    capabilityRetryTimers = {
      ...capabilityRetryTimers,
      [kind]: window.setTimeout(() => {
        const { [kind]: _done, ...rest } = capabilityRetryTimers;
        capabilityRetryTimers = rest;
        void load();
      }, capabilityRetryDelayMs)
    };
  }

  function persistInlineSceneMotionEnabled() {
    if (!inlineSceneVideoPersistenceReady || !inlineSceneVideoPersistenceAvailable) {
      inlineSceneMotionEnabled = false;
    }
    localStorage.setItem(inlineSceneMotionEnabledStorageKey, String(inlineSceneMotionEnabled));
    inlineSceneVideoError = '';
    lastInlineSceneVideoAttemptKey = '';
    if (!inlineSceneMotionEnabled) {
      inlineSceneVideoGeneration += 1;
      inlineSceneVideoController?.abort();
      inlineSceneVideoController = null;
      inlineSceneVideoBusy = false;
      inlineSceneVideoElement?.pause();
      resetInlineSceneVideoPlayback();
    } else {
      resetInlineSceneVideoPlayback('starting');
      void runInlineSceneVideoRestoration(restoreGeneratedInlineSceneVideo);
    }
  }

  function persistInlineSceneVideoModelTemplate() {
    if (!inlineSceneVideoTemplateCapability(inlineSceneVideoCapabilities, inlineSceneVideoModelTemplate)) {
      inlineSceneVideoModelTemplate = MINIMAX_H3_REFERENCE_SCENE_TEMPLATE_ID;
    }
    localStorage.setItem(inlineSceneVideoModelTemplateStorageKey, inlineSceneVideoModelTemplate);
    inlineSceneVideoGeneration += 1;
    inlineSceneVideoController?.abort();
    inlineSceneVideoController = null;
    inlineSceneVideoBusy = false;
    inlineSceneVideoError = '';
    lastInlineSceneVideoAttemptKey = '';
    forgetInlineSceneClips();
    if (inlineSceneVideoPersistenceAvailable) {
      void clearInlineSceneVideoAtGeneration(inlineSceneVideoGeneration);
    }
  }

  function handleInlineSceneVideoDecodeError(event: Event) {
    const element = event.currentTarget as HTMLVideoElement;
    showInlineSceneVideoStaticFallback(
      element,
      element.currentSrc || element.src,
      inlineSceneVideoPlaybackToken
    );
  }

  async function loadInlineSceneGenerator() {
    if (inlineSceneCapabilitiesLoading) return;
    inlineSceneCapabilitiesLoading = true;
    inlineSceneError = '';
    let restorationStarted = false;
    try {
      const response = await fetch(`${base}/api/scene`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : `Inline-scene generator failed (${response.status}).`;
        throw new Error(detail);
      }
      const capabilities = normalizeInlineSceneCapabilities(payload);
      if (inlineSceneMotionEnabled && inlineSceneVideoPersistenceAvailable) {
        beginInlineSceneVideoRestoration();
        restorationStarted = true;
      }
      inlineSceneCapabilities = capabilities;
      await tick();
      if (
        inlineSceneMotionEnabled
        && inlineSceneVideoPersistenceReady
        && !generatedInlineSceneVideo
      ) await restoreGeneratedInlineSceneVideo();
    } catch (cause) {
      inlineSceneCapabilities = null;
      inlineSceneError = cause instanceof Error ? cause.message : 'Inline-scene generator is unavailable.';
      scheduleCapabilityRetry('scene', loadInlineSceneGenerator);
    } finally {
      if (restorationStarted) endInlineSceneVideoRestoration();
      inlineSceneCapabilitiesLoading = false;
    }
  }

  function inlineSceneAttemptKey(
    request: InlineSceneRequest,
    aspectRatio: InlineSceneAspectRatio,
    megapixels: InlineSceneMegapixels,
    profiles: readonly ScenarioPortraitProfile[],
    continuityScene: StoredInlineScene | null,
    stillMode: InlineSceneStillMode
  ): string {
    const master = continuityScene ? inlineSceneContinuityMasterForScene(continuityScene) : null;
    return [
      request.source.conversationId,
      request.source.messageCount,
      request.source.fingerprint,
      request.source.turnFingerprint,
      aspectRatio,
      megapixels,
      stillMode,
      ...profiles.flatMap((profile) => [
        profile.id,
        profile.fingerprint,
        profile.referenceImage.sha256,
        profile.bodyReferenceImage?.sha256 ?? '',
        profile.subjectLora?.name ?? '',
        profile.subjectLora?.trigger ?? '',
        profile.subjectLora?.sha256 ?? ''
      ]),
      master?.requestKey ?? '',
      master?.promptId ?? '',
      master?.seed ?? '',
      master?.generatedAt ?? '',
      master?.width ?? '',
      master?.height ?? '',
      master?.imageSha256 ?? '',
      ...(master?.cast.flatMap(({ profileId, profileFingerprint }) => [profileId, profileFingerprint]) ?? [])
    ].join('\u001f');
  }

  function scheduleInlineSceneReconciliation(
    enabled: boolean,
    capabilities: InlineSceneCapabilities | null,
    persistenceReady: boolean,
    persistenceAvailable: boolean,
    isStreaming: boolean,
    busy: boolean,
    request: InlineSceneRequest | null,
    current: boolean,
    aspectRatio: InlineSceneAspectRatio,
    megapixels: InlineSceneMegapixels,
    profiles: readonly ScenarioPortraitProfile[],
    stillMode: InlineSceneStillMode,
    _continuitySignal: unknown = null
  ) {
    if (!enabled || !capabilities || !persistenceReady || !persistenceAvailable || isStreaming || busy || !request || current || profiles.length < 1) return;
    if (!subjectContinuityReady()) return;
    const continuityScene = inlineSceneAncestralMasterScene(
      generatedInlineScene,
      request,
      conversationId,
      messages
    );
    if (!inlineScenePotentialDriverAvailable(capabilities, profiles, continuityScene, stillMode)) return;
    const key = inlineSceneAttemptKey(request, aspectRatio, megapixels, profiles, continuityScene, stillMode);
    if (key === lastInlineSceneAttemptKey) return;
    lastInlineSceneAttemptKey = key;
    void generateInlineScene(request, aspectRatio, megapixels, profiles, continuityScene, stillMode);
  }

  function inlineSceneGenerationIsCurrent(
    generation: number,
    epoch: string,
    sidecarRequest: InlineSceneRequest,
    result: InlineSceneResult | null,
    imageRequestKey: string,
    continuityMaster: InlineSceneContinuityMaster | null,
    stillMode: InlineSceneStillMode,
    signal: AbortSignal,
    submittedContinuity: string
  ): boolean {
    if (
      signal.aborted
      || generation !== inlineSceneGeneration
      || epoch !== inlineSceneEpoch
      || !inlineScenesEnabled
      || !inlineSceneStoredEpochIsCurrent(epoch)
    ) return false;
    const liveSidecar = currentInlineSceneSidecarRequest(conversationId, messages, finalizedInlineSceneSource, scenarioSceneProfiles);
    if (
      !liveSidecar
      || !inlineSceneSourcesMatch(liveSidecar.source, sidecarRequest.source)
      || JSON.stringify(liveSidecar.candidates) !== JSON.stringify(sidecarRequest.candidates)
    ) return false;
    if (!result) return true;
    if (!inlineSceneResultMatchesRequest(result, liveSidecar)) return false;
    try {
      const cast = inlineSceneCastForResult(result, scenarioSceneProfiles);
      const driver = inlineSceneDriverForCast(cast, scenarioSceneProfiles, continuityMaster, stillMode);
      const liveImageRequest = buildInlineSceneImageRequest(result, {
        ...driver,
        cast,
        // Frozen at submission: a caption that lands while the scene renders must not
        // discard the finished scene. The next turn carries the new caption.
        continuity: submittedContinuity,
        ...(continuityMaster ? { continuityMaster } : {}),
        aspectRatio: inlineSceneAspectRatio,
        megapixels: inlineSceneMegapixels
      });
      return inlineSceneImageRequestKey(liveImageRequest) === imageRequestKey;
    } catch {
      return false;
    }
  }

  function inlineSceneResponseHash(response: Response): string {
    const value = response.headers.get('x-mullet-image-sha256') ?? '';
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Inline-scene response omitted its image hash.');
    return value;
  }

  async function generateInlineScene(
    selectedSidecarRequest: InlineSceneRequest | null = inlineSceneSidecarRequest,
    selectedAspectRatio: InlineSceneAspectRatio = inlineSceneAspectRatio,
    selectedMegapixels: InlineSceneMegapixels = inlineSceneMegapixels,
    selectedProfiles: readonly ScenarioPortraitProfile[] = scenarioSceneProfiles,
    selectedContinuityScene: StoredInlineScene | null = inlineSceneAncestralMasterScene(
      generatedInlineScene,
      selectedSidecarRequest,
      conversationId,
      messages
    ),
    selectedStillMode: InlineSceneStillMode = inlineSceneStillMode
  ) {
    const selectedCapabilities = inlineSceneCapabilities;
    const attemptKey = lastInlineSceneAttemptKey;
    if (
      !selectedSidecarRequest
      || !inlineScenesEnabled
      || !selectedCapabilities
      || selectedProfiles.length < 1
      || !inlineScenePotentialDriverAvailable(
        selectedCapabilities,
        selectedProfiles,
        selectedContinuityScene,
        selectedStillMode
      )
      || inlineSceneBusy
      || !bodyReferenceOverlayReady
      || Boolean(bodyReferenceOverlayBusyProfileId)
      || !inlineScenePersistenceReady
      || !inlineScenePersistenceAvailable
    ) return;
    suspendInlineSceneVideoForStaticChange();
    const generation = inlineSceneGeneration;
    const epoch = inlineSceneEpoch;
    lastInlineSceneAttemptKey = inlineSceneAttemptKey(
      selectedSidecarRequest,
      selectedAspectRatio,
      selectedMegapixels,
      selectedProfiles,
      selectedContinuityScene,
      selectedStillMode
    );
    inlineSceneBusy = true;
    inlineSceneError = '';
    const activeController = new AbortController();
    inlineSceneController = activeController;
    let timedOut = false;
    const imageTimeoutMs = false
      ? MINIMAX_H3_INLINE_SCENE_STILL_TIMEOUT_MS
      : INLINE_SCENE_IMAGE_TIMEOUT_MS;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, INLINE_SCENE_TIMEOUT_MS + imageTimeoutMs + 10_000);
    try {
      const sidecarResponse = await fetch(`${base}/api/sidecar/scene`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selectedSidecarRequest),
        signal: activeController.signal
      });
      const sidecarPayload = await sidecarResponse.json().catch(() => null);
      if (!sidecarResponse.ok) {
        const detail = sidecarPayload && typeof sidecarPayload.message === 'string'
          ? sidecarPayload.message
          : `Inline-scene sidecar failed (${sidecarResponse.status}).`;
        throw new Error(detail);
      }
      const result = normalizeInlineSceneResult(sidecarPayload);
      if (!inlineSceneResultMatchesRequest(result, selectedSidecarRequest)) {
        throw new Error('Inline-scene sidecar returned a mismatched finalized source.');
      }
      const cast = inlineSceneCastForResult(result, selectedProfiles);
      let continuityMaster: InlineSceneContinuityMaster | null = null;
      if (selectedContinuityScene) {
        const verifiedMasterScene = await verifyStoredInlineScene(selectedContinuityScene);
        const candidateMaster = inlineSceneContinuityMasterForScene(verifiedMasterScene);
        if (candidateMaster && inlineSceneContinuityMasterEligible(cast, candidateMaster)) {
          continuityMaster = candidateMaster;
        }
      }
      const driver = inlineSceneDriverForCast(cast, selectedProfiles, continuityMaster, selectedStillMode);
      if (driver.lora) continuityMaster = null;
      if (!inlineSceneDriverAvailable(selectedCapabilities, driver)) {
        const capability = selectedCapabilities.templates.find(
          ({ template }) => template.id === driver.modelTemplate
        );
        if (driver.lora && !selectedCapabilities.loras.includes(driver.lora.path)) {
          throw new Error(`Linked scene identity LoRA is unavailable · ${driver.lora.path}`);
        }
        const diagnostics = capability?.missing.length
          ? ` Missing: ${capability.missing.join(', ')}.`
          : '';
        throw new Error(`${capability?.template.label ?? driver.modelTemplate} is unavailable for the selected scene cast.${diagnostics}`);
      }
      const imageRequest = buildInlineSceneImageRequest(result, {
        ...driver,
        cast,
        continuity: castContinuityClause(cast),
        ...(continuityMaster ? { continuityMaster } : {}),
        aspectRatio: selectedAspectRatio,
        megapixels: selectedMegapixels
      });
      const requestKey = inlineSceneImageRequestKey(imageRequest);
      if (!inlineSceneGenerationIsCurrent(
        generation,
        epoch,
        selectedSidecarRequest,
        result,
        requestKey,
        continuityMaster,
        selectedStillMode,
        activeController.signal,
        imageRequest.continuity
      )) return;
      const references = await prepareInlineSceneReferences(cast, selectedProfiles, activeController.signal);
      const generatedAt = Date.now();
      const stored = normalizeStoredInlineScene({
        spec: STORED_INLINE_SCENE_SPEC,
        conversationId: imageRequest.source.conversationId,
        epoch,
        requestKey,
        request: imageRequest,
        modelTemplate: imageRequest.modelTemplate,
        generatedAt,
        references,
        referencesSha256: inlineSceneVideoReferencesSha256(buildInlineSceneVideoRequest({
          conversationId: imageRequest.source.conversationId,
          epoch,
          request: imageRequest,
          references
        }))
      });
      await commitStoredInlineScene(stored, {
        exclusive: runStoredInlineSceneExclusive,
        save: saveStoredInlineScene,
        rollback: rollbackStoredInlineSceneWrite,
        isCurrent: () => inlineSceneGenerationIsCurrent(
          generation,
          epoch,
          selectedSidecarRequest,
          result,
          requestKey,
          continuityMaster,
          selectedStillMode,
          activeController.signal,
          imageRequest.continuity
        ),
        install: (scene) => installGeneratedInlineScene(scene)
      });
      clearStageRetry(inlineSceneRetry, attemptKey);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) inlineSceneError = `Inline scene timed out after ${(INLINE_SCENE_TIMEOUT_MS + imageTimeoutMs + 10_000) / 1000} seconds.`;
      } else {
        inlineSceneError = cause instanceof Error ? cause.message : 'Inline scene failed.';
      }
      if (inlineSceneError) {
        queueStageRetry(inlineSceneRetry, attemptKey, () => lastInlineSceneAttemptKey === attemptKey, () => {
          lastInlineSceneAttemptKey = '';
          inlineSceneError = '';
        });
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (inlineSceneController === activeController) {
        inlineSceneBusy = false;
        inlineSceneController = null;
      }
    }
  }

  function persistInlineScenesEnabled() {
    if (!inlineScenePersistenceReady || !inlineScenePersistenceAvailable) inlineScenesEnabled = false;
    localStorage.setItem(inlineScenesEnabledStorageKey, String(inlineScenesEnabled));
    inlineSceneError = '';
    lastInlineSceneAttemptKey = '';
    inlineSceneVideoError = '';
    lastInlineSceneVideoAttemptKey = '';
    if (inlineScenesEnabled) restoreScenarioOpeningInlineSceneSourceIfNeeded();
    const videoAction = inlineSceneVideoMasterToggleAction(
      inlineScenesEnabled,
      inlineSceneMotionEnabled,
      inlineSceneVideoPersistenceAvailable
    );
    if (videoAction === 'abort') {
      inlineSceneGeneration += 1;
      inlineSceneController?.abort();
      inlineSceneController = null;
      inlineSceneBusy = false;
      inlineSceneVideoGeneration += 1;
      inlineSceneVideoController?.abort();
      inlineSceneVideoController = null;
      inlineSceneVideoBusy = false;
    } else if (videoAction === 'restore') {
      void runInlineSceneVideoRestoration(restoreGeneratedInlineSceneVideo);
    }
  }

  function publishFinalizedInlineSceneSource(source: InlineSceneSource) {
    const normalizedSource = normalizeInlineSceneSource(source);
    const epoch = crypto.randomUUID();
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    inlineSceneError = '';
    lastInlineSceneAttemptKey = '';
    invalidateInlineSceneVideoForNewStaticScene();
    finalizedInlineSceneSource = normalizedSource;
    inlineSceneEpoch = epoch;
    localStorage.setItem(inlineSceneFinalizedStorageKey, JSON.stringify({ epoch, source: normalizedSource }));
  }

  function scenarioOpeningIdentity(): InlineSceneScenarioOpeningIdentity | null {
    if (
      !scenarioCatalogSettled
      || !scenarioCatalog
      || !activeCard
      || !isScenarioCard(activeCard)
      || !activeScenarioStarterId
    ) return null;
    const metadata = activeCard.data.extensions.mullet;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const scenarioId = (metadata as Record<string, unknown>).scenario_id;
    const scenarioVersion = (metadata as Record<string, unknown>).scenario_version;
    if (typeof scenarioId !== 'string' || typeof scenarioVersion !== 'string') return null;
    const catalogScenario = scenarioCatalog.scenarios.find((scenario) => scenario.id === scenarioId);
    const cardStarters = scenarioStarters(activeCard);
    if (
      !catalogScenario
      || catalogScenario.version !== scenarioVersion
      || !catalogScenario.starters.some((starter) => starter.id === activeScenarioStarterId)
      || !cardStarters?.starters.some((starter) => starter.id === activeScenarioStarterId)
    ) return null;
    const expectedGreeting = scenarioStarterMessage(activeCard, activeScenarioStarterId);
    if (!expectedGreeting.trim()) return null;
    return {
      scenarioId,
      scenarioVersion,
      starterId: activeScenarioStarterId,
      expectedGreeting
    };
  }

  function inlineSceneSourceMatchesActiveScenario(source: InlineSceneSource): boolean {
    if (source.sourceKind === 'completed_turn') return true;
    const identity = scenarioOpeningIdentity();
    return Boolean(
      identity
      && activeCard
      && containsOnlyOpeningGreeting(activeCard)
      && source.scenarioId === identity.scenarioId
      && source.scenarioVersion === identity.scenarioVersion
      && source.starterId === identity.starterId
    );
  }

  function publishScenarioOpeningInlineSceneSource(): boolean {
    const identity = scenarioOpeningIdentity();
    if (!identity || !activeCard || !containsOnlyOpeningGreeting(activeCard)) return false;
    publishFinalizedInlineSceneSource(
      inlineSceneSourceForScenarioOpening(conversationId, messages, identity)
    );
    return true;
  }

  function restoreScenarioOpeningInlineSceneSourceIfNeeded() {
    if (
      !inlineScenesEnabled
      || finalizedInlineSceneSource
      || false
    ) return;
    try {
      publishScenarioOpeningInlineSceneSource();
    } catch (cause) {
      inlineSceneError = cause instanceof Error ? cause.message : 'Scenario-opening scene source could not be restored.';
    }
  }

  async function resetInlineSceneForConversation() {
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    inlineSceneError = '';
    lastInlineSceneAttemptKey = '';
    finalizedInlineSceneSource = null;
    inlineSceneEpoch = '';
    localStorage.removeItem(inlineSceneFinalizedStorageKey);
    inlineSceneVideoGeneration += 1;
    inlineSceneVideoController?.abort();
    inlineSceneVideoController = null;
    inlineSceneVideoBusy = false;
    inlineSceneVideoError = '';
    lastInlineSceneVideoAttemptKey = '';
    forgetInlineSceneClips();
    removeInstalledInlineScene();
    if (inlineSceneVideoPersistenceAvailable) {
      beginInlineSceneVideoPersistenceOperation();
      try {
        await runStoredInlineSceneVideoExclusive(clearStoredInlineSceneVideo);
      } catch (cause) {
        disableInlineSceneVideoPersistence(cause);
      } finally {
        endInlineSceneVideoPersistenceOperation();
      }
    }
    if (!inlineScenePersistenceAvailable) return;
    beginInlineScenePersistenceOperation();
    try {
      await runStoredInlineSceneExclusive(clearStoredInlineScene);
    } catch (cause) {
      disableInlineScenePersistence(cause);
    } finally {
      endInlineScenePersistenceOperation();
    }
  }

  async function loadPortraitGenerator() {
    if (portraitCapabilitiesLoading) return;
    portraitCapabilitiesLoading = true;
    portraitError = '';
    try {
      const response = await fetch(`${base}/api/portrait`, { cache: 'no-store' });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
        payload = null;
      }
      if (!response.ok) {
        const detail = payload
          && typeof payload === 'object'
          && 'message' in payload
          && typeof payload.message === 'string'
          ? payload.message
          : `Portrait generator failed (${response.status}).`;
        throw new Error(detail);
      }
      portraitCapabilities = normalizePortraitCapabilities(payload);
      if (!portraitCapabilities.templates.some(({ template }) => template.id === portraitModelTemplate)) {
        localStorage.removeItem(portraitModelTemplateStorageKey);
        portraitModelSelectionPersisted = false;
        portraitModelTemplate = declaredPortraitModelTemplate();
      }
      if (portraitLora && !portraitCapabilities.loras.includes(portraitLora)) {
        portraitLora = '';
        localStorage.removeItem(portraitLoraStorageKey);
      }
    } catch (cause) {
      portraitCapabilities = null;
      portraitError = cause instanceof Error ? cause.message : 'Portrait generator is unavailable.';
      scheduleCapabilityRetry('portrait', loadPortraitGenerator);
    } finally {
      portraitCapabilitiesLoading = false;
    }
  }

  function installGeneratedPortrait(portrait: StoredPortrait, preserveStoredMotion = false): Promise<void> {
    const generation = beginPortraitVideoSourceChange(preserveStoredMotion);
    if (generatedPortraitUrl) URL.revokeObjectURL(generatedPortraitUrl);
    generatedPortrait = portrait;
    generatedPortraitUrl = URL.createObjectURL(portrait.image);
    void captureSubjectDescriptor(portrait);
    return refreshPortraitImageDigest(portrait, generation);
  }

  // Step 3 of the continuity chain: read the concrete visible facts off the still that
  // was actually produced, so the widescreen scene is given those exact details rather
  // than a restatement of what the portrait was asked for. Best effort: a caption failure
  // must never block the portrait the operator is looking at.
  async function captureSubjectDescriptor(portrait: StoredPortrait): Promise<void> {
    const characterId = portrait.source.characterId ?? '';
    const displayName = portraitDisplayProfile?.displayName ?? '';
    const expression = portrait.source.expression;
    if (!characterId || !displayName || !expression) return;
    subjectCaptionInFlight = { ...subjectCaptionInFlight, [characterId]: portrait.requestKey };
    try {
      // A byte-identical still already captioned (this session or before a reload) needs
      // no second vision call.
      const sha = await blobSha256(portrait.image);
      const known = subjectDescriptors[characterId];
      if (known && known.portraitSha256 === sha) {
        subjectDescriptorPortraitKeys = { ...subjectDescriptorPortraitKeys, [characterId]: portrait.requestKey };
        subjectCaptionError = '';
        persistSubjectDescriptors();
        return;
      }
      const form = new FormData();
      form.append('image', portrait.image, 'portrait.png');
      form.append('characterId', characterId);
      form.append('displayName', displayName);
      form.append('expression', expression);
      const response = await fetch(`${base}/api/sidecar/caption`, { method: 'POST', body: form });
      if (!response.ok) {
        subjectCaptionError = `Continuity caption failed (${response.status}); this scene runs without it.`;
        console.warn('subject caption failed', response.status);
        return;
      }
      const payload = await response.json();
      const descriptor = createSubjectDescriptor(
        characterId,
        displayName,
        payload.portraitSha256,
        expression,
        payload.caption
      );
      subjectDescriptors = { ...subjectDescriptors, [characterId]: descriptor };
      subjectDescriptorPortraitKeys = {
        ...subjectDescriptorPortraitKeys,
        [characterId]: portrait.requestKey
      };
      subjectCaptionError = '';
      persistSubjectDescriptors();
    } catch {
      subjectCaptionError = 'Continuity caption failed; this scene runs without it.';
    } finally {
      // Settled on every outcome, so the scene's bounded wait ends here and never latches.
      subjectCaptionSettledKeys = { ...subjectCaptionSettledKeys, [characterId]: portrait.requestKey };
      const { [characterId]: _released, ...rest } = subjectCaptionInFlight;
      subjectCaptionInFlight = rest;
    }
  }

  function persistSubjectDescriptors() {
    if (!browser) return;
    try {
      localStorage.setItem(subjectDescriptorStorageKey, JSON.stringify({
        descriptors: subjectDescriptors,
        portraitKeys: subjectDescriptorPortraitKeys
      }));
    } catch {
      // Quota or privacy mode: continuity simply re-captions next time.
    }
  }

  function restoreSubjectDescriptors() {
    if (!browser) return;
    try {
      const raw = localStorage.getItem(subjectDescriptorStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { descriptors?: Record<string, unknown>; portraitKeys?: Record<string, unknown> };
      const descriptors: Record<string, SubjectDescriptor> = {};
      const keys: Record<string, string> = {};
      for (const [id, value] of Object.entries(parsed?.descriptors ?? {})) {
        try {
          descriptors[id] = normalizeSubjectDescriptor(value);
          const key = parsed?.portraitKeys?.[id];
          if (typeof key === 'string') keys[id] = key;
        } catch {
          // one bad entry does not poison the rest
        }
      }
      subjectDescriptors = descriptors;
      subjectDescriptorPortraitKeys = keys;
      subjectCaptionSettledKeys = { ...keys };
    } catch {
      // unreadable: start clean
    }
  }

  function clearSubjectDescriptors() {
    subjectDescriptors = {};
    subjectDescriptorPortraitKeys = {};
    subjectCaptionSettledKeys = {};
    subjectCaptionInFlight = {};
    continuityWaitStartedAt = {};
    subjectCaptionError = '';
    if (browser) localStorage.removeItem(subjectDescriptorStorageKey);
  }

  async function restoreGeneratedPortrait() {
    const restoringConversationId = conversationId;
    try {
      await restoreStoredPortrait({
        exclusive: runStoredPortraitExclusive,
        load: loadStoredPortrait,
        isCurrent: () => restoringConversationId === conversationId,
        accepts: (portrait) => portrait.conversationId === restoringConversationId,
        install: (portrait) => installGeneratedPortrait(portrait, true)
      });
    } catch (cause) {
      portraitPersistenceAvailable = false;
      portraitError = cause instanceof Error ? cause.message : 'Portrait persistence failed.';
    } finally {
      portraitPersistenceReady = true;
    }
  }

  async function restoreExpressionAndGeneratedMedia() {
    await Promise.all([restoreSidecarState(), restoreGeneratedPortrait()]);
    await tick();
    await restoreGeneratedPortraitVideo();
  }

  async function blobSha256(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function clearPortraitVideoPlaybackTimer() {
    if (portraitVideoPlaybackTimer === null) return;
    window.clearTimeout(portraitVideoPlaybackTimer);
    portraitVideoPlaybackTimer = null;
  }

  function resetPortraitVideoPlayback(nextState: PlaybackState = 'idle') {
    clearPortraitVideoPlaybackTimer();
    portraitVideoPlaybackToken += 1;
    portraitVideoPlaybackAttemptedToken = -1;
    portraitVideoPlaybackStartSeconds = 0;
    portraitVideoPlaybackState = nextState;
    portraitVideoPlaybackError = '';
  }

  function portraitVideoPlaybackContextIsCurrent(
    element: HTMLVideoElement,
    sourceUrl: string,
    token: number
  ): boolean {
    return Boolean(
      element === portraitVideoElement
      && sourceUrl === generatedPortraitVideoUrl
      && token === portraitVideoPlaybackToken
      && portraitVideoMounted
      && portraitVideoCurrent
    );
  }

  function showPortraitVideoStaticFallback(
    element: HTMLVideoElement,
    sourceUrl: string,
    token: number
  ) {
    if (!portraitVideoPlaybackContextIsCurrent(element, sourceUrl, token)) return;
    clearPortraitVideoPlaybackTimer();
    element.pause();
    portraitVideoPlaybackState = 'fallback';
    portraitVideoPlaybackError = 'Portrait motion did not begin playing; showing the static portrait.';
  }

  function attemptPortraitVideoPlayback(element: HTMLVideoElement) {
    if (element !== portraitVideoElement || !portraitVideoMounted) return;
    const sourceUrl = generatedPortraitVideoUrl;
    const token = portraitVideoPlaybackToken;
    const elementSourceUrl = element.currentSrc || element.src;
    if (
      !sourceUrl
      || elementSourceUrl !== sourceUrl
      || portraitVideoPlaybackAttemptedToken === token
    ) return;
    portraitVideoPlaybackAttemptedToken = token;
    portraitVideoPlaybackState = 'starting';
    portraitVideoPlaybackError = '';
    element.muted = true;
    element.defaultMuted = true;
    element.loop = true;
    element.playsInline = true;
    try {
      element.currentTime = 0;
    } catch {
      // A not-yet-seekable element can still begin from its current media time.
    }
    portraitVideoPlaybackStartSeconds = element.currentTime;
    clearPortraitVideoPlaybackTimer();
    portraitVideoPlaybackTimer = window.setTimeout(
      () => showPortraitVideoStaticFallback(element, sourceUrl, token),
      MEDIA_PLAYBACK_START_TIMEOUT_MS
    );
    void element.play().catch(() => showPortraitVideoStaticFallback(element, sourceUrl, token));
  }

  function handlePortraitVideoCanPlay(event: Event) {
    attemptPortraitVideoPlayback(event.currentTarget as HTMLVideoElement);
  }

  function handlePortraitVideoTimeUpdate(event: Event) {
    const element = event.currentTarget as HTMLVideoElement;
    const sourceUrl = generatedPortraitVideoUrl;
    const token = portraitVideoPlaybackToken;
    if (
      portraitVideoPlaybackState !== 'starting'
      || !portraitVideoPlaybackContextIsCurrent(element, sourceUrl, token)
      || !generatedPortraitVideo
      || !mediaPlaybackTimeAdvanced(
        portraitVideoPlaybackStartSeconds,
        element.currentTime,
        generatedPortraitVideo.fps,
        generatedPortraitVideo.encodedDurationSeconds
      )
    ) return;
    clearPortraitVideoPlaybackTimer();
    portraitVideoPlaybackState = 'playing';
    portraitVideoPlaybackError = '';
  }

  function handlePortraitVideoPlaybackError(event: Event) {
    const element = event.currentTarget as HTMLVideoElement;
    showPortraitVideoStaticFallback(
      element,
      element.currentSrc || element.src,
      portraitVideoPlaybackToken
    );
  }

  function retryPortraitVideoPlayback() {
    const element = portraitVideoElement;
    if (!element || !portraitVideoMounted) return;
    resetPortraitVideoPlayback('starting');
    attemptPortraitVideoPlayback(element);
  }

  function removeInstalledPortraitVideo() {
    portraitVideoElement?.pause();
    resetPortraitVideoPlayback();
    if (generatedPortraitVideoUrl) URL.revokeObjectURL(generatedPortraitVideoUrl);
    generatedPortraitVideoUrl = '';
    generatedPortraitVideo = null;
  }

  function installGeneratedPortraitVideo(video: StoredPortraitVideo) {
    removeInstalledPortraitVideo();
    generatedPortraitVideo = video;
    generatedPortraitVideoUrl = URL.createObjectURL(video.video);
    resetPortraitVideoPlayback('starting');
  }

  function disablePortraitVideoPersistence(cause: unknown) {
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    removeInstalledPortraitVideo();
    portraitVideoPersistenceOperations = 0;
    portraitVideoPersistenceAvailable = false;
    portraitVideoPersistenceReady = true;
    portraitMotionEnabled = false;
    if (browser) localStorage.setItem(portraitMotionEnabledStorageKey, 'false');
    portraitVideoError = cause instanceof Error ? cause.message : 'Portrait-motion persistence failed.';
  }

  function beginPortraitVideoPersistenceOperation() {
    portraitVideoPersistenceOperations += 1;
    portraitVideoPersistenceReady = false;
  }

  function endPortraitVideoPersistenceOperation() {
    portraitVideoPersistenceOperations = Math.max(0, portraitVideoPersistenceOperations - 1);
    portraitVideoPersistenceReady = portraitVideoPersistenceOperations === 0;
  }

  function clearStoredPortraitVideoLocked(generation: number) {
    beginPortraitVideoPersistenceOperation();
    void runStoredPortraitVideoExclusive(clearStoredPortraitVideo)
      .catch(disablePortraitVideoPersistence)
      .finally(endPortraitVideoPersistenceOperation);
  }

  function beginPortraitVideoSourceChange(preserveStoredMotion: boolean): number {
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoController = null;
    portraitVideoBusy = false;
    portraitVideoError = '';
    lastPortraitVideoAttemptKey = '';
    portraitImageDigestPromptId = '';
    portraitImageSha256 = '';
    removeInstalledPortraitVideo();
    if (!preserveStoredMotion) {
      portraitVideoRestoreNeeded = false;
      if (portraitVideoPersistenceAvailable) clearStoredPortraitVideoLocked(portraitVideoGeneration);
    }
    return portraitVideoGeneration;
  }

  function invalidatePortraitVideoForPortraitChange(clearStored: boolean) {
    beginPortraitVideoSourceChange(!clearStored);
  }

  async function refreshPortraitImageDigest(portrait: StoredPortrait, generation: number) {
    try {
      const digest = await blobSha256(portrait.image);
      if (
        generation === portraitVideoGeneration
        && portrait.conversationId === conversationId
        && generatedPortrait?.promptId === portrait.promptId
        && generatedPortrait.requestKey === portrait.requestKey
      ) {
        portraitImageDigestPromptId = portrait.promptId;
        portraitImageSha256 = digest;
      }
    } catch (cause) {
      if (generation === portraitVideoGeneration) {
        portraitVideoError = cause instanceof Error ? cause.message : 'Portrait image hashing failed.';
      }
    }
  }

  function currentPortraitVideoRequest(
    portrait: StoredPortrait | null,
    staticCurrent: boolean,
    digestPromptId: string,
    imageSha256: string,
    aspectRatio: PortraitAspectRatio,
    mode: PortraitVideoMode,
    durationSeconds: PortraitVideoDurationSeconds,
    modelTemplate: PortraitVideoTemplateId
  ): PortraitVideoRequest | null {
    if (!portrait || !staticCurrent || digestPromptId !== portrait.promptId || !imageSha256) return null;
    try {
      return buildPortraitVideoRequest(portrait, aspectRatio, imageSha256, mode, durationSeconds, modelTemplate);
    } catch {
      return null;
    }
  }

  function portraitVideoSourceIsCurrent(
    generation: number,
    portrait: StoredPortrait,
    request: PortraitVideoRequest,
    key: string,
    signal?: AbortSignal
  ): boolean {
    const liveRequest = currentPortraitVideoRequest(
      generatedPortrait,
      portraitCurrent,
      portraitImageDigestPromptId,
      portraitImageSha256,
      portraitAspectRatio,
      portraitVideoMode,
      portraitVideoDurationSeconds,
      portraitVideoModelTemplate
    );
    return !signal?.aborted
      && generation === portraitVideoGeneration
      && portrait.conversationId === conversationId
      && generatedPortrait?.promptId === portrait.promptId
      && generatedPortrait.requestKey === portrait.requestKey
      && portraitImageSha256 === request.source.portraitImageSha256
      && Boolean(liveRequest && portraitVideoRequestKey(liveRequest) === key);
  }

  async function restoreGeneratedPortraitVideo() {
    const generation = portraitVideoGeneration;
    beginPortraitVideoPersistenceOperation();
    const restoredRequest = currentPortraitVideoRequest(
      generatedPortrait,
      portraitCurrent,
      portraitImageDigestPromptId,
      portraitImageSha256,
      portraitAspectRatio,
      portraitVideoMode,
      portraitVideoDurationSeconds,
      portraitVideoModelTemplate
    );
    const restoredKey = restoredRequest ? portraitVideoRequestKey(restoredRequest) : '';
    if (!restoredRequest) {
      // Nothing to compare against yet; the reactive late restore retries once the
      // request exists. Do not let the reconciliation run in the meantime.
      endPortraitVideoPersistenceOperation();
      return;
    }
    portraitVideoRestoreNeeded = false;
    try {
      await restoreStoredPortraitVideo({
        exclusive: runStoredPortraitVideoExclusive,
        load: loadVerifiedStoredPortraitVideo,
        isCurrent: () => {
          const request = currentPortraitVideoRequest(
            generatedPortrait,
            portraitCurrent,
            portraitImageDigestPromptId,
            portraitImageSha256,
            portraitAspectRatio,
            portraitVideoMode,
            portraitVideoDurationSeconds,
            portraitVideoModelTemplate
          );
          return generation === portraitVideoGeneration
            && Boolean(restoredRequest && request && portraitVideoRequestKey(request) === restoredKey);
        },
        accepts: (video) => video.requestKey === restoredKey,
        install: installGeneratedPortraitVideo
      });
    } catch (cause) {
      disablePortraitVideoPersistence(cause);
    } finally {
      endPortraitVideoPersistenceOperation();
    }
  }

  async function loadVerifiedStoredPortraitVideo(): Promise<StoredPortraitVideo | null> {
    const stored = await loadStoredPortraitVideo();
    if (stored === null) return null;
    try {
      const video = normalizeStoredPortraitVideo(stored);
      await verifyPortraitVideoBytes(video);
      return video;
    } catch {
      await clearStoredPortraitVideo();
      portraitVideoError = 'Stored portrait motion was invalid and was discarded.';
      return null;
    }
  }

  async function verifyPortraitVideoBytes(video: StoredPortraitVideo): Promise<void> {
    const bytes = new Uint8Array(await video.video.arrayBuffer());
    if (await blobSha256(video.video) !== video.videoSha256) {
      throw new Error('stored portrait motion bytes are invalid');
    }
    if (
      bytes.length < 12
      || bytes[4] !== 0x66
      || bytes[5] !== 0x74
      || bytes[6] !== 0x79
      || bytes[7] !== 0x70
    ) throw new Error('stored portrait motion bytes are invalid');
    const metadata = validateH264VideoOnlyMp4(bytes, {
      width: video.width,
      height: video.height,
      frames: video.frames,
      fps: video.fps
    });
    if (metadata.durationSeconds !== video.encodedDurationSeconds) {
      throw new Error('stored portrait motion duration is invalid');
    }
  }

  async function loadPortraitVideoGenerator() {
    if (portraitVideoCapabilitiesLoading) return;
    portraitVideoCapabilitiesLoading = true;
    portraitVideoError = '';
    try {
      const response = await fetch(`${base}/api/portrait/video`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : `Portrait-motion generator failed (${response.status}).`;
        throw new Error(detail);
      }
      portraitVideoCapabilities = normalizePortraitVideoCapabilities(payload);
      if (!portraitVideoCapabilities.templates.some(({ template }) => template.id === portraitVideoModelTemplate)) {
        portraitVideoModelTemplate = PORTRAIT_VIDEO_TEMPLATE_ID;
        localStorage.setItem(portraitVideoModelTemplateStorageKey, portraitVideoModelTemplate);
      }
      const selectedTemplate = portraitVideoTemplateCapability(portraitVideoCapabilities, portraitVideoModelTemplate);
      if (!selectedTemplate?.modes.some(({ id }) => id === portraitVideoMode)) {
        portraitVideoMode = PORTRAIT_VIDEO_MODE_LOOP_FLF;
        localStorage.setItem(portraitVideoModeStorageKey, portraitVideoMode);
      }
      if (!selectedTemplate?.durations.includes(portraitVideoDurationSeconds)) {
        portraitVideoDurationSeconds = selectedTemplate?.durations[0] ?? PORTRAIT_VIDEO_DURATION_SECONDS;
        localStorage.setItem(portraitVideoDurationStorageKey, String(portraitVideoDurationSeconds));
      }
    } catch (cause) {
      portraitVideoCapabilities = null;
      portraitVideoError = cause instanceof Error ? cause.message : 'Portrait-motion generator is unavailable.';
      scheduleCapabilityRetry('portrait-video', loadPortraitVideoGenerator);
    } finally {
      portraitVideoCapabilitiesLoading = false;
    }
  }

  function schedulePortraitVideoReconciliation(
    expressionsOn: boolean,
    enabled: boolean,
    capabilities: PortraitVideoCapabilities | null,
    persistenceReady: boolean,
    persistenceAvailable: boolean,
    staticBusy: boolean,
    busy: boolean,
    request: PortraitVideoRequest | null,
    current: boolean,
    restoreNeeded: boolean,
    _retrySignal: unknown = null
  ) {
    if (
      !expressionsOn
      || !enabled
      || !capabilities
      || !portraitVideoModeAvailable(
        capabilities,
        request?.mode ?? portraitVideoMode,
        request?.modelTemplate ?? portraitVideoModelTemplate
      )
      || !persistenceReady
      || !persistenceAvailable
      || staticBusy
      || busy
      || !request
      || current
      // Never generate before the stored loop has had a real chance to be restored.
      || restoreNeeded
    ) return;
    const key = portraitVideoRequestKey(request);
    if (key === lastPortraitVideoAttemptKey) return;
    lastPortraitVideoAttemptKey = key;
    void generatePortraitVideo(request);
  }

  function queuePortraitVideoAutomaticRetry(key: string) {
    queueStageRetry(portraitVideoRetry, key, () => lastPortraitVideoAttemptKey === key, () => {
      lastPortraitVideoAttemptKey = '';
      portraitVideoError = '';
    });
  }

  function clearPortraitVideoAutomaticRetry(key: string) {
    clearStageRetry(portraitVideoRetry, key);
  }

  function responseHeaderSha256(response: Response, name: string): string {
    const value = response.headers.get(name) ?? '';
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Portrait-motion response omitted ${name}.`);
    return value;
  }

  async function generatePortraitVideo(selectedRequest: PortraitVideoRequest | null = portraitVideoRequest) {
    const selectedPortrait = generatedPortrait;
    if (
      !selectedRequest
      || !selectedPortrait
      || !portraitVideoCapabilities
      || !portraitVideoModeAvailable(
        portraitVideoCapabilities,
        selectedRequest.mode,
        selectedRequest.modelTemplate
      )
      || portraitVideoBusy
      || portraitBusy
      || !portraitVideoPersistenceReady
      || !portraitVideoPersistenceAvailable
    ) return;
    const key = portraitVideoRequestKey(selectedRequest);
    const generation = portraitVideoGeneration;
    if (!portraitVideoSourceIsCurrent(generation, selectedPortrait, selectedRequest, key)) return;
    lastPortraitVideoAttemptKey = key;
    portraitVideoBusy = true;
    portraitVideoError = '';
    const activeController = new AbortController();
    portraitVideoController = activeController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, PORTRAIT_VIDEO_TIMEOUT_MS + 5_000);
    try {
      const form = new FormData();
      form.append('request', JSON.stringify(selectedRequest));
      form.append('image', selectedPortrait.image, 'portrait.png');
      const response = await fetch(`${base}/api/portrait/video`, {
        method: 'POST',
        body: form,
        signal: activeController.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : `Portrait motion failed (${response.status}).`;
        throw new Error(detail);
      }
      const video = await response.blob();
      if (video.type !== 'video/mp4' || video.size < 12) {
        throw new Error('Portrait-motion generator returned an invalid video.');
      }
      const videoBytes = new Uint8Array(await video.arrayBuffer());
      if (
        videoBytes[4] !== 0x66
        || videoBytes[5] !== 0x74
        || videoBytes[6] !== 0x79
        || videoBytes[7] !== 0x70
      ) throw new Error('Portrait-motion generator returned an invalid MP4 signature.');
      const modelTemplate = response.headers.get('x-mullet-model-template') ?? '';
      const mode = response.headers.get('x-mullet-video-mode') ?? '';
      const inputImageSha256 = responseHeaderSha256(response, 'x-mullet-input-sha256');
      if (
        modelTemplate !== selectedRequest.modelTemplate
        || mode !== selectedRequest.mode
        || inputImageSha256 !== selectedRequest.source.portraitImageSha256
      ) {
        throw new Error('Portrait-motion response provenance does not match its request.');
      }
      const videoSha256 = responseHeaderSha256(response, 'x-mullet-video-sha256');
      if (await blobSha256(video) !== videoSha256) throw new Error('Portrait-motion response hash does not match its video.');
      const endFrameHeaderNames = [
        'x-mullet-end-frame-model-template',
        'x-mullet-end-frame-prompt-id',
        'x-mullet-end-frame-seed',
        'x-mullet-end-frame-width',
        'x-mullet-end-frame-height',
        'x-mullet-end-frame-sha256'
      ];
      const endFrame = selectedRequest.mode === PORTRAIT_VIDEO_MODE_GENERATED_FLF
        ? {
            modelTemplate: response.headers.get('x-mullet-end-frame-model-template') ?? '',
            promptId: response.headers.get('x-mullet-end-frame-prompt-id') ?? '',
            seed: responseHeaderInteger(response, 'x-mullet-end-frame-seed', 0, Number.MAX_SAFE_INTEGER),
            width: responseHeaderInteger(response, 'x-mullet-end-frame-width', 16, 8192),
            height: responseHeaderInteger(response, 'x-mullet-end-frame-height', 16, 8192),
            imageSha256: responseHeaderSha256(response, 'x-mullet-end-frame-sha256')
          }
        : null;
      if (endFrame) {
        if (
          endFrame.modelTemplate !== selectedRequest.endFrameModelTemplate
          || endFrame.width !== selectedRequest.source.portraitWidth
          || endFrame.height !== selectedRequest.source.portraitHeight
          || endFrame.imageSha256 === inputImageSha256
        ) throw new Error('Portrait-motion end-frame provenance does not match its request.');
      } else if (endFrameHeaderNames.some((name) => response.headers.has(name))) {
        throw new Error('Portrait-motion response included an end frame for the wrong mode.');
      }
      const stored = normalizeStoredPortraitVideo({
        spec: STORED_PORTRAIT_VIDEO_SPEC,
        conversationId: selectedRequest.source.conversationId,
        requestKey: key,
        request: selectedRequest,
        modelTemplate,
        mode,
        promptId: response.headers.get('x-mullet-prompt-id') ?? '',
        seed: responseHeaderInteger(response, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
        width: responseHeaderInteger(response, 'x-mullet-width', 16, 8192),
        height: responseHeaderInteger(response, 'x-mullet-height', 16, 8192),
        frames: responseHeaderInteger(response, 'x-mullet-frames', 1, 10_000),
        fps: responseHeaderInteger(response, 'x-mullet-fps', 1, 1_000),
        durationSeconds: responseHeaderInteger(response, 'x-mullet-duration-seconds', 1, 3_600),
        encodedDurationSeconds: responseHeaderNumber(response, 'x-mullet-encoded-duration-seconds', 1, 3_600),
        audioTracks: responseHeaderInteger(response, 'x-mullet-audio-tracks', 0, 0),
        generatedAt: Date.now(),
        inputImageSha256,
        endFrame,
        videoSha256,
        video
      });
      await verifyPortraitVideoBytes(stored);
      const committed = await commitStoredPortraitVideo(stored, {
        exclusive: runStoredPortraitVideoExclusive,
        save: saveStoredPortraitVideo,
        rollback: rollbackStoredPortraitVideoWrite,
        isCurrent: () => portraitVideoSourceIsCurrent(generation, selectedPortrait, selectedRequest, key, activeController.signal),
        install: installGeneratedPortraitVideo
      });
      if (committed) clearPortraitVideoAutomaticRetry(key);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) {
          portraitVideoError = `Portrait motion timed out after ${(PORTRAIT_VIDEO_TIMEOUT_MS + 5_000) / 1000} seconds.`;
          queuePortraitVideoAutomaticRetry(key);
        }
      } else {
        portraitVideoError = cause instanceof Error ? cause.message : 'Portrait motion failed.';
        queuePortraitVideoAutomaticRetry(key);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (portraitVideoController === activeController) {
        portraitVideoBusy = false;
        portraitVideoController = null;
      }
    }
  }

  function persistPortraitMotionEnabled() {
    if (!portraitVideoPersistenceReady || !portraitVideoPersistenceAvailable) portraitMotionEnabled = false;
    localStorage.setItem(portraitMotionEnabledStorageKey, String(portraitMotionEnabled));
    portraitVideoError = '';
    lastPortraitVideoAttemptKey = '';
    if (!portraitMotionEnabled) {
      portraitVideoGeneration += 1;
      portraitVideoController?.abort();
      portraitVideoBusy = false;
      portraitVideoElement?.pause();
      resetPortraitVideoPlayback();
    } else {
      resetPortraitVideoPlayback('starting');
    }
  }

  function persistPortraitVideoMode() {
    if (!PORTRAIT_VIDEO_MODES.some(({ id }) => id === portraitVideoMode)) {
      portraitVideoMode = PORTRAIT_VIDEO_MODE_LOOP_FLF;
    }
    localStorage.setItem(portraitVideoModeStorageKey, portraitVideoMode);
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoController = null;
    portraitVideoBusy = false;
    portraitVideoError = '';
    lastPortraitVideoAttemptKey = '';
    removeInstalledPortraitVideo();
    if (portraitVideoPersistenceAvailable) clearStoredPortraitVideoLocked(portraitVideoGeneration);
  }

  function persistPortraitVideoModelTemplate() {
    const selectedTemplate = portraitVideoTemplateCapability(portraitVideoCapabilities, portraitVideoModelTemplate);
    if (!selectedTemplate) {
      portraitVideoModelTemplate = PORTRAIT_VIDEO_TEMPLATE_ID;
    }
    const resolvedTemplate = portraitVideoTemplateCapability(portraitVideoCapabilities, portraitVideoModelTemplate);
    if (!resolvedTemplate?.durations.includes(portraitVideoDurationSeconds)) {
      portraitVideoDurationSeconds = resolvedTemplate?.durations[0] ?? PORTRAIT_VIDEO_DURATION_SECONDS;
    }
    localStorage.setItem(portraitVideoModelTemplateStorageKey, portraitVideoModelTemplate);
    localStorage.setItem(portraitVideoDurationStorageKey, String(portraitVideoDurationSeconds));
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoController = null;
    portraitVideoBusy = false;
    portraitVideoError = '';
    lastPortraitVideoAttemptKey = '';
    removeInstalledPortraitVideo();
    if (portraitVideoPersistenceAvailable) clearStoredPortraitVideoLocked(portraitVideoGeneration);
  }

  function persistPortraitVideoDuration() {
    const selectedTemplate = portraitVideoTemplateCapability(portraitVideoCapabilities, portraitVideoModelTemplate);
    if (!selectedTemplate?.durations.includes(portraitVideoDurationSeconds)) {
      portraitVideoDurationSeconds = selectedTemplate?.durations[0] ?? PORTRAIT_VIDEO_DURATION_SECONDS;
    }
    localStorage.setItem(portraitVideoDurationStorageKey, String(portraitVideoDurationSeconds));
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoController = null;
    portraitVideoBusy = false;
    portraitVideoError = '';
    lastPortraitVideoAttemptKey = '';
    removeInstalledPortraitVideo();
    if (portraitVideoPersistenceAvailable) clearStoredPortraitVideoLocked(portraitVideoGeneration);
  }

  function currentPortraitRequest(
    result: ExpressionSidecarResult | null,
    current: boolean,
    card: ImportedCharacterCard | null,
    profile: ScenarioPortraitProfile | null,
    bodyReferencesReady: boolean,
    modelTemplate: PortraitModelTemplate,
    modelAvailable: boolean,
    modelUsesReference: boolean,
    subject: string,
    setting: string,
    attire: string,
    lora: string,
    aspectRatio: PortraitAspectRatio,
    megapixels: PortraitMegapixels
  ): PortraitRequest | null {
    if (!result || !current || !modelAvailable || (isScenarioCard(card) && !bodyReferencesReady)) return null;
    try {
      if (isScenarioCard(card)) {
        if (!profile) return null;
        return buildPortraitRequest(result, {
          modelTemplate,
          subject: !modelUsesReference && profile.subjectLora
            ? `${profile.subjectLora.trigger}, ${profile.subject}`
            : profile.subject,
          setting: profile.setting,
          attire: profile.attire,
          lora: modelUsesReference ? null : profile.subjectLora?.name ?? null,
          referenceImage: modelUsesReference ? profile.referenceImage : null,
          bodyReferenceImage: null,
          characterId: profile.id,
          profileFingerprint: profile.fingerprint,
          promptOverride: modelUsesReference
            ? profile.expressionPrompts[result.output.expression] ?? null
            : null,
          aspectRatio,
          megapixels,
          seed: profile.seed
        });
      }
      if (modelUsesReference) return null;
      return buildPortraitRequest(result, {
        modelTemplate,
        subject,
        setting,
        attire,
        lora: lora || null,
        aspectRatio,
        megapixels
      });
    } catch {
      return null;
    }
  }

  function schedulePortraitReconciliation(
    enabled: boolean,
    capabilities: PortraitCapabilities | null,
    persistenceReady: boolean,
    persistenceAvailable: boolean,
    busy: boolean,
    request: PortraitRequest | null,
    current: boolean,
    _retrySignal: unknown = null
  ) {
    if (!enabled || !capabilities || !persistenceReady || !persistenceAvailable || busy || !request || current) return;
    const key = portraitRequestKey(request);
    if (key === lastPortraitAttemptKey) return;
    lastPortraitAttemptKey = key;
    void generatePortrait(request);
  }

  function queuePortraitAutomaticRetry(key: string) {
    queueStageRetry(portraitRetry, key, () => lastPortraitAttemptKey === key, () => {
      lastPortraitAttemptKey = '';
      portraitError = '';
    });
  }

  function clearPortraitAutomaticRetry(key: string) {
    clearStageRetry(portraitRetry, key);
  }

  function responseHeaderInteger(response: Response, name: string, minimum: number, maximum: number): number {
    const value = Number(response.headers.get(name));
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Portrait response omitted ${name}.`);
    return value;
  }

  function responseHeaderNumber(response: Response, name: string, minimum: number, maximum: number): number {
    const raw = response.headers.get(name);
    if (raw === null || !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) throw new Error(`Portrait response omitted ${name}.`);
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum || String(value) !== raw) {
      throw new Error(`Portrait response omitted ${name}.`);
    }
    return value;
  }

  async function generatePortrait(selectedRequest: PortraitRequest | null = portraitRequest) {
    if (!selectedRequest || !portraitCapabilities || portraitBusy || !portraitPersistenceReady || !portraitPersistenceAvailable) return;
    if (
      isScenarioCard(activeCard)
      && (!bodyReferenceOverlayReady
        || bodyReferenceOverlayCorruptProfileIds.length > 0
        || Boolean(bodyReferenceOverlayBusyProfileId))
    ) return;
    if (!portraitModelTemplateAvailable(portraitCapabilities, selectedRequest.modelTemplate)) return;
    suspendPortraitVideoForStaticGeneration();
    const key = portraitRequestKey(selectedRequest);
    lastPortraitAttemptKey = key;
    portraitBusy = true;
    portraitError = '';
    const activeController = new AbortController();
    portraitController = activeController;
    let timedOut = false;
    const timeoutMs = false
      ? PORTRAIT_H3_TIMEOUT_MS
      : PORTRAIT_TIMEOUT_MS;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, timeoutMs + 5_000);
    try {
      const h3ReferenceForm = false
        ? new FormData()
        : null;
      if (h3ReferenceForm) {
        h3ReferenceForm.append('request', JSON.stringify(selectedRequest));
        appendManagedBodyReferenceParts(
          h3ReferenceForm,
          portraitManagedBodyReferenceHashes(selectedRequest)
        );
      }
      const response = await fetch(`${base}/api/portrait`, {
        method: 'POST',
        ...(h3ReferenceForm ? {} : { headers: { 'content-type': 'application/json' } }),
        body: h3ReferenceForm ?? JSON.stringify(selectedRequest),
        signal: activeController.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload && typeof payload.message === 'string' ? payload.message : `Portrait generation failed (${response.status}).`;
        throw new Error(detail);
      }
      const image = await response.blob();
      if (image.type !== 'image/png' || image.size < 8) throw new Error('Portrait generator returned an invalid image.');
      const promptId = response.headers.get('x-mullet-prompt-id') ?? '';
      const stored = normalizeStoredPortrait({
        spec: STORED_PORTRAIT_SPEC,
        conversationId: selectedRequest.source.conversationId,
        requestKey: key,
        source: selectedRequest.source,
        modelTemplate: selectedRequest.modelTemplate,
        promptId,
        seed: responseHeaderInteger(response, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
        width: responseHeaderInteger(response, 'x-mullet-width', 16, 8192),
        height: responseHeaderInteger(response, 'x-mullet-height', 16, 8192),
        generatedAt: Date.now(),
        image
      });
      const isCurrent = () => {
        const liveRequest = currentPortraitRequest(
          expressionResult,
          expressionCurrent,
          activeCard,
          effectiveScenarioPortraitProfile,
          !isScenarioCard(activeCard) || (
            bodyReferenceOverlayReady
            && bodyReferenceOverlayCorruptProfileIds.length === 0
            && !bodyReferenceOverlayBusyProfileId
          ),
          portraitModelTemplate,
          portraitSelectedModelAvailable,
          portraitSelectedModelUsesReference,
          portraitSubject,
          portraitSetting,
          portraitAttire,
          portraitLora,
          portraitAspectRatio,
          portraitMegapixels
        );
        return selectedRequest.source.conversationId === conversationId
          && Boolean(liveRequest && portraitRequestKey(liveRequest) === key);
      };
      const committed = await commitStoredPortrait(stored, {
        exclusive: runStoredPortraitExclusive,
        save: saveStoredPortrait,
        isCurrent,
        rollback: rollbackStoredPortraitWrite,
        install: installGeneratedPortrait
      });
      if (committed) clearPortraitAutomaticRetry(key);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) {
          portraitError = `Portrait generation timed out after ${(timeoutMs + 5_000) / 1000} seconds.`;
          queuePortraitAutomaticRetry(key);
        }
      } else {
        portraitError = cause instanceof Error ? cause.message : 'Portrait generation failed.';
        queuePortraitAutomaticRetry(key);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (portraitController === activeController) {
        portraitBusy = false;
        portraitController = null;
      }
    }
  }

  function suspendPortraitVideoForStaticGeneration() {
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoController = null;
    portraitVideoBusy = false;
    portraitVideoError = '';
    lastPortraitVideoAttemptKey = '';
  }

  async function resetPortraitForConversation() {
    clearSubjectDescriptors();
    invalidatePortraitVideoForPortraitChange(true);
    portraitController?.abort();
    lastPortraitAttemptKey = '';
    portraitError = '';
    generatedPortrait = null;
    if (generatedPortraitUrl) URL.revokeObjectURL(generatedPortraitUrl);
    generatedPortraitUrl = '';
    try {
      await runStoredPortraitExclusive(clearStoredPortrait);
    } catch (cause) {
      portraitPersistenceAvailable = false;
      portraitError = cause instanceof Error ? cause.message : 'Portrait persistence failed.';
    }
  }

  function currentExpressionSnapshot(
    receipt: FictionResponseReceipt | null,
    currentConversationId: string,
    currentMessages: readonly Message[]
  ): ExpressionSidecarRequest | null {
    return expressionRequestForFinalizedFictionResponse(receipt, currentConversationId, currentMessages);
  }













  function expressionSnapshotKey(snapshot: ExpressionSidecarRequest): string {
    return [
      snapshot.source.conversationId,
      snapshot.source.messageCount,
      snapshot.source.messageIndex,
      expressionSourceFingerprint(snapshot.text)
    ].join(':');
  }

  function scheduleExpressionReconciliation(
    enabled: boolean,
    persistenceReady: boolean,
    persistenceAvailable: boolean,
    isStreaming: boolean,
    busy: boolean,
    snapshot: ExpressionSidecarRequest | null,
    current: boolean
  ) {
    if (!enabled || !persistenceReady || !persistenceAvailable || isStreaming || busy || !snapshot || current) return;
    const key = expressionSnapshotKey(snapshot);
    if (key === lastExpressionAttemptKey) return;
    lastExpressionAttemptKey = key;
    void determineExpression(snapshot);
  }

  function queueExpressionAutomaticRetry(key: string) {
    if (!browser || lastExpressionAttemptKey !== key || expressionRetriedKey === key) return;
    expressionRetriedKey = key;
    if (expressionRetryTimer !== null) window.clearTimeout(expressionRetryTimer);
    expressionRetryTimer = window.setTimeout(() => {
      expressionRetryTimer = null;
      if (lastExpressionAttemptKey !== key) return;
      lastExpressionAttemptKey = '';
      scheduleExpressionReconciliation(
        true && expressionsEnabled,
        sidecarPersistenceReady,
        sidecarPersistenceAvailable,
        streaming,
        sidecarBusy,
        expressionSnapshot,
        expressionCurrent
      );
    }, automaticExpressionRetryDelayMs);
  }

  function clearExpressionAutomaticRetry(key: string) {
    if (expressionRetryTimer !== null) window.clearTimeout(expressionRetryTimer);
    expressionRetryTimer = null;
    if (expressionRetriedKey === key) expressionRetriedKey = '';
  }

  function disableSidecarPersistence(cause: unknown) {
    sidecarController?.abort();
    sidecarPersistenceAvailable = false;
    expressionsEnabled = false;
    if (browser) localStorage.setItem(expressionsEnabledStorageKey, 'false');
    sidecarError = cause instanceof Error ? cause.message : 'Expression sidecar persistence failed.';
  }

  async function restoreSidecarState() {
    try {
      const stored = await loadStoredSidecarState();
      if (stored) {
        const normalized = normalizeSidecarState(stored);
        if (normalized.conversationId === conversationId) sidecarState = normalized;
        else await saveStoredSidecarState(emptySidecarState(conversationId));
      } else {
        await saveStoredSidecarState(emptySidecarState(conversationId));
      }
    } catch (cause) {
      disableSidecarPersistence(cause);
    } finally {
      sidecarPersistenceReady = true;
    }
  }

  async function resetSidecarForConversation() {
    sidecarController?.abort();
    lastExpressionAttemptKey = '';
    conversationId = crypto.randomUUID();
    finalizedFictionResponse = null;
    await resetInlineSceneForConversation();
    await resetPortraitForConversation();
    sidecarState = emptySidecarState(conversationId);
    sidecarError = '';
    if (!sidecarPersistenceAvailable) return;
    try {
      await saveStoredSidecarState(sidecarState);
    } catch (cause) {
      disableSidecarPersistence(cause);
    }
  }












  function persistExpressionsEnabled() {
    if (!sidecarPersistenceReady || !sidecarPersistenceAvailable) expressionsEnabled = false;
    localStorage.setItem(expressionsEnabledStorageKey, String(expressionsEnabled));
    sidecarError = '';
    lastExpressionAttemptKey = '';
    if (!expressionsEnabled) {
      sidecarController?.abort();
      portraitController?.abort();
      portraitVideoGeneration += 1;
      portraitVideoController?.abort();
      portraitVideoBusy = false;
    }
  }

  async function determineExpression(selectedSnapshot: ExpressionSidecarRequest | null = null) {
    const snapshot = selectedSnapshot ?? currentExpressionSnapshot(finalizedFictionResponse, conversationId, messages);
    if (!snapshot || streaming || sidecarBusy || !sidecarPersistenceReady || !sidecarPersistenceAvailable || !sidecarState) return;
    const key = expressionSnapshotKey(snapshot);
    lastExpressionAttemptKey = key;
    sidecarBusy = true;
    sidecarError = '';
    const activeController = new AbortController();
    sidecarController = activeController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, SIDECAR_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/api/sidecar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
        signal: activeController.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload.message === 'string' ? payload.message : `Expression sidecar failed (${response.status}).`;
        throw new Error(detail);
      }
      const result = normalizeExpressionSidecarResult(payload);
      if (!expressionResultMatchesRequest(result, snapshot)) throw new Error('Expression sidecar returned a mismatched source snapshot.');
      if (result.source.conversationId !== conversationId) return;
      const nextState = withExpressionSidecarResult(sidecarState, result);
      try {
        await saveStoredSidecarState(nextState);
      } catch (cause) {
        disableSidecarPersistence(cause);
        return;
      }
      sidecarState = nextState;
      clearExpressionAutomaticRetry(key);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) {
          sidecarError = `Expression sidecar timed out after ${SIDECAR_TIMEOUT_MS / 1000} seconds.`;
          queueExpressionAutomaticRetry(key);
        }
      } else {
        sidecarError = cause instanceof Error ? cause.message : 'Expression sidecar failed.';
        queueExpressionAutomaticRetry(key);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (sidecarController === activeController) {
        sidecarBusy = false;
        sidecarController = null;
      }
    }
  }

  async function loadScenarioCatalog() {
    scenarioCatalogSettled = false;
    try {
      const response = await fetch(`${base}/scenarios/catalog.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Bundled scenario catalog failed to load (${response.status}).`);
      scenarioCatalog = normalizeScenarioCatalog(await response.json());
      const activeScenarioId = activeCard?.data.extensions.mullet && typeof activeCard.data.extensions.mullet === 'object'
        ? String((activeCard.data.extensions.mullet as Record<string, unknown>).scenario_id ?? '')
        : '';
      const savedScenarioId = localStorage.getItem(selectedScenarioStorageKey) ?? '';
      selectedScenarioId = scenarioCatalog.scenarios.some((scenario) => scenario.id === savedScenarioId)
        ? savedScenarioId
        : scenarioCatalog.scenarios.some((scenario) => scenario.id === activeScenarioId)
          ? activeScenarioId
          : scenarioCatalog.scenarios[0].id;
      const activeScenario = scenarioCatalog.scenarios.find((scenario) => scenario.id === activeScenarioId);
      if (activeScenario) {
        activeScenarioStarterId = activeScenario.starters.some((starter) => starter.id === activeScenarioStarterId)
          ? activeScenarioStarterId
          : activeScenario.starters[0].id;
        localStorage.setItem(activeScenarioStarterStorageKey, activeScenarioStarterId);
      }
      if (activeScenario) {
        const packaged = await loadScenarioPackage(activeScenario);
        activeCard = packaged.card;
        cardSourceIdentifier = characterSourceIdentifier(activeScenario.card);
        embeddedLorebook = embeddedLoreFromCard(activeCard);
        persistCard();
        if (recoverCanonicalAuthoredOpeningReceipt()) persist();
      }
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Bundled scenario catalog failed to load.';
    } finally {
      scenarioCatalogSettled = true;
      restoreInlineSceneFinalizedSource();
      restoreScenarioOpeningInlineSceneSourceIfNeeded();
      void restoreInlineSceneAndMotion();
    }
  }

  function persistSelectedScenarioSelection() {
    if (!scenarioCatalog?.scenarios.some((scenario) => scenario.id === selectedScenarioId)) return;
    localStorage.setItem(selectedScenarioStorageKey, selectedScenarioId);
  }

  async function loadScenarioPackage(entry: ScenarioCatalogEntry): Promise<ScenarioPackage> {
    const [cardResponse, lorebookResponse] = await Promise.all([
      fetch(`${base}/scenarios/${entry.card}`, { cache: 'no-store' }),
      fetch(`${base}/scenarios/${entry.lorebook}`, { cache: 'no-store' })
    ]);
    if (!cardResponse.ok || !lorebookResponse.ok) {
      throw new Error(`Bundled scenario package failed to load (${cardResponse.status}/${lorebookResponse.status}).`);
    }
    return validateScenarioPackage(entry, await cardResponse.json(), await lorebookResponse.json());
  }

  function hasRealTranscript(): boolean {
    if (messages.some((message) => message.role === 'user')) return true;
    return messages.length > 0 && (!activeCard || !containsOnlyOpeningGreeting(activeCard));
  }

  function currentWorkspaceMutationFingerprint(): string {
    return workspaceMutationFingerprint(conversationId, messages);
  }

  function restoreUnchangedWorkspace(expectedFingerprint: string) {
    restoreWorkspaceState();
    if (currentWorkspaceMutationFingerprint() !== expectedFingerprint) {
      throw new Error('The workspace changed in another tab. Review the restored conversation and try again.');
    }
  }

  async function startSelectedScenario(starterId: string) {
    const starterChoice = selectedScenario?.starters.find((starter) => starter.id === starterId) ?? null;
    if (
      !selectedScenario
      || !starterChoice
      || streaming
      || scenarioLoading
      || assistantTurnBusy
      || workspaceBusy
    ) return;
    errorMessage = '';
    noticeMessage = '';
    const expectedWorkspace = currentWorkspaceMutationFingerprint();
    const scenario = selectedScenario;
    scenarioLoading = true;
    workspaceBusy = true;
    try {
      const packaged = await loadScenarioPackage(scenario);
      const starter = packaged.starters.starters.find((candidate) => candidate.id === starterId);
      if (!starter) throw new Error('Bundled scenario starter failed validation.');
      const starterProfile = packaged.portraitCast.profiles.find(
        (profile) => profile.id === starter.portraitProfileId
      );
      if (!starterProfile) throw new Error('Bundled scenario portrait profile failed validation.');
      restoreUnchangedWorkspace(expectedWorkspace);
      if (hasRealTranscript() && !window.confirm(`Replace the current conversation with the ${starter.label} opening?`)) return;

      activeCard = packaged.card;
      selectedScenarioId = scenario.id;
      localStorage.setItem(selectedScenarioStorageKey, selectedScenarioId);
      activeScenarioStarterId = starterId;
      localStorage.setItem(activeScenarioStarterStorageKey, activeScenarioStarterId);
      // The scenario declares its own model per character. Use it.
      portraitModelTemplate = starterProfile.modelTemplate;
      portraitMegapixels = 0.5;
      portraitModelSelectionPersisted = true;
      localStorage.setItem(portraitModelTemplateStorageKey, portraitModelTemplate);
      cardSourceIdentifier = characterSourceIdentifier(scenario.card);
      portraitDataUrl = '';
      embeddedLorebook = embeddedLoreFromCard(activeCard);
      loreEnabled = true;
      loreTimedState = emptyLoreTimedState();
      lastLoreActivations = null;
      lastLoreActivationCount = 0;
      lastLoreBudget = 0;
      localStorage.removeItem(loreTimedStateStorageKey);
      persistCard();
      persistLoreEnabled();
      messages = freshConversation();
      await resetSidecarForConversation();
      bindAuthoredFictionOpeningReceipt();
      if (!publishScenarioOpeningInlineSceneSource()) {
        throw new Error('Bundled scenario opening could not be bound to inline-scene provenance.');
      }
      persist();
      noticeMessage = `${starter.label} · ${starter.title} started with ${packaged.lorebook.entries.length} embedded lore entries.`;
      await scrollToLatest();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Bundled scenario failed to start.';
    } finally {
      scenarioLoading = false;
      workspaceBusy = false;
    }
  }

  function persist() {
    if (!browser) return;
    const workspace = createStoredWorkspace(conversationId, messages, finalizedFictionResponse);
    saveStoredWorkspace(localStorage, workspace);
  }

  function freshConversation(): Message[] {
    if (!activeCard) return [];
    const greeting = isScenarioCard(activeCard)
      ? scenarioStarterMessage(activeCard, activeScenarioStarterId)
      : firstCharacterMessage(activeCard);
    return greeting.trim() ? [{ role: 'assistant', content: greeting }] : [];
  }

  function bindAuthoredFictionOpeningReceipt() {
    finalizedFictionResponse = true && messages.length === 1
      ? createAuthoredOpeningReceipt(conversationId, messages)
      : null;
  }

  function recoverCanonicalAuthoredOpeningReceipt(): boolean {
    if (
      finalizedFictionResponse
      || false
      || !activeCard
      || !containsOnlyOpeningGreeting(activeCard)
    ) return false;
    bindAuthoredFictionOpeningReceipt();
    return finalizedFictionResponse !== null;
  }

  function embeddedLoreFromCard(card: ImportedCharacterCard | null): ImportedLorebook | null {
    if (!card?.data.characterBook) return null;
    try {
      return normalizeLorebook(card.data.characterBook, `${card.data.name} lore`, 'embedded');
    } catch {
      return null;
    }
  }

  function storedLorebooks(books: ImportedLorebook[]): StoredLorebook[] {
    return books.map((book) => ({ name: book.name, raw: book.raw }));
  }

  function validateActiveLorebookSize(books: ImportedLorebook[]) {
    const bytes = new TextEncoder().encode(JSON.stringify(storedLorebooks(books))).byteLength;
    if (bytes > maxActiveLorebookBytes) throw new Error('Active lorebooks exceed the 24 MB chat transport limit.');
  }

  function normalizeStoredLorebooks(stored: StoredLorebook[]): ImportedLorebook[] {
    if (stored.length > 20) throw new Error('Persisted lorebooks exceed the 20-book active limit.');
    const restored = stored.map((book) => normalizeLorebook(book.raw, book.name, 'imported'));
    validateActiveLorebookSize(restored);
    return restored;
  }

  async function restoreLorebooks() {
    try {
      let stored = await loadStoredLorebooks();
      const legacy = localStorage.getItem(lorebookStorageKey);
      if (stored.length === 0 && legacy) {
        const parsed = JSON.parse(legacy);
        const legacyBooks = Array.isArray(parsed) ? parsed : [parsed];
        stored = legacyBooks;
        const restored = normalizeStoredLorebooks(stored);
        await saveStoredLorebooks(stored);
        localStorage.removeItem(lorebookStorageKey);
        importedLorebooks = restored;
      } else if (stored.length > 0 && legacy) {
        importedLorebooks = normalizeStoredLorebooks(stored);
        localStorage.removeItem(lorebookStorageKey);
      } else {
        importedLorebooks = normalizeStoredLorebooks(stored);
      }
    } catch (cause) {
      lorePersistenceAvailable = false;
      errorMessage = cause instanceof Error ? cause.message : 'Lorebook persistence failed.';
    } finally {
      lorePersistenceReady = true;
    }
  }

  function containsOnlyOpeningGreeting(card: ImportedCharacterCard): boolean {
    const greeting = isScenarioCard(card)
      ? scenarioStarterMessage(card, activeScenarioStarterId)
      : firstCharacterMessage(card);
    return messages.length === 1 && messages[0].role === 'assistant' && messages[0].content === greeting;
  }

  function persistCard() {
    if (!browser || !activeCard) return;
    localStorage.setItem(cardStorageKey, JSON.stringify(activeCard.raw));
    if (portraitDataUrl) localStorage.setItem(portraitStorageKey, portraitDataUrl);
    else localStorage.removeItem(portraitStorageKey);
    if (cardSourceIdentifier) localStorage.setItem(cardSourceIdentifierStorageKey, cardSourceIdentifier);
    else localStorage.removeItem(cardSourceIdentifierStorageKey);
  }

  async function scrollToLatest() {
    await tick();
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });
  }

  function chooseStarter(text: string) {
    draft = text;
  }



  async function startFictionWorkspace() {
  }

  async function clearConversation() {
    if (streaming || workspaceBusy || assistantTurnBusy) return;
    const expectedWorkspace = currentWorkspaceMutationFingerprint();
    workspaceBusy = true;
    try {
      restoreUnchangedWorkspace(expectedWorkspace);
      messages = freshConversation();
      errorMessage = '';
      noticeMessage = '';
      lastLoreActivations = null;
      lastLoreBudget = 0;
      loreTimedState = emptyLoreTimedState();
      localStorage.removeItem(loreTimedStateStorageKey);
      await resetSidecarForConversation();
      bindAuthoredFictionOpeningReceipt();
      persist();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Conversation could not be reset.';
    } finally {
      workspaceBusy = false;
    }
  }

  async function portraitFromPng(file: File): Promise<string> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.82);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function importCharacterCard(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    errorMessage = '';
    noticeMessage = '';
    const expectedWorkspace = currentWorkspaceMutationFingerprint();
    workspaceBusy = true;
    try {
      if (file.size > MAX_CHARACTER_CARD_PNG_BYTES) throw new Error('Character card exceeds 25 MB.');
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const imported = isPng
        ? extractPngCharacterCard(await file.arrayBuffer())
        : parseCharacterCardJson(await file.text());
      const nextPortrait = isPng ? await portraitFromPng(file) : '';
      restoreUnchangedWorkspace(expectedWorkspace);
      const replaceOpeningGreeting = activeCard ? containsOnlyOpeningGreeting(activeCard) : false;
      const seedGreeting = messages.length === 0 || replaceOpeningGreeting;

      activeCard = imported;
      cardSourceIdentifier = characterSourceIdentifier(file.name);
      portraitDataUrl = nextPortrait;
      embeddedLorebook = embeddedLoreFromCard(imported);
      lastLoreActivations = null;
      lastLoreBudget = 0;
      persistCard();
      if (seedGreeting) {
        messages = freshConversation();
        await resetSidecarForConversation();
        bindAuthoredFictionOpeningReceipt();
        persist();
      } else if (recoverCanonicalAuthoredOpeningReceipt()) {
        persist();
      }
      noticeMessage = `${imported.data.name} loaded from ${file.name}.`;
      await scrollToLatest();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Character card import failed.';
    } finally {
      workspaceBusy = false;
      input.value = '';
    }
  }

  function removeCharacterCard() {
    if (streaming) return;
    const removedName = activeCard?.data.name;
    activeCard = null;
    cardSourceIdentifier = '';
    portraitDataUrl = '';
    embeddedLorebook = null;
    lastLoreActivations = null;
    lastLoreBudget = 0;
    localStorage.removeItem(cardStorageKey);
    localStorage.removeItem(portraitStorageKey);
    localStorage.removeItem(cardSourceIdentifierStorageKey);
    noticeMessage = removedName ? `${removedName} removed; conversation retained.` : '';
  }

  async function importLorebook(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    errorMessage = '';
    noticeMessage = '';
    lorePersistenceBusy = true;
    try {
      if (file.size > MAX_LOREBOOK_PNG_BYTES) throw new Error('Lorebook exceeds 25 MB.');
      const fallbackName = file.name.replace(/\.(?:json|lorebook|png)$/i, '') || 'Imported lorebook';
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const imported = isPng
        ? extractPngLorebook(await file.arrayBuffer(), fallbackName, 'imported')
        : parseLorebookJson(await file.text(), fallbackName, 'imported');
      const sameNameIndex = importedLorebooks.findIndex((book) => book.name === imported.name);
      const nextBooks = sameNameIndex >= 0
        ? importedLorebooks.map((book, index) => index === sameNameIndex ? imported : book)
        : [...importedLorebooks, imported];
      if (nextBooks.length > 20) {
        throw new Error('At most 20 imported lorebooks can be active.');
      }
      validateActiveLorebookSize(nextBooks);
      await saveStoredLorebooks(storedLorebooks(nextBooks));
      importedLorebooks = nextBooks;
      loreEnabled = true;
      persistLoreEnabled();
      lastLoreActivations = null;
      lastLoreBudget = 0;
      noticeMessage = `${imported.name} loaded with ${imported.entries.length} lore entries.`;
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Lorebook import failed.';
    } finally {
      lorePersistenceBusy = false;
      input.value = '';
    }
  }

  async function removeImportedLorebook(bookIndex: number) {
    if (streaming || !importedLorebooks[bookIndex]) return;
    const removedName = importedLorebooks[bookIndex].name;
    const nextBooks = importedLorebooks.filter((_book, index) => index !== bookIndex);
    lorePersistenceBusy = true;
    try {
      await saveStoredLorebooks(storedLorebooks(nextBooks));
      importedLorebooks = nextBooks;
      lastLoreActivations = null;
      lastLoreBudget = 0;
      noticeMessage = `${removedName} removed.`;
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Lorebook persistence failed.';
    } finally {
      lorePersistenceBusy = false;
    }
  }

  function persistLoreEnabled() {
    if (browser) localStorage.setItem(loreEnabledStorageKey, String(loreEnabled));
    lastLoreActivations = null;
    lastLoreBudget = 0;
  }

  function persistLoreSettings(changed?: LorebookRecursionControl) {
    try {
      if (changed) loreSettings = reconcileLorebookRecursionControls(loreSettings, changed);
      loreSettings = resolveLorebookSettings(loreSettings);
      if (browser) localStorage.setItem(loreSettingsStorageKey, JSON.stringify(loreSettings));
      lastLoreActivations = null;
      lastLoreBudget = 0;
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Invalid lorebook settings.';
    }
  }

  function persistPersonaDescription() {
    if (!browser) return;
    if (personaDescription) localStorage.setItem(personaDescriptionStorageKey, personaDescription);
    else localStorage.removeItem(personaDescriptionStorageKey);
    lastLoreActivations = null;
    lastLoreBudget = 0;
  }

  function persistLoreTimedState() {
    if (!browser) return;
    const hasEffects = Object.keys(loreTimedState.sticky).length > 0 || Object.keys(loreTimedState.cooldown).length > 0;
    if (hasEffects) localStorage.setItem(loreTimedStateStorageKey, JSON.stringify(loreTimedState));
    else localStorage.removeItem(loreTimedStateStorageKey);
  }

  function readLoreActivations(value: string | null): LoreActivation[] | null {
    if (value === null) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  $: mediaBusy = sidecarBusy || portraitBusy || portraitVideoBusy || inlineSceneBusy || inlineSceneVideoBusy;
  $: mediaError = portraitError || portraitVideoError || inlineSceneError || inlineSceneVideoError || sidecarError;
  $: mediaRefreshable = Boolean(portraitRequest || inlineSceneSidecarRequest);
  // The exact caption the scene is being told, so the operator can see it and the
  // browser check can compare it across turns.
  $: continuityCaption = (() => {
    if (!portraitRequest || !generatedPortrait || !portraitCurrent) return '';
    const id = portraitRequest.source.characterId ?? '';
    const descriptor = subjectDescriptors[id];
    return descriptor && subjectDescriptorPortraitKeys[id] === generatedPortrait.requestKey ? descriptor.caption : '';
  })();
  $: continuityStatus = continuityStatusFor(
    portraitRequest,
    Boolean(expressionsEnabled && expressionSnapshot && portraitDisplayProfile),
    subjectDescriptorPortraitKeys,
    subjectCaptionSettledKeys,
    subjectCaptionError
  );

  // True once every visible subject that currently has a portrait on screen also has a
  // caption read from that exact portrait. Without this the scene can be directed before
  // the caption lands and go out with no continuity at all - it would self-correct on the
  // next reconciliation, because continuity is part of the request key, but only after
  // burning a whole scene generation.
  // A portrait is expected for this response as soon as there is a finalized response
  // to classify and a scenario character to portray. The portrait request itself only
  // exists after the classifier lands, and the scene director is faster than that, so
  // the wait has to start from the response, not from the request.
  function subjectContinuityWaitKey(): string {
    if (!expressionsEnabled || !expressionSnapshot || !portraitDisplayProfile) return '';
    return [
      expressionSnapshot.source.conversationId,
      expressionSnapshot.source.messageCount,
      expressionSnapshot.source.messageIndex,
      portraitDisplayProfile.id
    ].join('\u001f');
  }

  function subjectContinuityReady(): boolean {
    const waitKey = subjectContinuityWaitKey();
    // No portrait is expected for this response: nothing to wait for.
    if (!waitKey) return true;
    const characterId = portraitRequest?.source.characterId ?? portraitDisplayProfile?.id ?? '';
    if (!characterId) return true;
    // This turn's portrait has been captioned, or its caption has failed: go.
    if (portraitRequest && subjectCaptionSettledKeys[characterId] === portraitRequestKey(portraitRequest)) return true;
    // The classifier or the portrait failed, or the label landed but no portrait can be
    // built for it: go without continuity rather than never.
    if (portraitError || sidecarError) return true;
    if (expressionCurrent && !portraitRequest && portraitCapabilities) return true;
    // Bounded wait from the first time this response was awaited. Never latches: the
    // timer bumps a reactive tick that re-runs the reconciliation past the bound.
    const startedAt = continuityWaitStartedAt[waitKey];
    if (startedAt === undefined) {
      continuityWaitStartedAt = { [waitKey]: Date.now() };
      scheduleContinuityWaitRelease();
      return false;
    }
    return Date.now() - startedAt >= SUBJECT_CONTINUITY_WAIT_MS;
  }

  function scheduleContinuityWaitRelease() {
    if (!browser) return;
    if (continuityWaitTimer !== null) window.clearTimeout(continuityWaitTimer);
    continuityWaitTimer = window.setTimeout(() => {
      continuityWaitTimer = null;
      continuityWaitTick += 1;
    }, SUBJECT_CONTINUITY_WAIT_MS + 100);
  }

  function continuityStatusFor(
    request: PortraitRequest | null,
    expected: boolean,
    portraitKeys: Record<string, string>,
    settledKeys: Record<string, string>,
    captionError: string
  ): string {
    if (!request) return expected ? 'waiting for portrait…' : 'none';
    const id = request.source.characterId ?? '';
    const key = portraitRequestKey(request);
    if (portraitKeys[id] === key) return 'current';
    if (settledKeys[id] === key || captionError) return 'unavailable';
    return 'waiting for caption…';
  }

  function castContinuityClause(cast: { identities: readonly { characterId?: string; profileId?: string }[] }): string {
    // Only a caption read from the portrait on screen for this turn may describe a
    // subject. Anything older would force last turn's wardrobe onto this scene.
    const currentKey = generatedPortrait && portraitCurrent ? generatedPortrait.requestKey : '';
    const descriptors = cast.identities
      .map((identity) => {
        const id = identity.characterId ?? identity.profileId ?? '';
        const descriptor = subjectDescriptors[id];
        return descriptor && currentKey && subjectDescriptorPortraitKeys[id] === currentKey ? descriptor : null;
      })
      .filter((descriptor): descriptor is SubjectDescriptor => Boolean(descriptor));
    return subjectContinuityClause(descriptors);
  }

  function toggleMedia() {
    mediaEnabled = !mediaEnabled;
    expressionsEnabled = mediaEnabled;
    portraitMotionEnabled = mediaEnabled;
    inlineScenesEnabled = mediaEnabled;
    inlineSceneMotionEnabled = mediaEnabled;
    if (!browser) return;
    localStorage.setItem(mediaEnabledStorageKey, String(mediaEnabled));
    localStorage.setItem(expressionsEnabledStorageKey, String(mediaEnabled));
    localStorage.setItem(portraitMotionEnabledStorageKey, String(mediaEnabled));
    localStorage.setItem(inlineScenesEnabledStorageKey, String(mediaEnabled));
    localStorage.setItem(inlineSceneMotionEnabledStorageKey, String(mediaEnabled));
  }

  // Refresh the latest image of both classes. Motion follows its own still automatically.
  async function refreshLatestMedia() {
    if (!mediaEnabled || mediaBusy) return;
    await Promise.all([
      portraitCapabilities ? Promise.resolve() : loadPortraitGenerator(),
      portraitVideoCapabilities ? Promise.resolve() : loadPortraitVideoGenerator(),
      inlineSceneCapabilities ? Promise.resolve() : loadInlineSceneGenerator(),
      inlineSceneVideoCapabilities ? Promise.resolve() : loadInlineSceneVideoGenerator()
    ]);
    await Promise.all([
      portraitRequest ? generatePortrait(portraitRequest) : Promise.resolve(),
      inlineSceneSidecarRequest ? generateInlineScene(inlineSceneSidecarRequest) : Promise.resolve()
    ]);
  }

  function persistTokenLimit() {
    if (browser) localStorage.setItem('mullet.response-token-limit.v2', String(tokenLimit));
    lastLoreBudget = 0;
  }

  function stop() {
    controller?.abort();
  }

  async function send() {
    const content = draft.trim();
    const capacityError = content ? workspaceCompletedTurnCapacityError(messages.length) : null;
    if (capacityError) {
      errorMessage = capacityError;
      return;
    }
    if (
      !content
      || streaming
      || workspaceBusy
      || scenarioLoading
      || !lorePersistenceReady
    ) return;

    await sendChatTurn(content);
  }

  async function sendChatTurn(content: string): Promise<boolean> {
    const previousMessages = messages.map((message) => ({ ...message }));
    const previousDraft = draft;

    const outboundMessages = [...messages, { role: 'user' as const, content }];
    const supplementalLorebooks: ImportedLorebook[] = importedLorebooks;
    let requestBody: string;
    try {
      requestBody = serializeChatRequest({
        mode: 'fiction',
        messages: outboundMessages,
        maxTokens: tokenLimit,
        characterCard: activeCard?.raw ?? null,
        userName: 'You',
        personaDescription,
        characterFilterNames: cardSourceIdentifier ? [cardSourceIdentifier] : [],
        characterTagIds: [],
        loreTimedState,
        loreEnabled,
        lorebooks: loreEnabled
          ? supplementalLorebooks.map((book) => ({ name: book.name, raw: book.raw }))
          : [],
        lorebookSettings: loreSettings
      });
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Chat request could not be prepared.';
      return false;
    }

    sidecarController?.abort();
    portraitController?.abort();
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoBusy = false;
    lastPortraitVideoAttemptKey = '';
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    lastInlineSceneAttemptKey = '';
    inlineSceneVideoGeneration += 1;
    inlineSceneVideoController?.abort();
    inlineSceneVideoController = null;
    inlineSceneVideoBusy = false;
    lastInlineSceneVideoAttemptKey = '';
    errorMessage = '';
    noticeMessage = '';
    lastLoreActivations = null;
    lastLoreBudget = 0;
    draft = '';
    messages = [...outboundMessages, { role: 'assistant', content: '' }];
    streaming = true;
    controller = new AbortController();
    let completedResponse = false;
    let completedAssistantMemoryActive: boolean | null = null;
    await scrollToLatest();

    try {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: requestBody,
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const detail = await response.text();
        throw new Error(detail || `Request failed (${response.status})`);
      }
      if (response.headers.get('x-mullet-mode') !== 'fiction') {
        throw new Error('Server response mode does not match this conversation.');
      }

      lastLoreActivations = readLoreActivations(response.headers.get('x-mullet-lore-entries'));
      const loreCount = Number(response.headers.get('x-mullet-lore-active'));
      lastLoreActivationCount = Number.isInteger(loreCount) && loreCount >= 0
        ? loreCount
        : lastLoreActivations?.length ?? 0;
      const loreBudget = Number(response.headers.get('x-mullet-lore-budget'));
      lastLoreBudget = Number.isInteger(loreBudget) && loreBudget > 0 ? loreBudget : 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hitTokenLimit = false;
      let terminalEventSeen = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          const streamPayload = parseChatStreamPayload(payload);
          terminalEventSeen ||= streamPayload.terminal;
          if (streamPayload.done) continue;
          const event = streamPayload.event as Record<string, any>;
          if (event?.mullet?.loreTimedState !== undefined) {
            loreTimedState = normalizeLoreTimedState(event.mullet.loreTimedState);
            persistLoreTimedState();
            continue;
          }
          hitTokenLimit ||= streamPayload.hitTokenLimit;
          const token = streamPayload.token;
          if (!token) continue;
          const last = messages.at(-1);
          if (last?.role === 'assistant') {
            last.content += token;
            messages = [...messages];
            await scrollToLatest();
          }
        }
      }

      assertFinalizedChatStream(terminalEventSeen, messages.at(-1)?.content ?? '');
      finalizedFictionResponse = createCompletedFictionResponseReceipt(conversationId, messages);
      persist();
      completedResponse = true;
      if (hitTokenLimit) noticeMessage = `Stopped at the ${tokenLimit}-token response limit.`;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        errorMessage = 'Generation stopped.';
      } else {
        errorMessage = cause instanceof Error ? cause.message : 'Generation failed.';
      }
      finalizedFictionResponse = null;
      if (messages.at(-1)?.content === '') messages = messages.slice(0, -1);
      persist();
    } finally {
      streaming = false;
      controller = null;
      if (completedResponse) {
        publishFinalizedInlineSceneSource(
          inlineSceneSourceForCompletedTurn(transcriptSourceForMessages(conversationId, messages))
        );
      }
      await scrollToLatest();
    }
    return completedResponse;
  }

  function composerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
</script>

<svelte:head>
  <title>MULLET · {false ? 'Personal Assistant' : 'Local scenario workbench'}</title>
</svelte:head>

<div class="shell">
  <header>
    <div class="brand">
      <span class="mark">M</span>
      <div>
        <h1>MULLET</h1>
        <p>Multimodal Universe, Lore, LoRAs, Expressions &amp; Timeline</p>
      </div>
    </div>
    <details class="runtime">
      <summary aria-label="Runtime and workspace controls">
        <span class:live={streaming || workspaceBusy || assistantTurnBusy || sidecarBusy || portraitBusy || portraitVideoBusy || inlineSceneBusy || inlineSceneVideoBusy} class="dot"></span>
        <span class="runtime-label"><strong>{data.model}</strong><small>{data.revision.slice(0, 10)}</small></span>
      </summary>
    </details>
  </header>

  <main>
    <aside class:assistant-mode={false}>
      <div class:active={false || activeCard || (generatedPortraitUrl && portraitCurrent)} class:generated={true && expressionsEnabled && generatedPortraitUrl && portraitCurrent} class="portrait">
        {#if false}
          <span class="initial">A</span>
        {:else if expressionsEnabled && generatedPortraitUrl && portraitCurrent}
          <img src={generatedPortraitUrl} alt={`${generatedPortrait?.source.expression ?? 'Current'} generated expression portrait`} />
          {#if portraitVideoMounted}
            <video
              class="portrait-motion"
              class:playback-confirmed={portraitVideoVisible}
              bind:this={portraitVideoElement}
              src={generatedPortraitVideoUrl}
              preload="auto"
              muted
              loop
              playsinline
              on:canplay={handlePortraitVideoCanPlay}
              on:timeupdate={handlePortraitVideoTimeUpdate}
              on:error={handlePortraitVideoPlaybackError}
              aria-label={`${generatedPortrait?.source.expression ?? 'Current'} generated expression motion portrait`}
            ></video>
          {/if}
          <span class:stale={!portraitCurrent || (portraitMotionEnabled && Boolean(generatedPortraitVideo) && !portraitVideoCurrent) || portraitVideoPlaybackState === 'fallback'} class="portrait-status">{portraitBusy ? 'Updating…' : portraitVideoBusy ? 'Animating…' : portraitVideoPlaybackState === 'starting' && portraitVideoMounted ? 'Starting motion…' : portraitVideoPlaybackState === 'fallback' && portraitVideoMounted ? 'Static fallback' : portraitCurrent ? generatedPortrait?.source.expression : 'Stale'}</span>
        {:else if portraitDataUrl && activeCard}
          <img src={portraitDataUrl} alt={`${activeCard.data.name} character portrait`} />
        {:else if activeCard}
          <span class="initial">{activeCard.data.name.slice(0, 1).toUpperCase()}</span>
        {:else}
          <span>Import a SillyTavern<br />JSON or PNG card</span>
        {/if}
      </div>
      {#if false}
        <div class="scenario">
          <span class="eyebrow">Active mode</span>
          <strong>Personal Assistant</strong>
          <p>A neutral local Gemma channel with evidence-bound persistent memory for planning, drafting, organizing, and analysis. Character cards, fiction lore, expressions, portraits, and scene generators remain isolated.</p>
          <div class="card-facts"><span>Local model</span><span>Persistent memory</span><span>No external tools</span></div>
        </div>
      {:else if activeCard}
        <div class="scenario">
          <span class="eyebrow">{isScenarioCard(activeCard) ? 'Active scenario' : `Active character · V${activeCard.version}`}</span>
          <strong>{activeCard.data.name}</strong>
          <p>{activeCard.data.description || 'No character description supplied.'}</p>
          <div class="card-facts">
            <span>{activeCard.specVersion}</span>
            <span>{embeddedLoreEntryCount(activeCard)} lore entries</span>
          </div>
        </div>
      {:else}
        <div class="scenario">
          <span class="eyebrow">Active scenario</span>
          <strong>Open conversation</strong>
          <p>The clean model channel is active. Load a V1, V2, or V3 character card to condition it.</p>
        </div>
      {/if}
      <input
        class="file-input"
        bind:this={cardInput}
        type="file"
        accept=".json,.png,application/json,image/png"
        on:change={importCharacterCard}
        disabled={streaming || workspaceBusy}
        aria-label="Choose a character card"
      />
      <div class="card-actions">
        <button class="card-button primary" on:click={() => cardInput?.click()} disabled={streaming || workspaceBusy}>
          {activeCard ? 'Replace card' : 'Import card'}
        </button>
        {#if activeCard}
          <button class="card-button" on:click={removeCharacterCard} disabled={streaming || workspaceBusy}>Remove</button>
        {/if}
      </div>
      <section class="scenario-picker" aria-label="Bundled scenarios">
        <span class="eyebrow">Bundled scenarios</span>
        {#if scenarioCatalog}
          {#if selectedScenario}
            <label class="scenario-select">
              <span>Scenario</span>
              <select
                bind:value={selectedScenarioId}
                on:change={persistSelectedScenarioSelection}
                disabled={streaming || scenarioLoading}
                aria-label="Bundled scenario"
              >
                {#each scenarioCatalog.scenarios as scenario}
                  <option value={scenario.id}>{scenario.title}</option>
                {/each}
              </select>
            </label>
            <div class="scenario-starters" role="group" aria-label="Starting scenario">
              {#each selectedScenario.starters as starter}
                <button
                  class="scenario-starter"
                  class:active={starter.id === activeScenarioStarterId && cardSourceIdentifier === characterSourceIdentifier(selectedScenario.card)}
                  aria-pressed={starter.id === activeScenarioStarterId && cardSourceIdentifier === characterSourceIdentifier(selectedScenario.card)}
                  aria-label={`Start the ${starter.label} scenario`}
                  on:click={() => void startSelectedScenario(starter.id)}
                  disabled={streaming || scenarioLoading}
                >
                  {starter.label}
                </button>
              {/each}
            </div>
            <small>{scenarioLoading ? 'Starting selected opening…' : selectedScenario.summary}</small>
          {/if}
        {:else}
          <small>Loading bundled scenarios…</small>
        {/if}
      </section>
      <!-- One media panel. No model choice, no mode choice, no per-feature checkboxes.
           Expression still, expression motion, scene still and scene motion are always on
           together; how a reference (LoRA or photo) becomes an image is scenario data, not
           a control. Exactly two buttons: turn it all off, and refresh the latest of both
           classes. -->
      <section class="media-panel" aria-label="Media">
        <div class="media-heading">
          <span class="eyebrow">Media</span>
          <strong>{mediaEnabled ? 'On' : 'Off'}</strong>
        </div>
        {#if mediaEnabled}
          <dl class="media-status">
            <dt>Expression</dt>
            <dd>{sidecarBusy ? 'Determining…' : expressionResult?.output.expression ?? 'waiting for a finalized response'}</dd>
            <dt>Portrait</dt>
            <dd>{portraitBusy ? 'Generating…' : portraitCurrent ? `${generatedPortrait?.width}×${generatedPortrait?.height}` : 'none yet'}</dd>
            <dt>Portrait motion</dt>
            <dd>{portraitVideoBusy ? 'Animating…' : portraitVideoCurrent ? 'current' : 'none yet'}</dd>
            <dt>Scene</dt>
            <dd>{inlineSceneBusy ? 'Directing…' : inlineSceneCurrent && generatedInlineScene ? `${generatedInlineScene.references.length} references` : 'none yet'}</dd>
            <dt>Scene motion</dt>
            <dd>{inlineSceneVideoBusy ? 'Animating…' : inlineSceneVideoCurrent ? 'current' : 'none yet'}</dd>
            <dt>Continuity</dt>
            <dd>{continuityStatus}{continuityCaption ? ` · ${continuityCaption}` : ''}</dd>
          </dl>
          {#if mediaError}<div class="sidecar-error" role="alert">{mediaError}</div>{/if}
        {/if}
        <div class="media-actions">
          <button on:click={toggleMedia} disabled={mediaBusy}>{mediaEnabled ? 'Turn media off' : 'Turn media on'}</button>
          <button on:click={() => void refreshLatestMedia()} disabled={!mediaEnabled || mediaBusy || !mediaRefreshable}>
            {mediaBusy ? 'Refreshing…' : 'Refresh images'}
          </button>
        </div>
      </section>
      <section class="lore-panel" aria-label="Active lorebooks">
        <div class="lore-heading">
          <div>
            <span class="eyebrow">Lorebooks</span>
            <strong>{activeLorebooks.length} active</strong>
          </div>
          <label class="toggle">
            <input type="checkbox" bind:checked={loreEnabled} on:change={persistLoreEnabled} disabled={streaming} />
            <span>{loreEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>


        {#if activeLorebooks.length}
          <div class="lore-list">
            {#each activeLorebooks as book}
              <div class="lore-row">
                <div>
                  <strong>{book.name}</strong>
                  <small>{book.origin} · {book.entries.length} entries</small>
                </div>
                {#if book.origin === 'imported'}
                  <button on:click={() => void removeImportedLorebook(importedLorebooks.indexOf(book))} disabled={streaming || lorePersistenceBusy} aria-label={`Remove ${book.name}`}>×</button>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="lore-empty">No embedded or imported lorebook.</p>
        {/if}

        {#if lastLoreActivations !== null}
          <div class:active={lastLoreActivationCount > 0} class="lore-fired">
            <strong>{lastLoreActivationCount} fired last turn</strong>
            {#if lastLoreActivations.length}
              <span>{lastLoreActivations.map((entry) => entry.name).join(', ')}</span>
            {/if}
          </div>
        {/if}

        <input
          class="file-input"
          bind:this={loreInput}
          type="file"
          accept=".json,.lorebook,.png,application/json,image/png"
          on:change={importLorebook}
          disabled={streaming || !lorePersistenceReady || !lorePersistenceAvailable || lorePersistenceBusy}
          aria-label="Choose a lorebook"
        />
        <button class="lore-import" on:click={() => loreInput?.click()} disabled={streaming || !lorePersistenceReady || !lorePersistenceAvailable || lorePersistenceBusy}>
          Import lorebook
        </button>

        <details class="lore-settings">
          <summary>Scan settings</summary>
          <div class="lore-setting-grid">
            <label>
              <span>Depth</span>
              <input type="number" min="0" max="1000" step="1" bind:value={loreSettings.scanDepth} on:change={() => persistLoreSettings()} disabled={streaming} />
            </label>
            <label>
              <span>Context %</span>
              <input type="number" min="1" max="100" step="1" bind:value={loreSettings.budgetPercent} on:change={() => persistLoreSettings()} disabled={streaming} />
            </label>
            <label>
              <span>Minimum fired</span>
              <input type="number" min="0" max="100" step="1" bind:value={loreSettings.minActivations} on:change={() => persistLoreSettings('minActivations')} disabled={streaming} />
            </label>
            <label>
              <span>Maximum depth</span>
              <input type="number" min="0" max="100" step="1" bind:value={loreSettings.minActivationsDepthMax} on:change={() => persistLoreSettings()} disabled={streaming} />
            </label>
            <label>
              <span>Recursion cap</span>
              <input type="number" min="0" max="10" step="1" bind:value={loreSettings.maxRecursionSteps} on:change={() => persistLoreSettings('maxRecursionSteps')} disabled={streaming} />
            </label>
            <label>
              <span>Insertion strategy</span>
              <select bind:value={loreSettings.characterStrategy} on:change={() => persistLoreSettings()} disabled={streaming}>
                <option value={0}>Sorted Evenly</option>
                <option value={1}>Character Lore First</option>
                <option value={2}>Global Lore First</option>
              </select>
            </label>
          </div>
          <label class="check-row"><input type="checkbox" bind:checked={loreSettings.recursive} on:change={() => persistLoreSettings()} disabled={streaming} /> Recursive scanning</label>
          <label class="check-row"><input type="checkbox" bind:checked={loreSettings.matchWholeWords} on:change={() => persistLoreSettings()} disabled={streaming} /> Whole-word matching</label>
          <small>Minimum fired and recursion cap are mutually exclusive; the last nonzero edit wins.</small>
          <small>{lastLoreBudget || Math.round(loreSettings.budgetPercent * Math.max(1, loreSettings.maxContextTokens - tokenLimit) / 100)}-token budget · server tokenizer</small>
        </details>
      </section>
      <label class="persona-field">
        <span class="eyebrow">Your role</span>
        <textarea
          bind:value={personaDescription}
          on:change={persistPersonaDescription}
          rows="3"
          maxlength="100000"
          placeholder="Optional user-character description for opt-in lore scans"
          disabled={streaming}
        ></textarea>
      </label>
      <button class="clear" on:click={() => void clearConversation()} disabled={streaming || workspaceBusy || assistantTurnBusy || messages.length === 0}>
        {false ? 'Reset assistant chat' : 'Clear conversation'}
      </button>
    </aside>

    <section class="chat" aria-label="Conversation">
      <div class="transcript" bind:this={transcript} aria-live="polite">
        {#if messages.length === 0}
          <div class="empty">
            <span class="eyebrow">Real local model · clean channel</span>
            <h2>{false ? 'What are we working on?' : 'Start the story.'}</h2>
            <p>{false ? 'Plan, organize, draft, or analyze with a neutral local assistant. Facts, explicit preferences, and unfinished tasks are updated after every completed turn without claiming external tools or actions.' : 'Talk directly to the local model, or import a SillyTavern-compatible character card from the left.'}</p>
            <div class="starters">
              {#each starters as starter}
                <button on:click={() => chooseStarter(starter)}>{starter}</button>
              {/each}
            </div>
          </div>
        {:else}
          {#each messages as message, messageIndex}
            <article class:assistant={message.role === 'assistant'}>
              <span class="speaker">{message.role === 'user' ? 'You' : false ? 'Assistant' : activeCard?.data.name ?? data.model}</span>
              <div class="content">{message.content}{#if streaming && message === messages.at(-1)}<span class="cursor">▋</span>{/if}</div>
              {#if inlineScenesEnabled && (inlineSceneClips.has(messageIndex) || finalizedInlineSceneSource?.messageIndex === messageIndex)}
                {@const clip = inlineSceneClips.get(messageIndex) ?? null}
                {@const isCurrentTurn = finalizedInlineSceneSource?.messageIndex === messageIndex}
                <figure
                  class:stale={Boolean(clip) && isCurrentTurn && !inlineSceneVideoCurrent}
                  class="scene-card"
                  aria-busy={isCurrentTurn && (inlineSceneBusy || inlineSceneVideoBusy)}
                  style:--scene-ratio={clip ? clip.video.width + ' / ' + clip.video.height : '16 / 9'}
                >
                  <div class="scene-frame">
                    {#if clip && !clip.failed}
                      {#if isCurrentTurn}
                        <video
                          class="scene-motion playback-confirmed"
                          bind:this={inlineSceneVideoElement}
                          src={clip.url}
                          preload="auto"
                          autoplay
                          muted
                          loop
                          controls
                          playsinline
                          on:canplay={handleInlineSceneVideoCanPlay}
                          on:timeupdate={handleInlineSceneVideoTimeUpdate}
                          on:error={() => failInlineSceneClip(messageIndex)}
                          aria-label="Generated scene clip for this response"
                        ></video>
                      {:else}
                        <video
                          class="scene-motion playback-confirmed"
                          src={clip.url}
                          preload="metadata"
                          autoplay
                          muted
                          loop
                          controls
                          playsinline
                          on:error={() => failInlineSceneClip(messageIndex)}
                          aria-label="Generated scene clip for an earlier response"
                        ></video>
                      {/if}
                    {:else}
                      <div
                        class:error-state={Boolean(clip?.failed || (isCurrentTurn && (inlineSceneError || inlineSceneVideoError)))}
                        class="scene-placeholder"
                      >
                        <span>{clip?.failed ? 'Scene clip could not be played' : isCurrentTurn && (inlineSceneError || inlineSceneVideoError) ? 'Scene unavailable' : isCurrentTurn && inlineSceneBusy ? 'Directing and preparing references…' : isCurrentTurn && inlineSceneVideoBusy ? 'Rendering the scene clip…' : 'Waiting for scene generation'}</span>
                      </div>
                    {/if}
                  </div>
                  <figcaption>
                    <span>{clip ? (isCurrentTurn ? 'This response · MiniMax H3 reference clip · silent' : 'Earlier response · MiniMax H3 reference clip · silent') : isCurrentTurn && inlineSceneVideoBusy ? 'Rendering the scene clip from the cast references' : isCurrentTurn && inlineSceneBusy ? 'Gemma sidecar → scene direction and references' : isCurrentTurn && inlineSceneVideoError ? 'Scene clip unavailable' : isCurrentTurn && inlineSceneError ? 'Scene direction unavailable' : 'Scene pending'}</span>
                    {#if clip}<small>{clip.video.width}×{clip.video.height} · {clip.video.request.source.references.length} references · {clip.video.durationSeconds.toFixed(3)} s</small>{/if}
                  </figcaption>
                </figure>
              {/if}
            </article>
          {/each}
        {/if}
      </div>

      <div class="composer-wrap">
        {#if errorMessage}<div class="error" role="alert">{errorMessage}</div>{/if}
        {#if noticeMessage}<div class="notice" role="status">{noticeMessage}</div>{/if}
        <div class="composer">
          <textarea
            bind:value={draft}
            on:keydown={composerKeydown}
            placeholder={false ? 'Ask, plan, or assign something…' : 'Write the next turn…'}
            rows="2"
            disabled={streaming || workspaceBusy || assistantTurnBusy}
            aria-label="Message"
          ></textarea>
          {#if streaming}
            <button class="stop" on:click={stop}>Stop</button>
          {:else}
            <button
              class="send"
              on:click={send}
              disabled={!draft.trim() || workspaceBusy || scenarioLoading || !lorePersistenceReady}
            >Send</button>
          {/if}
        </div>
        <div class="composer-meta">
          <label>
            Response limit
            <input
              type="number"
              min="1"
              max={data.maxTokens}
              step="1"
              bind:value={tokenLimit}
              on:change={persistTokenLimit}
              disabled={streaming || workspaceBusy || assistantTurnBusy}
              aria-label="Maximum response tokens"
            />
            <span>tokens</span>
          </label>
          <small>Enter sends · Shift+Enter adds a line</small>
        </div>
      </div>
    </section>
  </main>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { background: #11100f; color: #eee9df; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  :global(body) { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 70% -20%, #3a3026 0, transparent 38%), #11100f; }
  :global(button), :global(textarea), :global(input), :global(select) { font: inherit; }
  .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
  header { height: 74px; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; border-bottom: 1px solid #39342e; background: rgba(17,16,15,.9); backdrop-filter: blur(14px); }
  .brand { display: flex; align-items: center; gap: 13px; }
  .mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; color: #19130d; background: #e7aa61; font: 800 21px/1 Georgia, serif; box-shadow: 0 0 32px rgba(231,170,97,.18); }
  h1 { font: 700 18px/1.05 Georgia, serif; letter-spacing: .18em; margin: 0; }
  .brand p { margin: 5px 0 0; color: #8f877d; font-size: 11px; }
  .runtime { position: relative; border: 1px solid #3a352f; border-radius: 10px; background: #181614; }
  .runtime summary { display: flex; align-items: center; gap: 9px; padding: 8px 12px; cursor: pointer; list-style: none; }
  .runtime summary::-webkit-details-marker { display: none; }
  .runtime-label { display: grid; }
  .runtime strong { font-size: 12px; font-weight: 650; }
  .runtime small { color: #817a72; font-family: ui-monospace, monospace; font-size: 10px; }
  .runtime-menu { position: absolute; z-index: 20; top: calc(100% + 8px); right: 0; width: 150px; display: grid; gap: 6px; padding: 9px; border: 1px solid #494139; border-radius: 9px; background: #181512; box-shadow: 0 14px 36px rgba(0,0,0,.42); }
  .runtime-menu > span { color: #817970; font-size: 9px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
  .runtime-menu button { padding: 7px 8px; border: 1px solid #494139; border-radius: 7px; color: #a79e94; background: #191613; font-size: 10px; font-weight: 700; cursor: pointer; }
  .runtime-menu button.active { border-color: #6d966f; color: #d9efdc; background: #1a261c; }
  .runtime-menu button:disabled { cursor: default; opacity: .55; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6ebc84; box-shadow: 0 0 10px rgba(110,188,132,.55); }
  .dot.live { background: #e7aa61; animation: pulse 1s infinite alternate; }
  main { min-height: 0; display: grid; grid-template-columns: 270px minmax(0, 1fr); }
  aside { min-height: 0; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 18px; border-right: 1px solid #302c28; background: rgba(15,14,13,.55); }
  aside.assistant-mode > .card-actions,
  aside.assistant-mode > .scenario-picker,
  aside.assistant-mode > .expression-panel,
  aside.assistant-mode > .portrait-panel,
  aside.assistant-mode > .lore-panel,
  aside.assistant-mode > .persona-field { display: none; }
  aside.assistant-mode .portrait { aspect-ratio: 3 / 1; min-height: 96px; }
  .portrait { aspect-ratio: 3 / 4; flex: 0 0 auto; overflow: hidden; display: grid; place-items: center; border: 1px dashed #51493f; border-radius: 16px; color: #71695f; background: linear-gradient(145deg, #24201c, #171513); text-align: center; font-size: 12px; line-height: 1.5; }
  .portrait { position: relative; }
  .portrait.active { border-style: solid; border-color: #5c4b38; }
  .portrait.generated { aspect-ratio: 9 / 16; border-color: #49614d; }
  .portrait img, .portrait video { width: 100%; height: 100%; object-fit: cover; }
  .portrait .portrait-motion { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
  .portrait .portrait-motion.playback-confirmed { opacity: 1; pointer-events: auto; }
  .portrait-status { position: absolute; right: 8px; bottom: 8px; padding: 4px 7px; border: 1px solid rgba(126,184,141,.65); border-radius: 999px; color: #d9efdd; background: rgba(17,29,20,.82); font: 700 9px/1 ui-monospace, monospace; text-transform: capitalize; backdrop-filter: blur(8px); }
  .portrait-status.stale { border-color: rgba(181,135,84,.65); color: #efd0a8; background: rgba(43,31,20,.82); }
  .initial { color: #e7aa61; font: 500 72px/1 Georgia, serif; text-shadow: 0 0 42px rgba(231,170,97,.25); }
  .scenario { padding: 2px 3px; }
  .scenario strong { display: block; margin: 7px 0; font-family: Georgia, serif; font-size: 17px; }
  .scenario p { max-height: 7.75em; overflow-y: auto; margin: 0; color: #968e84; font-size: 12px; line-height: 1.55; }
  .card-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .card-facts span { padding: 4px 7px; border: 1px solid #3d3730; border-radius: 999px; color: #817970; background: #191714; font: 9px/1 ui-monospace, monospace; }
  .assistant-memory-panel { display: grid; gap: 8px; padding: 11px; border: 1px solid #3b463b; border-radius: 10px; background: #171c18; }
  .assistant-memory-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .assistant-memory-heading > div { min-width: 0; display: grid; gap: 3px; }
  .assistant-memory-heading strong { color: #c4d4c5; font-size: 11px; }
  .assistant-memory-heading > small { color: #829184; font: 9px/1 ui-monospace, monospace; }
  .assistant-memory-panel > p { margin: 0; color: #829184; font-size: 9px; line-height: 1.45; }
  .assistant-memory-counts { display: flex; flex-wrap: wrap; gap: 5px; }
  .assistant-memory-counts span { padding: 4px 6px; border: 1px solid #344037; border-radius: 999px; color: #9daf9f; background: #141916; font: 8px/1 ui-monospace, monospace; }
  .assistant-memory-panel details { color: #8f9d91; font-size: 9px; }
  .assistant-memory-panel summary { cursor: pointer; }
  .assistant-memory-panel ul { display: grid; max-height: 14em; overflow-y: auto; gap: 6px; margin: 7px 0 0; padding: 0; list-style: none; }
  .assistant-memory-panel li { display: grid; gap: 2px; padding: 6px; border: 1px solid #344037; border-radius: 7px; background: #141916; }
  .assistant-memory-panel li strong { color: #9daf9f; font: 8px/1.3 ui-monospace, monospace; }
  .assistant-memory-panel li span { color: #c2ccc3; font-size: 9px; line-height: 1.4; overflow-wrap: anywhere; }
  .assistant-memory-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .assistant-memory-actions button { padding: 7px; border: 1px solid #4a4239; border-radius: 7px; color: #a99f95; background: #1b1815; font-size: 9px; font-weight: 700; cursor: pointer; }
  .assistant-memory-actions button:only-child { grid-column: 1 / -1; }
  .assistant-memory-actions button.retry { border-color: #49614d; color: #b6d3ba; background: #19221b; }
  .assistant-memory-actions button:disabled { opacity: .4; cursor: default; }
  .assistant-memory-fired { color: #8b7770; font-size: 8px; line-height: 1.4; }
  .assistant-memory-fired.active { color: #83b28a; }
  .eyebrow { color: #d69d5a; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .file-input { display: none; }
  .card-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  .card-button { padding: 9px 11px; border: 1px solid #4a4239; border-radius: 9px; color: #b7aea4; background: #1b1815; cursor: pointer; }
  .card-button.primary { color: #21170d; border-color: #d49a56; background: #dca35f; font-weight: 750; }
  .card-button:hover:not(:disabled) { border-color: #98714a; color: #fff0df; }
  .card-button.primary:hover:not(:disabled) { color: #21170d; background: #e8b06e; }
  .card-button:disabled { opacity: .35; cursor: default; }
  .scenario-picker { display: grid; gap: 8px; padding: 13px 0 2px; border-top: 1px solid #34302b; }
  .scenario-picker small { color: #7e766e; font-size: 10px; line-height: 1.45; }
  .scenario-select { display: grid; gap: 4px; }
  .scenario-select > span { color: #7e766e; font-size: 9px; }
  .scenario-select select { width: 100%; min-width: 0; padding: 7px 8px; border: 1px solid #443c34; border-radius: 8px; color: #c7b9aa; background: #181512; font-size: 10px; }
  .scenario-select select:disabled { opacity: .45; }
  .scenario-starters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .scenario-starter { min-width: 0; padding: 6px 4px; border: 1px solid #514537; border-radius: 999px; color: #b5a99b; background: #1c1814; font-size: 9px; font-weight: 750; cursor: pointer; }
  .scenario-starter:hover:not(:disabled) { border-color: #d49a56; color: #fff0dc; }
  .scenario-starter.active { border-color: #5d8d65; color: #cbe4cf; background: #18231a; }
  .scenario-starter:disabled { opacity: .4; cursor: default; }
  .expression-panel { display: grid; gap: 9px; padding: 15px 0 2px; border-top: 1px solid #34302b; }
  .expression-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .expression-heading > div { min-width: 0; display: grid; gap: 4px; }
  .expression-heading strong { overflow: hidden; color: #d7d0c7; font-size: 12px; text-overflow: ellipsis; text-transform: capitalize; white-space: nowrap; }
  .expression-meta { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 7px; }
  .expression-meta > small { min-width: 0; flex: 1 1 auto; color: #758c78; font-size: 9px; line-height: 1.4; }
  .expression-meta > small.stale { color: #9b8066; }
  .expression-redetermine { flex: 0 0 auto; width: auto; padding: 3px 6px; border: 1px solid #465348; border-radius: 999px; color: #9fbaa4; background: #171d18; font-size: 8px; font-weight: 700; line-height: 1.2; cursor: pointer; }
  .expression-redetermine:hover:not(:disabled) { border-color: #7db68d; color: #e3f2e5; }
  .expression-redetermine:disabled { opacity: .4; cursor: default; }
  .sidecar-error { padding: 7px 8px; border: 1px solid #6e3c34; border-radius: 7px; color: #e6b9ae; background: #2c1b18; font-size: 9px; line-height: 1.4; }
  .capability-error { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
  .error-retry { flex: 0 0 auto; width: auto; padding: 3px 6px; border: 1px solid #785047; border-radius: 999px; color: #e6b9ae; background: #211714; font-size: 8px; font-weight: 700; cursor: pointer; }
  .error-retry:hover:not(:disabled) { border-color: #b87a6b; color: #ffe6df; }
  .error-retry:disabled { opacity: .4; cursor: default; }
  .playback-fallback { display: flex; align-items: center; justify-content: space-between; gap: 7px; color: #d4a99e; font-size: 9px; line-height: 1.35; }
  .portrait-panel { display: grid; gap: 8px; padding: 15px 0 2px; border-top: 1px solid #34302b; }
  .portrait-heading { display: flex; align-items: end; justify-content: space-between; gap: 8px; }
  .portrait-heading > div { display: grid; gap: 4px; }
  .portrait-heading strong { color: #d7d0c7; font-size: 12px; }
  .portrait-heading > small { color: #758c78; font: 9px/1 ui-monospace, monospace; }
  .portrait-panel label { display: grid; gap: 4px; color: #817970; font-size: 9px; }
  .portrait-panel input, .portrait-panel select { min-width: 0; width: 100%; padding: 6px 7px; border: 1px solid #3c3731; border-radius: 7px; color: #c9c1b7; background: #181512; font-size: 10px; }
  .portrait-panel input:focus, .portrait-panel select:focus { outline: 1px solid #5f8066; border-color: #5f8066; }
  .portrait-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .prompt-guide { color: #69635c; font-size: 8px; line-height: 1.4; }
  .portrait-panel > small { color: #877d72; font-size: 9px; line-height: 1.4; }
  .portrait-panel > button { padding: 8px; border: 1px solid #49614d; border-radius: 8px; color: #b6d3ba; background: #19221b; font-size: 10px; font-weight: 700; cursor: pointer; }
  .portrait-panel > button:hover:not(:disabled) { border-color: #7db68d; color: #e3f2e5; }
  .portrait-panel > button:disabled { opacity: .4; cursor: default; }
  .h3-reference-pack { padding: 7px 8px; border: 1px solid #344037; border-radius: 8px; color: #9daf9f; background: #141916; font-size: 9px; }
  .h3-reference-pack summary { cursor: pointer; font-weight: 700; }
  .h3-reference-pack > small { display: block; margin-top: 7px; color: #829184; line-height: 1.4; }
  .h3-reference-list { display: grid; gap: 6px; margin-top: 8px; }
  .h3-reference-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 6px; border-top: 1px solid #29332b; }
  .h3-reference-row > div:first-child { min-width: 0; display: grid; gap: 2px; }
  .h3-reference-row strong { overflow: hidden; color: #c4d4c5; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .h3-reference-row small { color: #829184; font: 8px/1.35 ui-monospace, monospace; }
  .h3-reference-actions { flex: 0 0 auto; display: flex; gap: 5px; }
  .body-reference-upload span, .body-reference-remove { display: inline-block; width: auto; padding: 4px 6px; border: 1px solid #49614d; border-radius: 999px; color: #b6d3ba; background: #19221b; font: 700 8px/1 sans-serif; cursor: pointer; }
  .body-reference-file-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .body-reference-upload:focus-within span { outline: 2px solid #7db68d; outline-offset: 2px; }
  .body-reference-upload:has(input:disabled) span, .body-reference-remove:disabled { opacity: .4; cursor: default; }
  .body-reference-remove { border-color: #5d4942; color: #c9aaa0; background: #211714; }
  .lore-panel { display: grid; gap: 10px; padding-top: 17px; border-top: 1px solid #34302b; }
  .persona-field { display: grid; gap: 7px; }
  .persona-field textarea { width: 100%; resize: vertical; min-height: 64px; padding: 9px 10px; border: 1px solid #413a33; border-radius: 9px; color: #ded6cc; background: #171513; font-size: 11px; line-height: 1.45; }
  .persona-field textarea:focus { outline: 1px solid #9c7145; border-color: #9c7145; }
  .lore-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .lore-heading > div { display: grid; gap: 4px; }
  .lore-heading strong { color: #d7d0c7; font-size: 12px; }
  .history-panel { display: grid; gap: 7px; padding: 10px; border: 1px solid #3b463b; border-radius: 9px; background: #171c18; }
  .history-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .history-heading > div { min-width: 0; display: grid; gap: 3px; }
  .history-heading strong { overflow: hidden; color: #c4d4c5; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .history-panel > small { color: #829184; font-size: 9px; line-height: 1.4; }
  .history-panel details { color: #8f9d91; font-size: 9px; }
  .history-panel summary { cursor: pointer; }
  .history-panel p { max-height: 12em; overflow-y: auto; margin: 7px 0 0; color: #b9c4ba; line-height: 1.5; white-space: pre-wrap; }
  .quote-bank { display: grid; max-height: 16em; overflow-y: auto; gap: 7px; margin: 7px 0 0; padding-left: 18px; }
  .quote-bank li { color: #b9c4ba; line-height: 1.4; }
  .quote-bank li small { display: block; color: #718174; }
  .quote-bank q { white-space: pre-wrap; }
  .character-state-bank { display: grid; max-height: 24em; overflow-y: auto; gap: 8px; margin-top: 7px; }
  .character-state-bank article { display: grid; gap: 3px; padding: 7px; border: 1px solid #344037; border-radius: 7px; background: #141916; }
  .character-state-bank article > strong { color: #c4d4c5; font-size: 10px; }
  .character-state-bank article p { max-height: none; margin: 0; overflow: visible; font-size: 9px; }
  .character-state-bank article b { color: #829184; font-weight: 700; }
  .character-state-bank article small { color: #657369; font-size: 8px; }
  .history-fired { color: #9b8176 !important; }
  .history-fired.active { color: #83b28a !important; }
  .history-actions { display: grid; grid-template-columns: 1fr auto; gap: 7px; }
  .history-actions button { padding: 7px 9px; border: 1px solid #49614d; border-radius: 7px; color: #b6d3ba; background: #19221b; font-size: 9px; font-weight: 700; cursor: pointer; }
  .history-actions button:last-child { border-color: #4a4239; color: #a99f95; background: #1b1815; }
  .history-actions button:disabled { opacity: .4; cursor: default; }
  .toggle { display: flex; align-items: center; gap: 5px; color: #91887e; font-size: 10px; cursor: pointer; }
  .toggle input, .check-row input { accent-color: #dca35f; }
  .lore-list { display: grid; gap: 6px; }
  .lore-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border: 1px solid #39342e; border-radius: 8px; background: #181614; }
  .lore-row > div { min-width: 0; display: grid; gap: 2px; }
  .lore-row strong { overflow: hidden; color: #c9c1b7; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .lore-row small { color: #746d65; font-size: 9px; }
  .lore-row button { width: 24px; height: 24px; border: 0; border-radius: 6px; color: #9e8e82; background: #29231f; cursor: pointer; }
  .lore-empty { margin: 0; color: #746d65; font-size: 10px; }
  .lore-fired { display: grid; gap: 3px; padding: 8px 9px; border: 1px solid #453b32; border-radius: 8px; color: #92887d; background: #201c18; font-size: 9px; }
  .lore-fired.active { border-color: #49614d; color: #a9c8ad; background: #19221b; }
  .lore-fired span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lore-import { padding: 8px; border: 1px solid #4a4239; border-radius: 8px; color: #b7aea4; background: transparent; font-size: 10px; cursor: pointer; }
  .lore-import:hover:not(:disabled) { border-color: #98714a; color: #f4e7d7; }
  .lore-settings { color: #887f75; font-size: 10px; }
  .lore-settings summary { cursor: pointer; }
  .lore-setting-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 9px 0 7px; }
  .lore-setting-grid label { display: grid; gap: 4px; }
  .lore-setting-grid input, .lore-setting-grid select { width: 100%; padding: 5px 6px; border: 1px solid #3c3731; border-radius: 6px; color: #c1b8ae; background: #181512; font-size: 10px; }
  .check-row { display: flex; align-items: center; gap: 6px; margin: 5px 0; }
  .lore-settings > small { display: block; margin-top: 7px; color: #665f58; }
  .clear { margin-top: auto; padding: 10px; border: 1px solid #3c3731; border-radius: 9px; color: #a9a097; background: transparent; cursor: pointer; }
  .clear:hover:not(:disabled) { border-color: #6a5f53; color: #e8e0d7; }
  .clear:disabled { opacity: .35; cursor: default; }
  .chat { min-width: 0; min-height: 0; display: grid; grid-template-rows: 1fr auto; }
  .transcript { overflow-y: auto; padding: 32px clamp(24px, 7vw, 110px); }
  .empty { max-width: 720px; margin: 12vh auto 0; }
  .empty h2 { margin: 12px 0 8px; font: 500 clamp(34px, 5vw, 64px)/1 Georgia, serif; letter-spacing: -.025em; }
  .empty > p { max-width: 600px; color: #9a9187; line-height: 1.65; }
  .starters { display: grid; gap: 9px; margin-top: 28px; }
  .starters button { padding: 13px 16px; border: 1px solid #3c3731; border-radius: 10px; color: #c8c0b6; background: rgba(28,25,22,.7); text-align: left; cursor: pointer; }
  .starters button:hover { border-color: #a1784c; color: #fff4e6; transform: translateX(2px); }
  article { max-width: 840px; margin: 0 auto 30px; }
  .speaker { display: block; margin-bottom: 8px; color: #c98e4f; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
  article.assistant .speaker { color: #7db68d; }
  .content { color: #e8e2d9; font: 16px/1.72 Georgia, serif; white-space: pre-wrap; overflow-wrap: anywhere; }
  .scene-card { position: relative; overflow: hidden; margin: 18px 0 0; border: 1px solid #435344; border-radius: 13px; background: #171b18; box-shadow: 0 18px 42px rgba(0,0,0,.24); }
  .scene-card.stale { border-color: #6d573d; }
  .scene-card .scene-frame { position: relative; width: 100%; aspect-ratio: var(--scene-ratio, 16 / 9); overflow: hidden; background: linear-gradient(135deg, #25221d, #171918); }
  .scene-card .scene-frame > * { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
  .scene-card .scene-motion { z-index: 1; opacity: 0; pointer-events: none; }
  .scene-card .scene-motion.playback-confirmed { opacity: 1; pointer-events: auto; }
  .scene-motion-controls { display: grid; gap: 7px; margin-top: 4px; padding-top: 10px; border-top: 1px solid #3c3731; }
  .scene-card .scene-frame > .scene-placeholder { display: grid; place-items: center; text-align: center; padding: 0 16px; color: #8ea491; font: 700 10px/1.4 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
  .scene-placeholder:not(.error-state) { background: linear-gradient(110deg, #171918 25%, #263028 45%, #171918 65%); background-size: 240% 100%; animation: scene-shimmer 1.8s linear infinite; }
  .scene-placeholder.error-state { color: #d4a99e; background: #251918; }
  .scene-card figcaption { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; padding: 9px 11px; color: #a8b9aa; background: #171b18; font: 700 9px/1.3 ui-monospace, monospace; }
  .scene-card figcaption small { color: #748276; font-size: 8px; }
  .cursor { color: #e7aa61; animation: pulse .55s infinite alternate; }
  .composer-wrap { padding: 12px clamp(24px, 7vw, 110px) 20px; background: linear-gradient(transparent, #11100f 18%); }
  .composer { max-width: 840px; margin: 0 auto; display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 12px; padding: 12px; border: 1px solid #484139; border-radius: 15px; background: #1b1815; box-shadow: 0 16px 50px rgba(0,0,0,.32); }
  textarea { width: 100%; min-height: 50px; max-height: 180px; resize: vertical; border: 0; outline: 0; padding: 10px; color: #f0e9e0; background: transparent; line-height: 1.45; }
  textarea::placeholder { color: #70685f; }
  .send, .stop { min-width: 74px; height: 42px; border: 0; border-radius: 10px; font-weight: 750; cursor: pointer; }
  .send { color: #1b130b; background: #e7aa61; }
  .send:hover:not(:disabled) { background: #f1b976; }
  .send:disabled { opacity: .35; cursor: default; }
  .stop { color: #f0ddd5; background: #7b4036; }
  .composer-meta { max-width: 840px; margin: 7px auto 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #686159; font-size: 10px; }
  .composer-meta label { display: flex; align-items: center; gap: 7px; }
  .composer-meta input { width: 82px; padding: 4px 7px; border: 1px solid #3c3731; border-radius: 7px; color: #bdb4aa; background: #191613; font-size: 10px; }
  .error { max-width: 840px; margin: 0 auto 8px; padding: 9px 12px; border: 1px solid #7b4036; border-radius: 9px; color: #f0c8bd; background: #321d19; font-size: 12px; white-space: pre-wrap; }
  .notice { max-width: 840px; margin: 0 auto 8px; padding: 9px 12px; border: 1px solid #5f513d; border-radius: 9px; color: #e9c995; background: #2d251a; font-size: 12px; }
  @keyframes pulse { to { opacity: .35; } }
  @keyframes scene-shimmer { to { background-position: -240% 0; } }
  @media (max-width: 760px) {
    header { height: 66px; padding: 0 14px; }
    .brand p { display: none; }
    .runtime strong { max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
    main { grid-template-columns: 1fr; }
    aside { display: none; }
    .transcript { padding: 24px 18px; }
    .composer-wrap { padding: 10px 12px 14px; }
    .empty { margin-top: 8vh; }
  }
</style>
