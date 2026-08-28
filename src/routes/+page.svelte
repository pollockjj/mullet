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
    LIVING_HISTORY_INTERVAL_MESSAGES,
    LIVING_HISTORY_TIMEOUT_MS,
    livingHistoryLorebook,
    livingHistoryRequestKey,
    livingHistoryResultAppliesToMessages,
    livingHistoryResultMatchesMessages,
    livingHistoryResultMatchesRequest,
    livingHistorySourceForMessages,
    livingHistorySourceMatchesMessages,
    livingHistorySourcesMatch,
    normalizeLivingHistorySource,
    normalizeLivingHistoryResult,
    type LivingHistoryRequest,
    type LivingHistoryResult,
    type LivingHistorySource
  } from '$lib/living-history';
  import {
    INLINE_SCENE_IMAGE_TIMEOUT_MS,
    INLINE_SCENE_TIMEOUT_MS,
    buildInlineSceneImageRequest,
    buildInlineSceneRequest,
    inlineSceneImageRequestKey,
    inlineSceneResultMatchesRequest,
    normalizeInlineSceneCapabilities,
    normalizeInlineSceneResult,
    type InlineSceneAspectRatio,
    type InlineSceneCapabilities,
    type InlineSceneImageRequest,
    type InlineSceneMegapixels,
    type InlineSceneRequest,
    type InlineSceneResult
  } from '$lib/inline-scene';
  import {
    STORED_INLINE_SCENE_SPEC,
    clearStoredInlineScene,
    commitStoredInlineScene,
    loadStoredInlineScene,
    normalizeStoredInlineScene,
    restoreStoredInlineScene,
    rollbackStoredInlineSceneWrite,
    runStoredInlineSceneExclusive,
    saveStoredInlineScene,
    type StoredInlineScene
  } from '$lib/inline-scene-storage';
  import {
    MAX_SUPPLEMENTAL_LOREBOOKS,
    appendLivingHistoryBoundary,
    assembleSupplementalLorebooks,
    authoritativeLivingHistoryEpoch,
    currentLivingHistoryRequest,
    livingHistoryAutomaticUpdateDue,
    livingHistoryReadyForChat,
    normalizeStoredLivingHistoryBoundaries,
    pendingLivingHistoryMessageCount
  } from '$lib/living-history-client';
  import {
    clearLivingHistoryAtEpoch,
    clearStoredLivingHistory,
    commitLivingHistoryResult,
    loadStoredLivingHistory,
    restoreLivingHistoryResult,
    rollbackStoredLivingHistoryWrite,
    runStoredLivingHistoryExclusive,
    saveStoredLivingHistory
  } from '$lib/living-history-storage';
  import {
    PORTRAIT_TIMEOUT_MS,
    buildPortraitRequest,
    normalizePortraitCapabilities,
    portraitRequestKey,
    type PortraitAspectRatio,
    type PortraitCapabilities,
    type PortraitMegapixels,
    type PortraitRequest
  } from '$lib/portrait';
  import {
    STORED_PORTRAIT_SPEC,
    clearStoredPortraitIfPromptId,
    commitStoredPortrait,
    clearStoredPortrait,
    loadStoredPortrait,
    normalizeStoredPortrait,
    saveStoredPortrait,
    type StoredPortrait
  } from '$lib/portrait-storage';
  import {
    PORTRAIT_VIDEO_TIMEOUT_MS,
    buildPortraitVideoRequest,
    normalizePortraitVideoCapabilities,
    portraitVideoRequestKey,
    type PortraitVideoCapabilities,
    type PortraitVideoRequest
  } from '$lib/portrait-video';
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
    buildExpressionSidecarRequest,
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
  import { loadStoredSidecarState, saveStoredSidecarState } from '$lib/sidecar-storage';
  import { serializeChatRequest } from '$lib/chat-request-size';
  import { assertFinalizedChatStream, parseChatStreamPayload } from '$lib/chat-stream';
  import {
    isScenarioCard,
    normalizeScenarioCatalog,
    validateScenarioPackage,
    type ScenarioCatalog,
    type ScenarioCatalogEntry
  } from '$lib/scenario';
  import type { PageData } from './$types';

  type Role = 'user' | 'assistant';
  type Message = { role: Role; content: string };

  export let data: PageData;

  let messages: Message[] = [];
  let draft = '';
  let streaming = false;
  let errorMessage = '';
  let noticeMessage = '';
  let tokenLimit = data.defaultMaxTokens;
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
  let portraitSubject = 'the central character in the current scene';
  let portraitSetting = '';
  let portraitAttire = '';
  let portraitLora = '';
  let portraitAspectRatio: PortraitAspectRatio = '2:3';
  let portraitMegapixels: PortraitMegapixels = 0.9;
  let portraitRequest: PortraitRequest | null = null;
  let portraitCurrent = false;
  let lastPortraitAttemptKey = '';
  let portraitController: AbortController | null = null;
  let portraitMotionEnabled = false;
  let generatedPortraitVideoUrl = '';
  let generatedPortraitVideo: StoredPortraitVideo | null = null;
  let portraitVideoCapabilities: PortraitVideoCapabilities | null = null;
  let portraitVideoCapabilitiesLoading = false;
  let portraitVideoPersistenceReady = false;
  let portraitVideoPersistenceAvailable = true;
  let portraitVideoPersistenceOperations = 0;
  let portraitVideoBusy = false;
  let portraitVideoError = '';
  let portraitVideoRequest: PortraitVideoRequest | null = null;
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
  let livingHistoryEnabled = false;
  let livingHistoryResult: LivingHistoryResult | null = null;
  let livingHistoryBook: ImportedLorebook | null = null;
  let livingHistoryApplicable = false;
  let livingHistoryCurrent = false;
  let livingHistoryRequest: LivingHistoryRequest | null = null;
  let livingHistoryBoundaries: LivingHistorySource[] = [];
  let livingHistoryPendingMessages = 0;
  let livingHistoryPersistenceReady = false;
  let livingHistoryPersistenceAvailable = true;
  let livingHistoryBusy = false;
  let livingHistoryError = '';
  let lastLivingHistoryAttemptKey = '';
  let livingHistoryController: AbortController | null = null;
  let livingHistoryGeneration = 0;
  let livingHistoryEpoch = '';
  let inlineScenesEnabled = false;
  let finalizedInlineSceneSource: LivingHistorySource | null = null;
  let inlineSceneEpoch = '';
  let inlineSceneCapabilities: InlineSceneCapabilities | null = null;
  let inlineSceneCapabilitiesLoading = false;
  let inlineScenePersistenceReady = false;
  let inlineScenePersistenceAvailable = true;
  let inlineScenePersistenceOperations = 0;
  let inlineSceneBusy = false;
  let inlineSceneError = '';
  let inlineSceneAspectRatio: InlineSceneAspectRatio = '16:9';
  let inlineSceneMegapixels: InlineSceneMegapixels = 1;
  let inlineSceneLora = '';
  let inlineSceneSidecarRequest: InlineSceneRequest | null = null;
  let generatedInlineScene: StoredInlineScene | null = null;
  let generatedInlineSceneUrl = '';
  let inlineSceneApplies = false;
  let inlineSceneCurrent = false;
  let inlineSceneGeneration = 0;
  let inlineSceneController: AbortController | null = null;
  let lastInlineSceneAttemptKey = '';
  let personaDescription = '';
  let scenarioCatalog: ScenarioCatalog | null = null;
  let selectedScenarioId = '';
  let selectedScenario: ScenarioCatalogEntry | null = null;
  let scenarioLoading = false;
  let conversationId = '';
  let expressionsEnabled = false;
  let sidecarState: SidecarState | null = null;
  let expressionSnapshot: ExpressionSidecarRequest | null = null;
  let expressionResult: ExpressionSidecarResult | null = null;
  let expressionCurrent = false;
  let sidecarPersistenceReady = false;
  let sidecarPersistenceAvailable = true;
  let sidecarBusy = false;
  let sidecarError = '';
  let lastExpressionAttemptKey = '';
  let sidecarController: AbortController | null = null;
  let controller: AbortController | null = null;
  let transcript: HTMLDivElement;
  let cardInput: HTMLInputElement;
  let loreInput: HTMLInputElement;

  const messagesStorageKey = 'mullet.checkpoint-one.messages';
  const cardStorageKey = 'mullet.active-character-card';
  const portraitStorageKey = 'mullet.active-character-portrait';
  const cardSourceIdentifierStorageKey = 'mullet.active-character-source';
  const lorebookStorageKey = 'mullet.active-lorebook';
  const loreEnabledStorageKey = 'mullet.lorebook-enabled';
  const loreSettingsStorageKey = 'mullet.lorebook-settings';
  const personaDescriptionStorageKey = 'mullet.persona-description';
  const loreTimedStateStorageKey = 'mullet.lore-timed-state';
  const livingHistoryEnabledStorageKey = 'mullet.living-history-enabled';
  const livingHistoryBoundariesStorageKey = 'mullet.living-history-finalized-boundaries';
  const livingHistoryEpochStorageKey = 'mullet.living-history-epoch';
  const conversationIdStorageKey = 'mullet.conversation-id';
  const expressionsEnabledStorageKey = 'mullet.expressions-enabled';
  const portraitSubjectStorageKey = 'mullet.portrait-subject';
  const portraitSettingStorageKey = 'mullet.portrait-setting';
  const portraitAttireStorageKey = 'mullet.portrait-attire';
  const portraitLoraStorageKey = 'mullet.portrait-lora';
  const portraitAspectStorageKey = 'mullet.portrait-aspect';
  const portraitMegapixelsStorageKey = 'mullet.portrait-megapixels';
  const portraitMotionEnabledStorageKey = 'mullet.portrait-motion-enabled';
  const inlineScenesEnabledStorageKey = 'mullet.inline-scenes-enabled';
  const inlineSceneFinalizedStorageKey = 'mullet.inline-scene-finalized';
  const inlineSceneAspectStorageKey = 'mullet.inline-scene-aspect';
  const inlineSceneMegapixelsStorageKey = 'mullet.inline-scene-megapixels';
  const inlineSceneLoraStorageKey = 'mullet.inline-scene-lora';
  const maxActiveLorebookBytes = 24 * 1024 * 1024;

  $: livingHistoryApplicable = Boolean(
    livingHistoryResult
    && livingHistoryResultAppliesToMessages(livingHistoryResult, conversationId, messages)
  );
  $: livingHistoryCurrent = Boolean(
    livingHistoryResult
    && livingHistoryResultMatchesMessages(livingHistoryResult, conversationId, messages)
  );
  $: livingHistoryRequest = currentLivingHistoryRequest(
    conversationId,
    messages,
    livingHistoryResult,
    livingHistoryBoundaries
  );
  $: livingHistoryPendingMessages = livingHistoryRequest?.turns.length
    ?? pendingLivingHistoryMessageCount(livingHistoryBoundaries, livingHistoryResult);
  $: livingHistoryBook = livingHistoryEnabled && livingHistoryResult && livingHistoryApplicable
    ? livingHistoryLorebook(livingHistoryResult)
    : null;
  $: activeLorebooks = [
    ...combineLorebooks(embeddedLorebook, importedLorebooks, isScenarioCard(activeCard)),
    ...(livingHistoryBook ? [livingHistoryBook] : [])
  ];
  $: selectedScenario = scenarioCatalog?.scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;
  $: expressionSnapshot = currentExpressionSnapshot(conversationId, messages);
  $: expressionResult = sidecarState?.channels.expression ?? null;
  $: expressionCurrent = Boolean(expressionResult && expressionSnapshot && expressionResultMatchesRequest(expressionResult, expressionSnapshot));
  $: portraitRequest = currentPortraitRequest(
    expressionResult,
    expressionCurrent,
    portraitSubject,
    portraitSetting,
    portraitAttire,
    portraitLora,
    portraitAspectRatio,
    portraitMegapixels
  );
  $: portraitCurrent = Boolean(generatedPortrait && portraitRequest && generatedPortrait.requestKey === portraitRequestKey(portraitRequest));
  $: portraitVideoRequest = currentPortraitVideoRequest(
    generatedPortrait,
    portraitCurrent,
    portraitImageDigestPromptId,
    portraitImageSha256,
    portraitAspectRatio
  );
  $: portraitVideoCurrent = Boolean(
    generatedPortraitVideo
    && portraitVideoRequest
    && generatedPortraitVideo.requestKey === portraitVideoRequestKey(portraitVideoRequest)
  );
  $: inlineSceneSidecarRequest = currentInlineSceneSidecarRequest(
    conversationId,
    messages,
    finalizedInlineSceneSource
  );
  $: inlineSceneApplies = inlineSceneAppliesToTranscript(
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
    inlineSceneLora
  );
  $: scheduleExpressionReconciliation(
    expressionsEnabled,
    sidecarPersistenceReady,
    sidecarPersistenceAvailable,
    streaming,
    sidecarBusy,
    expressionSnapshot,
    expressionCurrent
  );
  $: schedulePortraitReconciliation(
    expressionsEnabled,
    portraitCapabilities,
    portraitPersistenceReady,
    portraitPersistenceAvailable,
    portraitBusy,
    portraitRequest,
    portraitCurrent
  );
  $: schedulePortraitVideoReconciliation(
    expressionsEnabled,
    portraitMotionEnabled,
    portraitVideoCapabilities,
    portraitVideoPersistenceReady,
    portraitVideoPersistenceAvailable,
    portraitBusy,
    portraitVideoBusy,
    portraitVideoRequest,
    portraitVideoCurrent
  );
  $: scheduleInlineSceneReconciliation(
    inlineScenesEnabled,
    inlineSceneCapabilities,
    inlineScenePersistenceReady,
    inlineScenePersistenceAvailable,
    streaming,
    inlineSceneBusy,
    inlineSceneSidecarRequest,
    inlineSceneCurrent,
    inlineSceneAspectRatio,
    inlineSceneMegapixels,
    inlineSceneLora
  );
  $: scheduleLivingHistoryReconciliation(
    livingHistoryEnabled,
    livingHistoryPersistenceReady,
    livingHistoryPersistenceAvailable,
    streaming,
    livingHistoryBusy,
    livingHistoryRequest,
    livingHistoryPendingMessages
  );

  const starters = [
    'Write the opening beat of a tense science-fiction scene.',
    'Help me develop a character with a dangerous secret.',
    'Continue a conversation aboard a damaged starship.'
  ];

  onMount(() => {
    const savedMessages = localStorage.getItem(messagesStorageKey);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        localStorage.removeItem(messagesStorageKey);
      }
    }

    const savedCard = localStorage.getItem(cardStorageKey);
    if (savedCard) {
      try {
        activeCard = normalizeCharacterCard(JSON.parse(savedCard));
        cardSourceIdentifier = characterSourceIdentifier(localStorage.getItem(cardSourceIdentifierStorageKey) ?? '');
        portraitDataUrl = localStorage.getItem(portraitStorageKey) ?? '';
        embeddedLorebook = embeddedLoreFromCard(activeCard);
        if (messages.length === 0) messages = freshConversation();
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

    const savedTokenLimit = Number(localStorage.getItem('mullet.response-token-limit'));
    if (Number.isInteger(savedTokenLimit) && savedTokenLimit >= 1 && savedTokenLimit <= data.maxTokens) {
      tokenLimit = savedTokenLimit;
    }
    const savedConversationId = localStorage.getItem(conversationIdStorageKey);
    conversationId = isSidecarConversationId(savedConversationId) ? savedConversationId : crypto.randomUUID();
    localStorage.setItem(conversationIdStorageKey, conversationId);
    const savedLivingHistoryEpoch = localStorage.getItem(livingHistoryEpochStorageKey);
    const allowLegacyLivingHistory = !isSidecarConversationId(savedLivingHistoryEpoch);
    livingHistoryEpoch = allowLegacyLivingHistory ? crypto.randomUUID() : savedLivingHistoryEpoch;
    localStorage.setItem(livingHistoryEpochStorageKey, livingHistoryEpoch);
    window.addEventListener('storage', handleLivingHistoryEpochChange);
    livingHistoryEnabled = localStorage.getItem(livingHistoryEnabledStorageKey) === 'true';
    restoreLivingHistoryBoundaries();
    void restoreLivingHistory(allowLegacyLivingHistory);
    sidecarState = emptySidecarState(conversationId);
    expressionsEnabled = localStorage.getItem(expressionsEnabledStorageKey) === 'true';
    portraitMotionEnabled = localStorage.getItem(portraitMotionEnabledStorageKey) === 'true';
    inlineScenesEnabled = localStorage.getItem(inlineScenesEnabledStorageKey) === 'true';
    restorePortraitSettings();
    restoreInlineSceneSettings();
    restoreInlineSceneFinalizedSource();
    void restoreExpressionAndGeneratedMedia();
    void restoreGeneratedInlineScene();
    void loadPortraitGenerator();
    void loadPortraitVideoGenerator();
    void loadInlineSceneGenerator();
    void loadScenarioCatalog();
  });

  onDestroy(() => {
    if (browser) window.removeEventListener('storage', handleLivingHistoryEpochChange);
    livingHistoryController?.abort();
    portraitController?.abort();
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    if (generatedPortraitUrl) URL.revokeObjectURL(generatedPortraitUrl);
    if (generatedPortraitVideoUrl) URL.revokeObjectURL(generatedPortraitVideoUrl);
    if (generatedInlineSceneUrl) URL.revokeObjectURL(generatedInlineSceneUrl);
  });

  function restorePortraitSettings() {
    portraitSubject = localStorage.getItem(portraitSubjectStorageKey)?.trim()
      || (activeCard && !isScenarioCard(activeCard) ? activeCard.data.name : 'the central character in the current scene');
    portraitSetting = localStorage.getItem(portraitSettingStorageKey) ?? '';
    portraitAttire = localStorage.getItem(portraitAttireStorageKey) ?? '';
    portraitLora = localStorage.getItem(portraitLoraStorageKey) ?? '';
    const savedAspect = localStorage.getItem(portraitAspectStorageKey);
    if (savedAspect === '2:3' || savedAspect === '3:4' || savedAspect === '4:5' || savedAspect === '9:16') {
      portraitAspectRatio = savedAspect;
    }
    const savedMegapixels = Number(localStorage.getItem(portraitMegapixelsStorageKey));
    if (savedMegapixels === 0.5 || savedMegapixels === 0.75 || savedMegapixels === 0.9 || savedMegapixels === 1 || savedMegapixels === 1.5 || savedMegapixels === 2) {
      portraitMegapixels = savedMegapixels;
    }
  }

  function persistPortraitSettings() {
    localStorage.setItem(portraitSubjectStorageKey, portraitSubject.trim());
    localStorage.setItem(portraitSettingStorageKey, portraitSetting.trim());
    localStorage.setItem(portraitAttireStorageKey, portraitAttire.trim());
    if (portraitLora) localStorage.setItem(portraitLoraStorageKey, portraitLora);
    else localStorage.removeItem(portraitLoraStorageKey);
    localStorage.setItem(portraitAspectStorageKey, portraitAspectRatio);
    localStorage.setItem(portraitMegapixelsStorageKey, String(portraitMegapixels));
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
    inlineSceneLora = localStorage.getItem(inlineSceneLoraStorageKey) ?? '';
  }

  function persistInlineSceneSettings() {
    localStorage.setItem(inlineSceneAspectStorageKey, inlineSceneAspectRatio);
    localStorage.setItem(inlineSceneMegapixelsStorageKey, String(inlineSceneMegapixels));
    if (inlineSceneLora) localStorage.setItem(inlineSceneLoraStorageKey, inlineSceneLora);
    else localStorage.removeItem(inlineSceneLoraStorageKey);
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    inlineSceneError = '';
    lastInlineSceneAttemptKey = '';
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
      const source = normalizeLivingHistorySource(parsed.source);
      if (source.conversationId !== conversationId || !livingHistorySourceMatchesMessages(source, conversationId, messages)) {
        throw new Error('inline-scene finalized source does not match this transcript');
      }
      inlineSceneEpoch = parsed.epoch;
      finalizedInlineSceneSource = source;
    } catch {
      inlineSceneEpoch = '';
      finalizedInlineSceneSource = null;
      localStorage.removeItem(inlineSceneFinalizedStorageKey);
    }
  }

  function currentInlineSceneSidecarRequest(
    currentConversationId: string,
    currentMessages: readonly Message[],
    source: LivingHistorySource | null
  ): InlineSceneRequest | null {
    if (!source) return null;
    try {
      return buildInlineSceneRequest(currentConversationId, currentMessages, source);
    } catch {
      return null;
    }
  }

  function inlineSceneAppliesToTranscript(
    scene: StoredInlineScene | null,
    source: LivingHistorySource | null,
    epoch: string,
    currentConversationId: string,
    currentMessages: readonly Message[]
  ): boolean {
    return Boolean(
      scene
      && source
      && scene.epoch === epoch
      && scene.conversationId === currentConversationId
      && livingHistorySourcesMatch(scene.request.source, source)
      && livingHistorySourceMatchesMessages(scene.request.source, currentConversationId, currentMessages)
    );
  }

  function inlineSceneMatchesSettings(
    scene: StoredInlineScene | null,
    aspectRatio: InlineSceneAspectRatio,
    megapixels: InlineSceneMegapixels,
    lora: string
  ): boolean {
    return Boolean(
      scene
      && scene.request.aspectRatio === aspectRatio
      && scene.request.megapixels === megapixels
      && scene.request.lora === (lora || null)
    );
  }

  function removeInstalledInlineScene() {
    if (generatedInlineSceneUrl) URL.revokeObjectURL(generatedInlineSceneUrl);
    generatedInlineSceneUrl = '';
    generatedInlineScene = null;
  }

  function installGeneratedInlineScene(scene: StoredInlineScene) {
    removeInstalledInlineScene();
    generatedInlineScene = scene;
    generatedInlineSceneUrl = URL.createObjectURL(scene.image);
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
        isCurrent: () => generation === inlineSceneGeneration
          && epoch === inlineSceneEpoch
          && Boolean(source && finalizedInlineSceneSource && livingHistorySourcesMatch(source, finalizedInlineSceneSource))
          && inlineSceneStoredEpochIsCurrent(epoch),
        accepts: (scene) => scene.epoch === epoch
          && scene.conversationId === conversationId
          && Boolean(source && livingHistorySourcesMatch(scene.request.source, source))
          && livingHistorySourceMatchesMessages(scene.request.source, conversationId, messages),
        install: installGeneratedInlineScene
      });
    } catch (cause) {
      try {
        await runStoredInlineSceneExclusive(clearStoredInlineScene);
        inlineSceneError = cause instanceof Error ? cause.message : 'Stored inline-scene integrity verification failed.';
      } catch (clearCause) {
        disableInlineScenePersistence(clearCause);
      }
    } finally {
      endInlineScenePersistenceOperation();
    }
  }

  async function loadInlineSceneGenerator() {
    if (inlineSceneCapabilitiesLoading) return;
    inlineSceneCapabilitiesLoading = true;
    inlineSceneError = '';
    try {
      const response = await fetch(`${base}/api/scene`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : `Inline-scene generator failed (${response.status}).`;
        throw new Error(detail);
      }
      inlineSceneCapabilities = normalizeInlineSceneCapabilities(payload);
      if (inlineSceneLora && !inlineSceneCapabilities.loras.some((lora) => lora.path === inlineSceneLora)) {
        inlineSceneLora = '';
        localStorage.removeItem(inlineSceneLoraStorageKey);
      }
    } catch (cause) {
      inlineSceneCapabilities = null;
      inlineSceneError = cause instanceof Error ? cause.message : 'Inline-scene generator is unavailable.';
    } finally {
      inlineSceneCapabilitiesLoading = false;
    }
  }

  function inlineSceneAttemptKey(
    request: InlineSceneRequest,
    aspectRatio: InlineSceneAspectRatio,
    megapixels: InlineSceneMegapixels,
    lora: string
  ): string {
    return [
      request.source.conversationId,
      request.source.messageCount,
      request.source.fingerprint,
      request.source.turnFingerprint,
      aspectRatio,
      megapixels,
      lora
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
    lora: string
  ) {
    if (!enabled || !capabilities || !persistenceReady || !persistenceAvailable || isStreaming || busy || !request || current) return;
    const key = inlineSceneAttemptKey(request, aspectRatio, megapixels, lora);
    if (key === lastInlineSceneAttemptKey) return;
    lastInlineSceneAttemptKey = key;
    void generateInlineScene(request, aspectRatio, megapixels, lora);
  }

  function inlineSceneGenerationIsCurrent(
    generation: number,
    epoch: string,
    sidecarRequest: InlineSceneRequest,
    result: InlineSceneResult | null,
    imageRequestKey: string,
    signal: AbortSignal
  ): boolean {
    if (
      signal.aborted
      || generation !== inlineSceneGeneration
      || epoch !== inlineSceneEpoch
      || !inlineScenesEnabled
      || !inlineSceneStoredEpochIsCurrent(epoch)
    ) return false;
    const liveSidecar = currentInlineSceneSidecarRequest(conversationId, messages, finalizedInlineSceneSource);
    if (!liveSidecar || !livingHistorySourcesMatch(liveSidecar.source, sidecarRequest.source)) return false;
    if (!result) return true;
    try {
      const liveImageRequest = buildInlineSceneImageRequest(result, {
        lora: inlineSceneLora || null,
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
    selectedLora: string = inlineSceneLora
  ) {
    if (
      !selectedSidecarRequest
      || !inlineScenesEnabled
      || !inlineSceneCapabilities
      || inlineSceneBusy
      || !inlineScenePersistenceReady
      || !inlineScenePersistenceAvailable
    ) return;
    const generation = inlineSceneGeneration;
    const epoch = inlineSceneEpoch;
    lastInlineSceneAttemptKey = inlineSceneAttemptKey(selectedSidecarRequest, selectedAspectRatio, selectedMegapixels, selectedLora);
    inlineSceneBusy = true;
    inlineSceneError = '';
    const activeController = new AbortController();
    inlineSceneController = activeController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, INLINE_SCENE_TIMEOUT_MS + INLINE_SCENE_IMAGE_TIMEOUT_MS + 10_000);
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
      const imageRequest = buildInlineSceneImageRequest(result, {
        lora: selectedLora || null,
        aspectRatio: selectedAspectRatio,
        megapixels: selectedMegapixels
      });
      const requestKey = inlineSceneImageRequestKey(imageRequest);
      if (!inlineSceneGenerationIsCurrent(generation, epoch, selectedSidecarRequest, result, requestKey, activeController.signal)) return;
      const imageResponse = await fetch(`${base}/api/scene`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(imageRequest),
        signal: activeController.signal
      });
      if (!imageResponse.ok) {
        const payload = await imageResponse.json().catch(() => null);
        const detail = payload && typeof payload.message === 'string'
          ? payload.message
          : `Inline scene failed (${imageResponse.status}).`;
        throw new Error(detail);
      }
      const image = await imageResponse.blob();
      if (image.type !== 'image/png' || image.size < 24) throw new Error('Inline-scene generator returned an invalid image.');
      const modelTemplate = imageResponse.headers.get('x-mullet-model-template') ?? '';
      if (modelTemplate !== imageRequest.modelTemplate) throw new Error('Inline-scene response model does not match its request.');
      const imageSha256 = inlineSceneResponseHash(imageResponse);
      if (await blobSha256(image) !== imageSha256) throw new Error('Inline-scene response hash does not match its image.');
      const stored = normalizeStoredInlineScene({
        spec: STORED_INLINE_SCENE_SPEC,
        conversationId: imageRequest.source.conversationId,
        epoch,
        requestKey,
        request: imageRequest,
        modelTemplate,
        promptId: imageResponse.headers.get('x-mullet-prompt-id') ?? '',
        seed: responseHeaderInteger(imageResponse, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
        width: responseHeaderInteger(imageResponse, 'x-mullet-width', 16, 2048),
        height: responseHeaderInteger(imageResponse, 'x-mullet-height', 16, 2048),
        generatedAt: Date.now(),
        imageSha256,
        image
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
          activeController.signal
        ),
        install: installGeneratedInlineScene
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) inlineSceneError = `Inline scene timed out after ${(INLINE_SCENE_TIMEOUT_MS + INLINE_SCENE_IMAGE_TIMEOUT_MS + 10_000) / 1000} seconds.`;
      } else {
        inlineSceneError = cause instanceof Error ? cause.message : 'Inline scene failed.';
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
    if (!inlineScenesEnabled) {
      inlineSceneGeneration += 1;
      inlineSceneController?.abort();
      inlineSceneController = null;
      inlineSceneBusy = false;
    }
  }

  function publishFinalizedInlineSceneSource() {
    const source = livingHistorySourceForMessages(conversationId, messages);
    const epoch = crypto.randomUUID();
    inlineSceneGeneration += 1;
    inlineSceneController?.abort();
    inlineSceneController = null;
    inlineSceneBusy = false;
    inlineSceneError = '';
    lastInlineSceneAttemptKey = '';
    removeInstalledInlineScene();
    finalizedInlineSceneSource = source;
    inlineSceneEpoch = epoch;
    localStorage.setItem(inlineSceneFinalizedStorageKey, JSON.stringify({ epoch, source }));
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
    removeInstalledInlineScene();
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
      if (portraitLora && !portraitCapabilities.loras.includes(portraitLora)) {
        portraitLora = '';
        localStorage.removeItem(portraitLoraStorageKey);
      }
    } catch (cause) {
      portraitCapabilities = null;
      portraitError = cause instanceof Error ? cause.message : 'Portrait generator is unavailable.';
    } finally {
      portraitCapabilitiesLoading = false;
    }
  }

  function installGeneratedPortrait(portrait: StoredPortrait, preserveStoredMotion = false): Promise<void> {
    const generation = beginPortraitVideoSourceChange(preserveStoredMotion);
    if (generatedPortraitUrl) URL.revokeObjectURL(generatedPortraitUrl);
    generatedPortrait = portrait;
    generatedPortraitUrl = URL.createObjectURL(portrait.image);
    return refreshPortraitImageDigest(portrait, generation);
  }

  async function restoreGeneratedPortrait() {
    try {
      const stored = await loadStoredPortrait();
      if (stored) {
        const normalized = normalizeStoredPortrait(stored);
        if (normalized.conversationId === conversationId) await installGeneratedPortrait(normalized, true);
        else await clearStoredPortrait();
      }
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

  function removeInstalledPortraitVideo() {
    if (generatedPortraitVideoUrl) URL.revokeObjectURL(generatedPortraitVideoUrl);
    generatedPortraitVideoUrl = '';
    generatedPortraitVideo = null;
  }

  function installGeneratedPortraitVideo(video: StoredPortraitVideo) {
    removeInstalledPortraitVideo();
    generatedPortraitVideo = video;
    generatedPortraitVideoUrl = URL.createObjectURL(video.video);
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
    if (!preserveStoredMotion && portraitVideoPersistenceAvailable) clearStoredPortraitVideoLocked(portraitVideoGeneration);
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
    aspectRatio: PortraitAspectRatio
  ): PortraitVideoRequest | null {
    if (!portrait || !staticCurrent || digestPromptId !== portrait.promptId || !imageSha256) return null;
    try {
      return buildPortraitVideoRequest(portrait, aspectRatio, imageSha256);
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
      portraitAspectRatio
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
      portraitAspectRatio
    );
    const restoredKey = restoredRequest ? portraitVideoRequestKey(restoredRequest) : '';
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
            portraitAspectRatio
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
      const signature = new Uint8Array(await video.video.slice(0, 4).arrayBuffer());
      if (
        signature[0] !== 0x1a
        || signature[1] !== 0x45
        || signature[2] !== 0xdf
        || signature[3] !== 0xa3
        || await blobSha256(video.video) !== video.videoSha256
      ) throw new Error('stored portrait motion bytes are invalid');
      return video;
    } catch {
      await clearStoredPortraitVideo();
      portraitVideoError = 'Stored portrait motion was invalid and was discarded.';
      return null;
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
    } catch (cause) {
      portraitVideoCapabilities = null;
      portraitVideoError = cause instanceof Error ? cause.message : 'Portrait-motion generator is unavailable.';
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
    current: boolean
  ) {
    if (
      !expressionsOn
      || !enabled
      || !capabilities
      || !persistenceReady
      || !persistenceAvailable
      || staticBusy
      || busy
      || !request
      || current
    ) return;
    const key = portraitVideoRequestKey(request);
    if (key === lastPortraitVideoAttemptKey) return;
    lastPortraitVideoAttemptKey = key;
    void generatePortraitVideo(request);
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
      if (video.type !== 'video/webm' || video.size < 4) throw new Error('Portrait-motion generator returned an invalid video.');
      const videoBytes = new Uint8Array(await video.arrayBuffer());
      if (
        videoBytes[0] !== 0x1a
        || videoBytes[1] !== 0x45
        || videoBytes[2] !== 0xdf
        || videoBytes[3] !== 0xa3
      ) throw new Error('Portrait-motion generator returned an invalid WebM signature.');
      const modelTemplate = response.headers.get('x-mullet-model-template') ?? '';
      const inputImageSha256 = responseHeaderSha256(response, 'x-mullet-input-sha256');
      if (modelTemplate !== selectedRequest.modelTemplate || inputImageSha256 !== selectedRequest.source.portraitImageSha256) {
        throw new Error('Portrait-motion response provenance does not match its request.');
      }
      const videoSha256 = responseHeaderSha256(response, 'x-mullet-video-sha256');
      if (await blobSha256(video) !== videoSha256) throw new Error('Portrait-motion response hash does not match its video.');
      const stored = normalizeStoredPortraitVideo({
        spec: STORED_PORTRAIT_VIDEO_SPEC,
        conversationId: selectedRequest.source.conversationId,
        requestKey: key,
        request: selectedRequest,
        modelTemplate,
        promptId: response.headers.get('x-mullet-prompt-id') ?? '',
        seed: responseHeaderInteger(response, 'x-mullet-seed', 0, Number.MAX_SAFE_INTEGER),
        width: responseHeaderInteger(response, 'x-mullet-width', 16, 8192),
        height: responseHeaderInteger(response, 'x-mullet-height', 16, 8192),
        frames: responseHeaderInteger(response, 'x-mullet-frames', 1, 10_000),
        fps: responseHeaderInteger(response, 'x-mullet-fps', 1, 1_000),
        durationSeconds: responseHeaderInteger(response, 'x-mullet-duration-seconds', 1, 3_600),
        generatedAt: Date.now(),
        inputImageSha256,
        videoSha256,
        video
      });
      await commitStoredPortraitVideo(stored, {
        exclusive: runStoredPortraitVideoExclusive,
        save: saveStoredPortraitVideo,
        rollback: rollbackStoredPortraitVideoWrite,
        isCurrent: () => portraitVideoSourceIsCurrent(generation, selectedPortrait, selectedRequest, key, activeController.signal),
        install: installGeneratedPortraitVideo
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) portraitVideoError = `Portrait motion timed out after ${(PORTRAIT_VIDEO_TIMEOUT_MS + 5_000) / 1000} seconds.`;
      } else {
        portraitVideoError = cause instanceof Error ? cause.message : 'Portrait motion failed.';
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
    }
  }

  function currentPortraitRequest(
    result: ExpressionSidecarResult | null,
    current: boolean,
    subject: string,
    setting: string,
    attire: string,
    lora: string,
    aspectRatio: PortraitAspectRatio,
    megapixels: PortraitMegapixels
  ): PortraitRequest | null {
    if (!result || !current) return null;
    try {
      return buildPortraitRequest(result, {
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
    current: boolean
  ) {
    if (!enabled || !capabilities || !persistenceReady || !persistenceAvailable || busy || !request || current) return;
    const key = portraitRequestKey(request);
    if (key === lastPortraitAttemptKey) return;
    lastPortraitAttemptKey = key;
    void generatePortrait(request);
  }

  function responseHeaderInteger(response: Response, name: string, minimum: number, maximum: number): number {
    const value = Number(response.headers.get(name));
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Portrait response omitted ${name}.`);
    return value;
  }

  async function generatePortrait(selectedRequest: PortraitRequest | null = portraitRequest) {
    if (!selectedRequest || !portraitCapabilities || portraitBusy || !portraitPersistenceReady || !portraitPersistenceAvailable) return;
    suspendPortraitVideoForStaticGeneration();
    const key = portraitRequestKey(selectedRequest);
    lastPortraitAttemptKey = key;
    portraitBusy = true;
    portraitError = '';
    const activeController = new AbortController();
    portraitController = activeController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, PORTRAIT_TIMEOUT_MS + 5_000);
    try {
      const response = await fetch(`${base}/api/portrait`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selectedRequest),
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
      await commitStoredPortrait(stored, {
        save: saveStoredPortrait,
        isCurrent,
        discard: (stale) => clearStoredPortraitIfPromptId(stale.promptId),
        install: installGeneratedPortrait
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) portraitError = `Portrait generation timed out after ${(PORTRAIT_TIMEOUT_MS + 5_000) / 1000} seconds.`;
      } else {
        portraitError = cause instanceof Error ? cause.message : 'Portrait generation failed.';
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
    invalidatePortraitVideoForPortraitChange(true);
    portraitController?.abort();
    lastPortraitAttemptKey = '';
    portraitError = '';
    generatedPortrait = null;
    if (generatedPortraitUrl) URL.revokeObjectURL(generatedPortraitUrl);
    generatedPortraitUrl = '';
    try {
      await clearStoredPortrait();
    } catch (cause) {
      portraitPersistenceAvailable = false;
      portraitError = cause instanceof Error ? cause.message : 'Portrait persistence failed.';
    }
  }

  function currentExpressionSnapshot(currentConversationId: string, currentMessages: readonly Message[]): ExpressionSidecarRequest | null {
    if (!currentConversationId) return null;
    try {
      return buildExpressionSidecarRequest(currentConversationId, currentMessages);
    } catch {
      return null;
    }
  }

  function persistLivingHistoryBoundaries() {
    if (!browser) return;
    if (livingHistoryBoundaries.length) {
      localStorage.setItem(livingHistoryBoundariesStorageKey, JSON.stringify(livingHistoryBoundaries));
    } else {
      localStorage.removeItem(livingHistoryBoundariesStorageKey);
    }
  }

  function restoreLivingHistoryBoundaries() {
    const saved = localStorage.getItem(livingHistoryBoundariesStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      livingHistoryBoundaries = normalizeStoredLivingHistoryBoundaries(parsed, conversationId, messages);
    } catch {
      livingHistoryBoundaries = [];
      localStorage.removeItem(livingHistoryBoundariesStorageKey);
    }
  }

  function disableLivingHistoryPersistence(cause: unknown) {
    livingHistoryGeneration += 1;
    livingHistoryController?.abort();
    livingHistoryPersistenceAvailable = false;
    livingHistoryEnabled = false;
    if (browser) localStorage.setItem(livingHistoryEnabledStorageKey, 'false');
    livingHistoryError = cause instanceof Error ? cause.message : 'Living-history persistence failed.';
  }

  function reconcileLivingHistoryEpochFromStorage(): boolean {
    const authoritativeEpoch = authoritativeLivingHistoryEpoch(
      livingHistoryEpoch,
      localStorage.getItem(livingHistoryEpochStorageKey)
    );
    if (authoritativeEpoch === livingHistoryEpoch) return true;
    livingHistoryEpoch = authoritativeEpoch;
    livingHistoryGeneration += 1;
    livingHistoryController?.abort();
    livingHistoryResult = null;
    livingHistoryBook = null;
    livingHistoryBoundaries = [];
    livingHistoryError = '';
    lastLivingHistoryAttemptKey = '';
    livingHistoryPersistenceReady = true;
    return false;
  }

  function handleLivingHistoryEpochChange(event: StorageEvent) {
    if (event.key === livingHistoryEpochStorageKey) reconcileLivingHistoryEpochFromStorage();
  }

  async function restoreLivingHistory(allowLegacy = false) {
    const restoreGeneration = livingHistoryGeneration;
    const restoreConversationId = conversationId;
    const restoreEpoch = livingHistoryEpoch;
    try {
      const restored = await restoreLivingHistoryResult({
        load: () => loadStoredLivingHistory(restoreEpoch, allowLegacy),
        isCurrent: () => restoreGeneration === livingHistoryGeneration
          && restoreConversationId === conversationId
          && restoreEpoch === livingHistoryEpoch
          && localStorage.getItem(livingHistoryEpochStorageKey) === restoreEpoch,
        accepts: (result) => livingHistoryResultAppliesToMessages(result, restoreConversationId, messages),
        install: (current) => {
          livingHistoryResult = current;
          livingHistoryBoundaries = livingHistoryBoundaries.filter((boundary) => boundary.messageCount > current.source.messageCount);
          persistLivingHistoryBoundaries();
        },
        exclusive: runStoredLivingHistoryExclusive
      });
      void restored;
    } catch (cause) {
      disableLivingHistoryPersistence(cause);
    } finally {
      if (
        restoreGeneration === livingHistoryGeneration
        && restoreEpoch === livingHistoryEpoch
        && localStorage.getItem(livingHistoryEpochStorageKey) === restoreEpoch
      ) livingHistoryPersistenceReady = true;
    }
  }

  function recordFinalizedLivingHistoryBoundary() {
    try {
      const source = livingHistorySourceForMessages(conversationId, messages);
      livingHistoryBoundaries = appendLivingHistoryBoundary(livingHistoryBoundaries, source);
      persistLivingHistoryBoundaries();
      lastLivingHistoryAttemptKey = '';
    } catch {
      // Only completed, non-empty user-assistant pairs reach this function.
    }
  }

  function scheduleLivingHistoryReconciliation(
    enabled: boolean,
    persistenceReady: boolean,
    persistenceAvailable: boolean,
    isStreaming: boolean,
    busy: boolean,
    request: LivingHistoryRequest | null,
    pendingMessages: number
  ) {
    if (
      !enabled
      || !persistenceReady
      || !persistenceAvailable
      || isStreaming
      || busy
      || !request
      || !livingHistoryAutomaticUpdateDue(pendingMessages)
    ) return;
    const key = livingHistoryRequestKey(request);
    if (key === lastLivingHistoryAttemptKey) return;
    lastLivingHistoryAttemptKey = key;
    void updateLivingHistory(request);
  }

  function persistLivingHistoryEnabled() {
    if (!livingHistoryPersistenceReady || !livingHistoryPersistenceAvailable) livingHistoryEnabled = false;
    if (livingHistoryEnabled && importedLorebooks.length >= MAX_SUPPLEMENTAL_LOREBOOKS) {
      livingHistoryEnabled = false;
      livingHistoryError = 'Living history reserves one supplemental lorebook slot; remove one of the 20 imported lorebooks first.';
    } else {
      livingHistoryError = '';
    }
    localStorage.setItem(livingHistoryEnabledStorageKey, String(livingHistoryEnabled));
    lastLivingHistoryAttemptKey = '';
    if (!livingHistoryEnabled) livingHistoryController?.abort();
  }

  async function updateLivingHistory(selectedRequest: LivingHistoryRequest | null = livingHistoryRequest) {
    if (
      !selectedRequest
      || !livingHistoryEnabled
      || streaming
      || livingHistoryBusy
      || !livingHistoryPersistenceReady
      || !livingHistoryPersistenceAvailable
    ) return;
    const selectedEpoch = livingHistoryEpoch;
    lastLivingHistoryAttemptKey = livingHistoryRequestKey(selectedRequest);
    livingHistoryBusy = true;
    livingHistoryError = '';
    const activeController = new AbortController();
    livingHistoryController = activeController;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, LIVING_HISTORY_TIMEOUT_MS);
    try {
      const response = await fetch(`${base}/api/sidecar/history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selectedRequest),
        signal: activeController.signal
      });
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
          : `Living-history sidecar failed (${response.status}).`;
        throw new Error(detail);
      }
      const result = normalizeLivingHistoryResult(payload);
      if (!livingHistoryResultMatchesRequest(result, selectedRequest)) {
        throw new Error('Living-history sidecar returned a mismatched source snapshot.');
      }
      const isCurrent = () => {
        const liveRequest = currentLivingHistoryRequest(conversationId, messages, livingHistoryResult, livingHistoryBoundaries);
        return livingHistoryEnabled
          && selectedEpoch === livingHistoryEpoch
          && localStorage.getItem(livingHistoryEpochStorageKey) === selectedEpoch
          && Boolean(liveRequest && livingHistoryRequestKey(liveRequest) === livingHistoryRequestKey(selectedRequest));
      };
      try {
        await commitLivingHistoryResult(result, {
          save: (current) => saveStoredLivingHistory(current, selectedEpoch),
          isCurrent,
          discard: rollbackStoredLivingHistoryWrite,
          install: (current) => {
            livingHistoryResult = current;
            livingHistoryBoundaries = livingHistoryBoundaries.filter((boundary) => boundary.messageCount > current.source.messageCount);
            persistLivingHistoryBoundaries();
          },
          exclusive: runStoredLivingHistoryExclusive
        });
      } catch (cause) {
        disableLivingHistoryPersistence(cause);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) livingHistoryError = `Living-history sidecar timed out after ${LIVING_HISTORY_TIMEOUT_MS / 1000} seconds.`;
      } else {
        livingHistoryError = cause instanceof Error ? cause.message : 'Living-history sidecar failed.';
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (livingHistoryController === activeController) {
        livingHistoryBusy = false;
        livingHistoryController = null;
      }
    }
  }

  async function clearLivingHistory() {
    livingHistoryGeneration += 1;
    const nextEpoch = crypto.randomUUID();
    livingHistoryController?.abort();
    livingHistoryResult = null;
    livingHistoryBook = null;
    livingHistoryBoundaries = [];
    livingHistoryError = '';
    lastLivingHistoryAttemptKey = '';
    persistLivingHistoryBoundaries();
    try {
      await clearLivingHistoryAtEpoch(nextEpoch, {
        exclusive: runStoredLivingHistoryExclusive,
        publishEpoch: (epoch) => {
          livingHistoryEpoch = epoch;
          localStorage.setItem(livingHistoryEpochStorageKey, epoch);
        },
        clear: clearStoredLivingHistory
      });
    } catch (cause) {
      disableLivingHistoryPersistence(cause);
    } finally {
      livingHistoryPersistenceReady = true;
    }
  }

  function livingHistoryStatusText(): string {
    if (livingHistoryBusy) return 'Updating continuity…';
    if (livingHistoryResult && !livingHistoryApplicable) return 'Stored history does not match this transcript.';
    if (livingHistoryCurrent) return `Current · revision ${livingHistoryResult?.output.revision ?? 0}`;
    if (livingHistoryPendingMessages >= LIVING_HISTORY_INTERVAL_MESSAGES) return `${livingHistoryPendingMessages} finalized messages ready to summarize.`;
    if (livingHistoryPendingMessages > 0) {
      return `${LIVING_HISTORY_INTERVAL_MESSAGES - livingHistoryPendingMessages} finalized messages until automatic update.`;
    }
    if (livingHistoryResult) return `Current through ${livingHistoryResult.source.messageCount} canonical messages.`;
    return 'No finalized history yet.';
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
    livingHistoryController?.abort();
    lastExpressionAttemptKey = '';
    lastLivingHistoryAttemptKey = '';
    conversationId = crypto.randomUUID();
    localStorage.setItem(conversationIdStorageKey, conversationId);
    await resetPortraitForConversation();
    await clearLivingHistory();
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
    const snapshot = selectedSnapshot ?? currentExpressionSnapshot(conversationId, messages);
    if (!snapshot || streaming || sidecarBusy || !sidecarPersistenceReady || !sidecarPersistenceAvailable || !sidecarState) return;
    lastExpressionAttemptKey = expressionSnapshotKey(snapshot);
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
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        if (timedOut) sidecarError = `Expression sidecar timed out after ${SIDECAR_TIMEOUT_MS / 1000} seconds.`;
      } else {
        sidecarError = cause instanceof Error ? cause.message : 'Expression sidecar failed.';
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
    try {
      const response = await fetch(`${base}/scenarios/catalog.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Bundled scenario catalog failed to load (${response.status}).`);
      scenarioCatalog = normalizeScenarioCatalog(await response.json());
      const activeScenarioId = activeCard?.data.extensions.mullet && typeof activeCard.data.extensions.mullet === 'object'
        ? String((activeCard.data.extensions.mullet as Record<string, unknown>).scenario_id ?? '')
        : '';
      selectedScenarioId = scenarioCatalog.scenarios.some((scenario) => scenario.id === activeScenarioId)
        ? activeScenarioId
        : scenarioCatalog.scenarios[0].id;
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Bundled scenario catalog failed to load.';
    }
  }

  function hasRealTranscript(): boolean {
    if (messages.some((message) => message.role === 'user')) return true;
    return messages.length > 0 && (!activeCard || !containsOnlyOpeningGreeting(activeCard));
  }

  async function startSelectedScenario() {
    if (!selectedScenario || streaming || scenarioLoading) return;
    errorMessage = '';
    noticeMessage = '';
    scenarioLoading = true;
    try {
      const [cardResponse, lorebookResponse] = await Promise.all([
        fetch(`${base}/scenarios/${selectedScenario.card}`, { cache: 'no-store' }),
        fetch(`${base}/scenarios/${selectedScenario.lorebook}`, { cache: 'no-store' })
      ]);
      if (!cardResponse.ok || !lorebookResponse.ok) {
        throw new Error(`Bundled scenario package failed to load (${cardResponse.status}/${lorebookResponse.status}).`);
      }
      const packaged = validateScenarioPackage(
        selectedScenario,
        await cardResponse.json(),
        await lorebookResponse.json()
      );
      if (hasRealTranscript() && !window.confirm('Replace the current conversation with this scenario opening?')) return;

      activeCard = packaged.card;
      cardSourceIdentifier = characterSourceIdentifier(selectedScenario.card);
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
      persist();
      noticeMessage = `${selectedScenario.title} started with ${packaged.lorebook.entries.length} embedded lore entries.`;
      await scrollToLatest();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Bundled scenario failed to start.';
    } finally {
      scenarioLoading = false;
    }
  }

  function persist() {
    if (browser) localStorage.setItem(messagesStorageKey, JSON.stringify(messages));
  }

  function freshConversation(): Message[] {
    if (!activeCard) return [];
    const greeting = firstCharacterMessage(activeCard);
    return greeting.trim() ? [{ role: 'assistant', content: greeting }] : [];
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
    const greeting = firstCharacterMessage(card);
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

  async function clearConversation() {
    if (streaming) return;
    messages = freshConversation();
    errorMessage = '';
    noticeMessage = '';
    lastLoreActivations = null;
    lastLoreBudget = 0;
    loreTimedState = emptyLoreTimedState();
    localStorage.removeItem(loreTimedStateStorageKey);
    await resetSidecarForConversation();
    persist();
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
    try {
      if (file.size > MAX_CHARACTER_CARD_PNG_BYTES) throw new Error('Character card exceeds 25 MB.');
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const imported = isPng
        ? extractPngCharacterCard(await file.arrayBuffer())
        : parseCharacterCardJson(await file.text());
      const nextPortrait = isPng ? await portraitFromPng(file) : '';
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
        persist();
      }
      noticeMessage = `${imported.data.name} loaded from ${file.name}.`;
      await scrollToLatest();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Character card import failed.';
    } finally {
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
      const maximumImported = livingHistoryEnabled
        ? MAX_SUPPLEMENTAL_LOREBOOKS - 1
        : MAX_SUPPLEMENTAL_LOREBOOKS;
      if (nextBooks.length > maximumImported) {
        throw new Error(livingHistoryEnabled
          ? 'Living history reserves one slot; at most 19 imported lorebooks can be active while it is on.'
          : 'At most 20 imported lorebooks can be active.');
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

  function persistTokenLimit() {
    if (browser) localStorage.setItem('mullet.response-token-limit', String(tokenLimit));
    lastLoreBudget = 0;
  }

  function stop() {
    controller?.abort();
  }

  async function send() {
    if (browser) reconcileLivingHistoryEpochFromStorage();
    const content = draft.trim();
    if (
      !content
      || streaming
      || !lorePersistenceReady
      || !livingHistoryReadyForChat(livingHistoryEnabled, livingHistoryPersistenceReady)
    ) return;

    const outboundMessages = [...messages, { role: 'user' as const, content }];
    let supplementalLorebooks: ImportedLorebook[];
    try {
      supplementalLorebooks = assembleSupplementalLorebooks(importedLorebooks, livingHistoryBook);
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Supplemental lorebooks could not be prepared.';
      return;
    }
    let requestBody: string;
    try {
      requestBody = serializeChatRequest({
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
      return;
    }

    sidecarController?.abort();
    livingHistoryController?.abort();
    lastLivingHistoryAttemptKey = '';
    portraitController?.abort();
    portraitVideoGeneration += 1;
    portraitVideoController?.abort();
    portraitVideoBusy = false;
    lastPortraitVideoAttemptKey = '';
    errorMessage = '';
    noticeMessage = '';
    lastLoreActivations = null;
    lastLoreBudget = 0;
    draft = '';
    messages = [...outboundMessages, { role: 'assistant', content: '' }];
    streaming = true;
    controller = new AbortController();
    let completedResponse = false;
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
      persist();
      completedResponse = true;
      if (hitTokenLimit) noticeMessage = `Stopped at the ${tokenLimit}-token response limit.`;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        errorMessage = 'Generation stopped.';
      } else {
        errorMessage = cause instanceof Error ? cause.message : 'Generation failed.';
      }
      if (messages.at(-1)?.content === '') messages = messages.slice(0, -1);
      persist();
    } finally {
      streaming = false;
      controller = null;
      if (completedResponse) recordFinalizedLivingHistoryBoundary();
      await scrollToLatest();
    }
  }

  function composerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
</script>

<svelte:head>
  <title>MULLET · Local scenario workbench</title>
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
    <div class="runtime" aria-label="Active runtime">
      <span class:live={streaming || sidecarBusy || portraitBusy || portraitVideoBusy || livingHistoryBusy} class="dot"></span>
      <div><strong>{data.model}</strong><small>{data.revision.slice(0, 10)}</small></div>
    </div>
  </header>

  <main>
    <aside>
      <div class:active={activeCard || generatedPortraitUrl} class:generated={expressionsEnabled && generatedPortraitUrl} class="portrait">
        {#if expressionsEnabled && portraitMotionEnabled && generatedPortraitVideoUrl && portraitVideoCurrent && !portraitBusy && !portraitVideoBusy && !portraitVideoError}
          <video src={generatedPortraitVideoUrl} autoplay muted loop playsinline aria-label={`${generatedPortrait?.source.expression ?? 'Current'} generated expression motion portrait`}></video>
          <span class="portrait-status">{portraitVideoBusy ? 'Animating…' : generatedPortrait?.source.expression}</span>
        {:else if expressionsEnabled && generatedPortraitUrl}
          <img src={generatedPortraitUrl} alt={`${generatedPortrait?.source.expression ?? 'Current'} generated expression portrait`} />
          <span class:stale={!portraitCurrent || (portraitMotionEnabled && Boolean(generatedPortraitVideo) && !portraitVideoCurrent)} class="portrait-status">{portraitBusy ? 'Updating…' : portraitVideoBusy ? 'Animating…' : portraitCurrent ? generatedPortrait?.source.expression : 'Stale'}</span>
        {:else if portraitDataUrl && activeCard}
          <img src={portraitDataUrl} alt={`${activeCard.data.name} character portrait`} />
        {:else if activeCard}
          <span class="initial">{activeCard.data.name.slice(0, 1).toUpperCase()}</span>
        {:else}
          <span>Import a SillyTavern<br />JSON or PNG card</span>
        {/if}
      </div>
      {#if activeCard}
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
        disabled={streaming}
        aria-label="Choose a character card"
      />
      <div class="card-actions">
        <button class="card-button primary" on:click={() => cardInput?.click()} disabled={streaming}>
          {activeCard ? 'Replace card' : 'Import card'}
        </button>
        {#if activeCard}
          <button class="card-button" on:click={removeCharacterCard} disabled={streaming}>Remove</button>
        {/if}
      </div>
      <section class="scenario-picker" aria-label="Bundled scenarios">
        <span class="eyebrow">Bundled scenarios</span>
        {#if scenarioCatalog}
          <select bind:value={selectedScenarioId} disabled={streaming || scenarioLoading} aria-label="Select bundled scenario">
            {#each scenarioCatalog.scenarios as scenario}
              <option value={scenario.id}>{scenario.title}</option>
            {/each}
          </select>
          {#if selectedScenario}<small>{selectedScenario.summary}</small>{/if}
          <button on:click={() => void startSelectedScenario()} disabled={streaming || scenarioLoading || !selectedScenario}>
            {scenarioLoading ? 'Loading…' : 'Start scenario'}
          </button>
        {:else}
          <small>Loading bundled scenarios…</small>
        {/if}
      </section>
      <section class="expression-panel" aria-label="Expression sidecar">
        <div class="expression-heading">
          <div>
            <span class="eyebrow">Expression sidecar</span>
            <strong>{expressionResult?.output.expression ?? 'No expression yet'}</strong>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              bind:checked={expressionsEnabled}
              on:change={persistExpressionsEnabled}
              disabled={streaming || !sidecarPersistenceReady || !sidecarPersistenceAvailable}
            />
            <span>{expressionsEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        {#if expressionResult}
          <small class:stale={!expressionCurrent}>{expressionCurrent ? 'Current response' : 'Stale · run again'} · {expressionResult.model}</small>
        {:else}
          <small>Classifies the latest assistant response on an isolated model branch.</small>
        {/if}
        {#if sidecarError}<div class="sidecar-error" role="alert">{sidecarError}</div>{/if}
        <button
          on:click={() => void determineExpression()}
          disabled={streaming || sidecarBusy || !sidecarPersistenceReady || !sidecarPersistenceAvailable || !expressionSnapshot}
        >
          {sidecarBusy ? 'Determining…' : 'Determine expression'}
        </button>
      </section>
      <section class="portrait-panel" aria-label="Generated expression portrait">
        <div class="portrait-heading">
          <div>
            <span class="eyebrow">Comfy portrait</span>
            <strong>{portraitBusy ? 'Generating…' : portraitCurrent ? 'Current' : generatedPortrait ? 'Stale' : 'No image yet'}</strong>
          </div>
          {#if generatedPortrait}<small>{generatedPortrait.width}×{generatedPortrait.height}</small>{/if}
        </div>
        {#if portraitCapabilities}
          <label>
            <span>Image model</span>
            <select value={portraitCapabilities.template.id} disabled={portraitBusy} aria-label="Portrait image model">
              <option value={portraitCapabilities.template.id}>{portraitCapabilities.template.label}</option>
            </select>
          </label>
          <label>
            <span>Subject</span>
            <input bind:value={portraitSubject} on:change={persistPortraitSettings} maxlength="500" disabled={portraitBusy} aria-label="Portrait subject" />
          </label>
          <label>
            <span>Subject LoRA</span>
            <select bind:value={portraitLora} on:change={persistPortraitSettings} disabled={portraitBusy} aria-label="Portrait subject LoRA">
              <option value="">None</option>
              {#each portraitCapabilities.loras as lora}
                <option value={lora}>{lora.replace(/^zimage\//, '').replace(/\.safetensors$/, '')}</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Attire</span>
            <input bind:value={portraitAttire} on:change={persistPortraitSettings} maxlength="500" placeholder="Optional" disabled={portraitBusy} aria-label="Portrait attire" />
          </label>
          <label>
            <span>Setting</span>
            <input bind:value={portraitSetting} on:change={persistPortraitSettings} maxlength="500" placeholder="Optional" disabled={portraitBusy} aria-label="Portrait setting" />
          </label>
          <div class="portrait-grid">
            <label>
              <span>Aspect</span>
              <select bind:value={portraitAspectRatio} on:change={persistPortraitSettings} disabled={portraitBusy} aria-label="Portrait aspect ratio">
                {#each portraitCapabilities.aspectRatios as ratio}<option value={ratio.id}>{ratio.label}</option>{/each}
              </select>
            </label>
            <label>
              <span>Megapixels</span>
              <select bind:value={portraitMegapixels} on:change={persistPortraitSettings} disabled={portraitBusy} aria-label="Portrait megapixels">
                {#each portraitCapabilities.megapixels as megapixels}<option value={megapixels}>{megapixels} MP</option>{/each}
              </select>
            </label>
          </div>
          <small class="prompt-guide">{portraitCapabilities.template.promptGuide}</small>
          {#if portraitError}<div class="sidecar-error" role="alert">{portraitError}</div>{/if}
          <button on:click={() => void generatePortrait()} disabled={portraitBusy || !portraitRequest || !expressionsEnabled || !portraitPersistenceAvailable}>
            {portraitBusy ? 'Generating…' : portraitCurrent ? 'Regenerate portrait' : 'Generate portrait'}
          </button>
          {#if !expressionsEnabled}<small>Turn on Expressions to generate and update portraits.</small>{/if}
        {:else}
          {#if portraitError}<div class="sidecar-error" role="alert">{portraitError}</div>{/if}
          <button on:click={() => void loadPortraitGenerator()} disabled={portraitCapabilitiesLoading}>
            {portraitCapabilitiesLoading ? 'Connecting…' : 'Retry portrait generator'}
          </button>
        {/if}
      </section>
      <section class="portrait-panel motion-panel" aria-label="Generated portrait motion">
        <div class="portrait-heading">
          <div>
            <span class="eyebrow">Portrait motion</span>
            <strong>{portraitVideoBusy ? 'Animating…' : portraitVideoError ? 'Static fallback' : portraitVideoCurrent ? 'Current loop' : generatedPortraitVideo ? 'Stale' : 'No loop yet'}</strong>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              bind:checked={portraitMotionEnabled}
              on:change={persistPortraitMotionEnabled}
              disabled={!portraitVideoPersistenceReady || !portraitVideoPersistenceAvailable}
            />
            <span>{portraitMotionEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        {#if portraitVideoCapabilities}
          <label>
            <span>Video model</span>
            <select value={portraitVideoCapabilities.template.id} disabled={portraitVideoBusy} aria-label="Portrait video model">
              <option value={portraitVideoCapabilities.template.id}>{portraitVideoCapabilities.template.label}</option>
            </select>
          </label>
          <small>49 frames @ 24 FPS · 2-second motion span · looping VP9 WebM</small>
          {#if generatedPortraitVideo}<small>{generatedPortraitVideo.width}×{generatedPortraitVideo.height} · {generatedPortraitVideo.frames} frames</small>{/if}
          {#if portraitVideoError}<div class="sidecar-error" role="alert">{portraitVideoError}</div>{/if}
          <button
            on:click={() => void generatePortraitVideo()}
            disabled={portraitVideoBusy || portraitBusy || !portraitVideoRequest || !portraitMotionEnabled || !expressionsEnabled || !portraitVideoPersistenceAvailable}
          >
            {portraitVideoBusy ? 'Animating…' : portraitVideoCurrent ? 'Regenerate motion' : 'Generate motion'}
          </button>
          {#if !portraitMotionEnabled}<small>Turn on Portrait motion to animate each current expression portrait.</small>{/if}
          {#if portraitMotionEnabled && !generatedPortrait}<small>A current Comfy portrait is required before motion starts.</small>{/if}
        {:else}
          {#if portraitVideoError}<div class="sidecar-error" role="alert">{portraitVideoError}</div>{/if}
          <button on:click={() => void loadPortraitVideoGenerator()} disabled={portraitVideoCapabilitiesLoading}>
            {portraitVideoCapabilitiesLoading ? 'Connecting…' : 'Retry portrait motion'}
          </button>
        {/if}
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

        <div class="history-panel" aria-label="Living history">
          <div class="history-heading">
            <div>
              <span class="eyebrow">Living history</span>
              <strong>{livingHistoryResult ? `Revision ${livingHistoryResult.output.revision}` : 'Session continuity'}</strong>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                bind:checked={livingHistoryEnabled}
                on:change={persistLivingHistoryEnabled}
                disabled={streaming || !livingHistoryPersistenceReady || !livingHistoryPersistenceAvailable}
              />
              <span>{livingHistoryEnabled ? 'On' : 'Off'}</span>
            </label>
          </div>
          <small>{livingHistoryStatusText()}</small>
          {#if livingHistoryResult}
            <details>
              <summary>Continuity preview</summary>
              <p>{livingHistoryResult.output.summary}</p>
            </details>
          {/if}
          {#if livingHistoryError}<div class="sidecar-error" role="alert">{livingHistoryError}</div>{/if}
          <div class="history-actions">
            <button
              on:click={() => void updateLivingHistory()}
              disabled={streaming || livingHistoryBusy || !livingHistoryEnabled || !livingHistoryRequest || !livingHistoryPersistenceReady || !livingHistoryPersistenceAvailable}
            >
              {livingHistoryBusy ? 'Updating…' : 'Update now'}
            </button>
            <button
              on:click={() => void clearLivingHistory()}
              disabled={streaming || livingHistoryBusy || !livingHistoryPersistenceReady || (!livingHistoryResult && livingHistoryBoundaries.length === 0)}
            >Clear</button>
          </div>
          <small>200-word target · every {LIVING_HISTORY_INTERVAL_MESSAGES} finalized messages · isolated Gemma branch</small>
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
      <button class="clear" on:click={() => void clearConversation()} disabled={streaming || messages.length === 0}>Clear conversation</button>
    </aside>

    <section class="chat" aria-label="Conversation">
      <div class="transcript" bind:this={transcript} aria-live="polite">
        {#if messages.length === 0}
          <div class="empty">
            <span class="eyebrow">Real local model · clean channel</span>
            <h2>Start the story.</h2>
            <p>Talk directly to the local model, or import a SillyTavern-compatible character card from the left.</p>
            <div class="starters">
              {#each starters as starter}
                <button on:click={() => chooseStarter(starter)}>{starter}</button>
              {/each}
            </div>
          </div>
        {:else}
          {#each messages as message}
            <article class:assistant={message.role === 'assistant'}>
              <span class="speaker">{message.role === 'user' ? 'You' : activeCard?.data.name ?? data.model}</span>
              <div class="content">{message.content}{#if streaming && message === messages.at(-1)}<span class="cursor">▋</span>{/if}</div>
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
            placeholder="Write the next turn…"
            rows="2"
            disabled={streaming}
            aria-label="Message"
          ></textarea>
          {#if streaming}
            <button class="stop" on:click={stop}>Stop</button>
          {:else}
            <button
              class="send"
              on:click={send}
              disabled={!draft.trim() || !lorePersistenceReady || !livingHistoryReadyForChat(livingHistoryEnabled, livingHistoryPersistenceReady)}
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
              disabled={streaming}
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
  .runtime { display: flex; align-items: center; gap: 9px; padding: 8px 12px; border: 1px solid #3a352f; border-radius: 10px; background: #181614; }
  .runtime div { display: grid; }
  .runtime strong { font-size: 12px; font-weight: 650; }
  .runtime small { color: #817a72; font-family: ui-monospace, monospace; font-size: 10px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6ebc84; box-shadow: 0 0 10px rgba(110,188,132,.55); }
  .dot.live { background: #e7aa61; animation: pulse 1s infinite alternate; }
  main { min-height: 0; display: grid; grid-template-columns: 270px minmax(0, 1fr); }
  aside { min-height: 0; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 18px; border-right: 1px solid #302c28; background: rgba(15,14,13,.55); }
  .portrait { aspect-ratio: 3 / 4; flex: 0 0 auto; overflow: hidden; display: grid; place-items: center; border: 1px dashed #51493f; border-radius: 16px; color: #71695f; background: linear-gradient(145deg, #24201c, #171513); text-align: center; font-size: 12px; line-height: 1.5; }
  .portrait { position: relative; }
  .portrait.active { border-style: solid; border-color: #5c4b38; }
  .portrait.generated { border-color: #49614d; }
  .portrait img, .portrait video { width: 100%; height: 100%; object-fit: cover; }
  .portrait-status { position: absolute; right: 8px; bottom: 8px; padding: 4px 7px; border: 1px solid rgba(126,184,141,.65); border-radius: 999px; color: #d9efdd; background: rgba(17,29,20,.82); font: 700 9px/1 ui-monospace, monospace; text-transform: capitalize; backdrop-filter: blur(8px); }
  .portrait-status.stale { border-color: rgba(181,135,84,.65); color: #efd0a8; background: rgba(43,31,20,.82); }
  .initial { color: #e7aa61; font: 500 72px/1 Georgia, serif; text-shadow: 0 0 42px rgba(231,170,97,.25); }
  .scenario { padding: 2px 3px; }
  .scenario strong { display: block; margin: 7px 0; font-family: Georgia, serif; font-size: 17px; }
  .scenario p { max-height: 7.75em; overflow-y: auto; margin: 0; color: #968e84; font-size: 12px; line-height: 1.55; }
  .card-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .card-facts span { padding: 4px 7px; border: 1px solid #3d3730; border-radius: 999px; color: #817970; background: #191714; font: 9px/1 ui-monospace, monospace; }
  .eyebrow { color: #d69d5a; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .file-input { display: none; }
  .card-actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
  .card-button { padding: 9px 11px; border: 1px solid #4a4239; border-radius: 9px; color: #b7aea4; background: #1b1815; cursor: pointer; }
  .card-button.primary { color: #21170d; border-color: #d49a56; background: #dca35f; font-weight: 750; }
  .card-button:hover:not(:disabled) { border-color: #98714a; color: #fff0df; }
  .card-button.primary:hover:not(:disabled) { color: #21170d; background: #e8b06e; }
  .card-button:disabled { opacity: .35; cursor: default; }
  .scenario-picker { display: grid; gap: 8px; padding: 13px 0 2px; border-top: 1px solid #34302b; }
  .scenario-picker select { min-width: 0; width: 100%; padding: 8px 9px; border: 1px solid #443d35; border-radius: 8px; color: #d0c7bc; background: #181512; font-size: 10px; }
  .scenario-picker small { color: #7e766e; font-size: 10px; line-height: 1.45; }
  .scenario-picker button { padding: 8px; border: 1px solid #875f39; border-radius: 8px; color: #e8c28e; background: #2a2118; font-size: 10px; font-weight: 700; cursor: pointer; }
  .scenario-picker button:hover:not(:disabled) { border-color: #d49a56; color: #fff0dc; }
  .scenario-picker button:disabled { opacity: .4; cursor: default; }
  .expression-panel { display: grid; gap: 9px; padding: 15px 0 2px; border-top: 1px solid #34302b; }
  .expression-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .expression-heading > div { min-width: 0; display: grid; gap: 4px; }
  .expression-heading strong { overflow: hidden; color: #d7d0c7; font-size: 12px; text-overflow: ellipsis; text-transform: capitalize; white-space: nowrap; }
  .expression-panel > small { color: #758c78; font-size: 9px; line-height: 1.4; }
  .expression-panel > small.stale { color: #9b8066; }
  .expression-panel > button { padding: 8px; border: 1px solid #49614d; border-radius: 8px; color: #b6d3ba; background: #19221b; font-size: 10px; font-weight: 700; cursor: pointer; }
  .expression-panel > button:hover:not(:disabled) { border-color: #7db68d; color: #e3f2e5; }
  .expression-panel > button:disabled { opacity: .4; cursor: default; }
  .sidecar-error { padding: 7px 8px; border: 1px solid #6e3c34; border-radius: 7px; color: #e6b9ae; background: #2c1b18; font-size: 9px; line-height: 1.4; }
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
