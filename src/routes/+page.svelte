<script lang="ts">
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import { onMount, tick } from 'svelte';
  import {
    embeddedLoreEntryCount,
    firstCharacterMessage,
    normalizeCharacterCard,
    parseCharacterCardJson,
    type ImportedCharacterCard
  } from '$lib/character-card';
  import {
    DEFAULT_LOREBOOK_SETTINGS,
    emptyLoreTimedState,
    normalizeLorebook,
    normalizeLoreTimedState,
    parseLorebookJson,
    resolveLorebookSettings,
    type ImportedLorebook,
    type LoreActivation,
    type LorebookSettings
    , type LoreTimedState
  } from '$lib/lorebook';
  import { extractPngCharacterCard, MAX_CHARACTER_CARD_PNG_BYTES } from '$lib/png-character-card';
  import { extractPngLorebook, MAX_LOREBOOK_PNG_BYTES } from '$lib/png-lorebook';
  import { loadStoredLorebooks, saveStoredLorebooks, type StoredLorebook } from '$lib/lorebook-storage';
  import { serializeChatRequest } from '$lib/chat-request-size';
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
  let personaDescription = '';
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
  const maxActiveLorebookBytes = 24 * 1024 * 1024;

  $: activeLorebooks = [
    ...(embeddedLorebook && !importedLorebooks.some((book) => book.name === embeddedLorebook?.name) ? [embeddedLorebook] : []),
    ...importedLorebooks
  ];

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
        cardSourceIdentifier = localStorage.getItem(cardSourceIdentifierStorageKey) ?? '';
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
  });

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

  function clearConversation() {
    if (streaming) return;
    messages = freshConversation();
    errorMessage = '';
    noticeMessage = '';
    lastLoreActivations = null;
    lastLoreBudget = 0;
    loreTimedState = emptyLoreTimedState();
    localStorage.removeItem(loreTimedStateStorageKey);
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
      cardSourceIdentifier = file.name;
      portraitDataUrl = nextPortrait;
      embeddedLorebook = embeddedLoreFromCard(imported);
      lastLoreActivations = null;
      lastLoreBudget = 0;
      persistCard();
      if (seedGreeting) {
        messages = freshConversation();
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
      if (nextBooks.length > 20) throw new Error('At most 20 imported lorebooks can be active.');
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

  function persistLoreSettings() {
    try {
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
    const content = draft.trim();
    if (!content || streaming || !lorePersistenceReady) return;

    errorMessage = '';
    noticeMessage = '';
    lastLoreActivations = null;
    lastLoreBudget = 0;
    draft = '';
    messages = [...messages, { role: 'user', content }, { role: 'assistant', content: '' }];
    streaming = true;
    controller = new AbortController();
    await scrollToLatest();

    try {
      const requestBody = serializeChatRequest({
        messages: messages.slice(0, -1),
        maxTokens: tokenLimit,
        characterCard: activeCard?.raw ?? null,
        userName: 'You',
        personaDescription,
        characterFilterNames: cardSourceIdentifier ? [cardSourceIdentifier] : [],
        characterTagIds: [],
        loreTimedState,
        loreEnabled,
        lorebooks: loreEnabled
          ? importedLorebooks.map((book) => ({ name: book.name, raw: book.raw }))
          : [],
        lorebookSettings: loreSettings
      });
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
          if (!payload || payload === '[DONE]') continue;
          const event = JSON.parse(payload);
          if (event?.mullet?.loreTimedState !== undefined) {
            loreTimedState = normalizeLoreTimedState(event.mullet.loreTimedState);
            persistLoreTimedState();
            continue;
          }
          if (event?.choices?.[0]?.finish_reason === 'length') hitTokenLimit = true;
          const token = event?.choices?.[0]?.delta?.content;
          if (typeof token !== 'string' || token.length === 0) continue;
          const last = messages.at(-1);
          if (last?.role === 'assistant') {
            last.content += token;
            messages = [...messages];
            await scrollToLatest();
          }
        }
      }

      persist();
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
      <span class:live={streaming} class="dot"></span>
      <div><strong>{data.model}</strong><small>{data.revision.slice(0, 10)}</small></div>
    </div>
  </header>

  <main>
    <aside>
      <div class:active={activeCard} class="portrait">
        {#if portraitDataUrl && activeCard}
          <img src={portraitDataUrl} alt={`${activeCard.data.name} character portrait`} />
        {:else if activeCard}
          <span class="initial">{activeCard.data.name.slice(0, 1).toUpperCase()}</span>
        {:else}
          <span>Import a SillyTavern<br />JSON or PNG card</span>
        {/if}
      </div>
      {#if activeCard}
        <div class="scenario">
          <span class="eyebrow">Active character · V{activeCard.version}</span>
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
              <input type="number" min="0" max="1000" step="1" bind:value={loreSettings.scanDepth} on:change={persistLoreSettings} disabled={streaming} />
            </label>
            <label>
              <span>Context %</span>
              <input type="number" min="1" max="100" step="1" bind:value={loreSettings.budgetPercent} on:change={persistLoreSettings} disabled={streaming} />
            </label>
            <label>
              <span>Minimum fired</span>
              <input type="number" min="0" max="100" step="1" bind:value={loreSettings.minActivations} on:change={persistLoreSettings} disabled={streaming} />
            </label>
            <label>
              <span>Maximum depth</span>
              <input type="number" min="0" max="100" step="1" bind:value={loreSettings.minActivationsDepthMax} on:change={persistLoreSettings} disabled={streaming} />
            </label>
          </div>
          <label class="check-row"><input type="checkbox" bind:checked={loreSettings.recursive} on:change={persistLoreSettings} disabled={streaming} /> Recursive scanning</label>
          <label class="check-row"><input type="checkbox" bind:checked={loreSettings.matchWholeWords} on:change={persistLoreSettings} disabled={streaming} /> Whole-word matching</label>
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
      <button class="clear" on:click={clearConversation} disabled={streaming || messages.length === 0}>Clear conversation</button>
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
            <button class="send" on:click={send} disabled={!draft.trim() || !lorePersistenceReady}>Send</button>
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
  :global(button), :global(textarea), :global(input) { font: inherit; }
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
  .portrait.active { border-style: solid; border-color: #5c4b38; }
  .portrait img { width: 100%; height: 100%; object-fit: cover; }
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
  .lore-panel { display: grid; gap: 10px; padding-top: 17px; border-top: 1px solid #34302b; }
  .persona-field { display: grid; gap: 7px; }
  .persona-field textarea { width: 100%; resize: vertical; min-height: 64px; padding: 9px 10px; border: 1px solid #413a33; border-radius: 9px; color: #ded6cc; background: #171513; font-size: 11px; line-height: 1.45; }
  .persona-field textarea:focus { outline: 1px solid #9c7145; border-color: #9c7145; }
  .lore-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .lore-heading > div { display: grid; gap: 4px; }
  .lore-heading strong { color: #d7d0c7; font-size: 12px; }
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
  .lore-setting-grid input { width: 100%; padding: 5px 6px; border: 1px solid #3c3731; border-radius: 6px; color: #c1b8ae; background: #181512; font-size: 10px; }
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
