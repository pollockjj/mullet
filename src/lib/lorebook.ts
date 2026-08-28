import {
  substituteCardMacros,
  type ChatMessage,
  type ImportedCharacterCard,
  type JsonObject
} from './character-card.ts';

export type LorebookOrigin = 'embedded' | 'imported';
export type LorebookFormat = 'character_book' | 'sillytavern' | 'lorebook_v3' | 'novelai' | 'agnai' | 'risu';

export type LorebookSettings = {
  scanDepth: number;
  minActivations: number;
  minActivationsDepthMax: number;
  budgetPercent: number;
  includeNames: boolean;
  recursive: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  maxContextTokens: number;
  budgetCap: number;
  maxRecursionSteps: number;
  useGroupScoring: boolean;
};

export const DEFAULT_LOREBOOK_SETTINGS: LorebookSettings = Object.freeze({
  scanDepth: 228,
  minActivations: 0,
  minActivationsDepthMax: 0,
  budgetPercent: 25,
  includeNames: true,
  recursive: true,
  caseSensitive: false,
  matchWholeWords: true,
  maxContextTokens: 262_144,
  budgetCap: 0,
  maxRecursionSteps: 0,
  useGroupScoring: false
});

export type NormalizedLoreEntry = {
  id: string;
  name: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: 0 | 1 | 2 | 3;
  insertionOrder: number;
  position: number;
  depth: number;
  role: 0 | 1 | 2;
  probability: number;
  useProbability: boolean;
  useRegex: boolean;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: number;
  ignoreBudget: boolean;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  useGroupScoring: boolean | null;
  outletName: string;
  triggers: string[];
  decorators: string[];
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  sticky: number;
  cooldown: number;
  delay: number;
  characterFilter: {
    names: string[];
    tags: string[];
    isExclude: boolean;
  } | null;
  raw: JsonObject;
  sourceIndex: number;
};

export type ImportedLorebook = {
  name: string;
  origin: LorebookOrigin;
  format: LorebookFormat;
  entries: NormalizedLoreEntry[];
  diagnostics: string[];
  raw: JsonObject;
};

export type LoreActivation = {
  book: string;
  entryId: string;
  name: string;
};

export type LoreTimedEffect = {
  fingerprint: number;
  start: number;
  end: number;
  protected: boolean;
};

export type LoreTimedState = {
  sticky: Record<string, LoreTimedEffect>;
  cooldown: Record<string, LoreTimedEffect>;
};

export type LoreDepthInjection = {
  depth: number;
  role: 0 | 1 | 2;
  content: string;
};

export type AuthorNoteSettings = {
  enabled: boolean;
  interval: number;
  prompt: string;
  depth: number;
  role: 0 | 1 | 2;
};

export const DEFAULT_AUTHOR_NOTE_SETTINGS: AuthorNoteSettings = Object.freeze({
  enabled: true,
  interval: 1,
  prompt: '',
  depth: 4,
  role: 0
});

export type LoreScanResult = {
  beforeCharacter: string[];
  afterCharacter: string[];
  authorNoteBefore: string[];
  authorNoteAfter: string[];
  examplesBefore: string[];
  examplesAfter: string[];
  depth: LoreDepthInjection[];
  outlets: Record<string, string[]>;
  activated: LoreActivation[];
  skipped: string[];
  budgetTokens: number;
  usedTokens: number;
  timedState: LoreTimedState;
};

export type RegexTestResult = {
  matched: boolean;
  invalid?: boolean;
  timeout?: boolean;
};

type ScanOptions = {
  card?: ImportedCharacterCard | null;
  userName?: string;
  assistantName?: string;
  personaDescription?: string;
  characterDepthPrompt?: string;
  characterFilterNames?: string[];
  characterTags?: string[];
  scanInjections?: string[];
  random?: () => number;
  tokenCount?: (value: string) => number | Promise<number>;
  regexTest?: (source: string, flags: string, haystack: string) => RegexTestResult | Promise<RegexTestResult>;
  generationTrigger?: string;
  timedState?: unknown;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function timedDuration(value: unknown): number {
  return Math.max(0, Math.min(999_999, Math.trunc(finiteNumber(value, 0))));
}

export function emptyLoreTimedState(): LoreTimedState {
  return { sticky: {}, cooldown: {} };
}

function normalizeTimedEffects(value: unknown, name: string): Record<string, LoreTimedEffect> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`loreTimedState.${name} must be an object`);
  const pairs = Object.entries(value);
  if (pairs.length > 20_000) throw new Error(`loreTimedState.${name} may contain at most 20000 effects`);
  const normalized: Array<[string, LoreTimedEffect]> = pairs.map(([key, effect]) => {
    if (key.length > 1_000 || !isRecord(effect)) throw new Error(`invalid loreTimedState.${name} effect`);
    const fingerprint = effect.fingerprint;
    const start = effect.start;
    const end = effect.end;
    if (
      !Number.isSafeInteger(fingerprint) || fingerprint < 0 ||
      !Number.isInteger(start) || start < 0 || start > 2_000_000 ||
      !Number.isInteger(end) || end < start || end > 2_000_000 ||
      typeof effect.protected !== 'boolean'
    ) {
      throw new Error(`invalid loreTimedState.${name} effect`);
    }
    return [key, { fingerprint, start, end, protected: effect.protected }];
  });
  return Object.fromEntries(normalized);
}

export function normalizeLoreTimedState(value: unknown): LoreTimedState {
  if (value === undefined || value === null) return emptyLoreTimedState();
  if (!isRecord(value)) throw new Error('loreTimedState must be an object');
  return {
    sticky: normalizeTimedEffects(value.sticky, 'sticky'),
    cooldown: normalizeTimedEffects(value.cooldown, 'cooldown')
  };
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extensionValue(entry: JsonObject, camel: string, snake: string): unknown {
  if (entry[camel] !== undefined) return entry[camel];
  return isRecord(entry.extensions) ? entry.extensions[snake] ?? entry.extensions[camel] : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeCharacterFilter(value: unknown): NormalizedLoreEntry['characterFilter'] {
  if (!isRecord(value)) return null;
  const names = stringArray(value.names);
  const tags = stringArray(value.tags);
  if (!names.length && !tags.length) return null;
  return { names, tags, isExclude: value.isExclude === true || value.is_exclude === true };
}

function normalizePosition(entry: JsonObject): number {
  const extensionPosition = isRecord(entry.extensions) ? entry.extensions.position : undefined;
  if (typeof extensionPosition === 'number' && Number.isFinite(extensionPosition)) return extensionPosition;
  if (typeof entry.position === 'number' && Number.isFinite(entry.position)) return entry.position;
  if (entry.position === 'after_char') return 1;
  return 0;
}

function parseLoreDecorators(content: string): { decorators: string[]; content: string } {
  const known = ['@@activate', '@@dont_activate'];
  if (!content.startsWith('@@')) return { decorators: [], content };
  const lines = content.split('\n');
  const decorators: string[] = [];
  let fallback = false;
  let stripped = content;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('@@')) {
      stripped = lines.slice(index).join('\n');
      break;
    }
    if (line.startsWith('@@@') && !fallback) continue;
    const candidate = line.startsWith('@@@') ? line.slice(1) : line;
    if (known.some((decorator) => candidate.startsWith(decorator))) {
      decorators.push(candidate);
      fallback = false;
    } else {
      fallback = true;
    }
  }
  return { decorators, content: stripped };
}

function normalizeEntry(value: unknown, id: string, index: number, format: LorebookFormat): NormalizedLoreEntry | null {
  if (!isRecord(value) || typeof value.content !== 'string') return null;
  const keys = stringArray(value.keys ?? value.key);
  const secondaryKeys = stringArray(value.secondary_keys ?? value.keysecondary);
  const rawLogic = finiteNumber(extensionValue(value, 'selectiveLogic', 'selective_logic'), 0);
  const rawRole = finiteNumber(extensionValue(value, 'role', 'role'), 0);
  const probability = Math.min(100, Math.max(0, finiteNumber(extensionValue(value, 'probability', 'probability'), 100)));
  const delayUntilRecursion = extensionValue(value, 'delayUntilRecursion', 'delay_until_recursion');
  const parsedContent = parseLoreDecorators(value.content);

  return {
    id: String(value.id ?? value.uid ?? id),
    name: typeof value.comment === 'string' && value.comment.trim()
      ? value.comment.trim()
      : typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : `Entry ${String(value.id ?? value.uid ?? id)}`,
    keys,
    secondaryKeys,
    content: parsedContent.content,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : value.disable !== true,
    constant: value.constant === true,
    selective: typeof value.selective === 'boolean' ? value.selective : false,
    selectiveLogic: rawLogic >= 0 && rawLogic <= 3 ? rawLogic as 0 | 1 | 2 | 3 : 0,
    insertionOrder: finiteNumber(value.insertion_order ?? value.order, 100),
    position: normalizePosition(value),
    depth: Math.max(0, Math.trunc(finiteNumber(extensionValue(value, 'depth', 'depth'), 4))),
    role: rawRole >= 0 && rawRole <= 2 ? rawRole as 0 | 1 | 2 : 0,
    probability,
    useProbability: extensionValue(value, 'useProbability', 'use_probability') !== false,
    useRegex: value.use_regex === true,
    scanDepth: nullableNumber(extensionValue(value, 'scanDepth', 'scan_depth')),
    caseSensitive: nullableBoolean(extensionValue(value, 'caseSensitive', 'case_sensitive')),
    matchWholeWords: nullableBoolean(extensionValue(value, 'matchWholeWords', 'match_whole_words')),
    excludeRecursion: extensionValue(value, 'excludeRecursion', 'exclude_recursion') === true,
    preventRecursion: extensionValue(value, 'preventRecursion', 'prevent_recursion') === true,
    delayUntilRecursion: delayUntilRecursion === true ? 1 : Math.max(0, Math.trunc(finiteNumber(delayUntilRecursion, 0))),
    ignoreBudget: extensionValue(value, 'ignoreBudget', 'ignore_budget') === true,
    group: stringValue(extensionValue(value, 'group', 'group')).trim(),
    groupOverride: extensionValue(value, 'groupOverride', 'group_override') === true,
    groupWeight: Math.max(0, finiteNumber(extensionValue(value, 'groupWeight', 'group_weight'), 100)),
    useGroupScoring: nullableBoolean(extensionValue(value, 'useGroupScoring', 'use_group_scoring')),
    outletName: stringValue(extensionValue(value, 'outletName', 'outlet_name')).trim(),
    triggers: stringArray(extensionValue(value, 'triggers', 'triggers')),
    decorators: parsedContent.decorators,
    matchPersonaDescription: extensionValue(value, 'matchPersonaDescription', 'match_persona_description') === true,
    matchCharacterDescription: extensionValue(value, 'matchCharacterDescription', 'match_character_description') === true,
    matchCharacterPersonality: extensionValue(value, 'matchCharacterPersonality', 'match_character_personality') === true,
    matchCharacterDepthPrompt: extensionValue(value, 'matchCharacterDepthPrompt', 'match_character_depth_prompt') === true,
    matchScenario: extensionValue(value, 'matchScenario', 'match_scenario') === true,
    matchCreatorNotes: extensionValue(value, 'matchCreatorNotes', 'match_creator_notes') === true,
    sticky: timedDuration(extensionValue(value, 'sticky', 'sticky')),
    cooldown: timedDuration(extensionValue(value, 'cooldown', 'cooldown')),
    delay: timedDuration(extensionValue(value, 'delay', 'delay')),
    characterFilter: normalizeCharacterFilter(value.characterFilter ?? extensionValue(value, 'characterFilter', 'character_filter')),
    raw: cloneJsonObject(value),
    sourceIndex: index
  };
}

function convertExternalLorebook(value: JsonObject): { source: JsonObject; format: LorebookFormat } | null {
  if (value.lorebookVersion !== undefined && Array.isArray(value.entries)) {
    return {
      format: 'novelai',
      source: {
        name: value.name,
        entries: value.entries.map((candidate, index) => {
          const entry = isRecord(candidate) ? candidate : {};
          const contextConfig = isRecord(entry.contextConfig) ? entry.contextConfig : {};
          return {
            uid: index,
            key: stringArray(entry.keys),
            keysecondary: [],
            comment: stringValue(entry.displayName),
            content: stringValue(entry.text),
            constant: false,
            selective: false,
            order: finiteNumber(contextConfig.budgetPriority, 0),
            position: 0,
            disable: entry.enabled === false,
            probability: 100,
            useProbability: true
          };
        })
      }
    };
  }

  if (value.kind === 'memory' && Array.isArray(value.entries)) {
    return {
      format: 'agnai',
      source: {
        name: value.name,
        entries: value.entries.map((candidate, index) => {
          const entry = isRecord(candidate) ? candidate : {};
          return {
            uid: index,
            key: stringArray(entry.keywords),
            keysecondary: [],
            comment: stringValue(entry.name),
            content: stringValue(entry.entry),
            constant: false,
            selective: false,
            order: finiteNumber(entry.weight, 0),
            position: 0,
            disable: entry.enabled === false,
            probability: 100,
            useProbability: true
          };
        })
      }
    };
  }

  if (value.type === 'risu' && Array.isArray(value.data)) {
    return {
      format: 'risu',
      source: {
        name: value.name,
        entries: value.data.map((candidate, index) => {
          const entry = isRecord(candidate) ? candidate : {};
          return {
            uid: index,
            key: stringValue(entry.key).split(',').map((key) => key.trim()).filter(Boolean),
            keysecondary: stringValue(entry.secondkey).split(',').map((key) => key.trim()).filter(Boolean),
            comment: stringValue(entry.comment),
            content: stringValue(entry.content),
            constant: entry.alwaysActive === true,
            selective: entry.selective === true,
            order: finiteNumber(entry.insertorder, 0),
            position: 0,
            disable: false,
            probability: finiteNumber(entry.activationPercent, 100),
            useProbability: entry.activationPercent !== undefined
          };
        })
      }
    };
  }

  return null;
}

export function normalizeLorebook(
  value: unknown,
  fallbackName = 'Imported lorebook',
  origin: LorebookOrigin = 'imported'
): ImportedLorebook {
  if (!isRecord(value)) throw new Error('lorebook must be a JSON object');
  const raw = cloneJsonObject(value);
  let source = value;
  let format: LorebookFormat;
  const converted = convertExternalLorebook(value);

  if (converted) {
    source = converted.source;
    format = converted.format;
  } else if (value.spec === 'lorebook_v3') {
    if (!isRecord(value.data)) throw new Error('lorebook_v3 field "data" must be an object');
    source = value.data;
    format = 'lorebook_v3';
  } else if (Array.isArray(value.entries)) {
    format = 'character_book';
  } else {
    format = 'sillytavern';
  }

  const entriesValue = source.entries;
  if (!Array.isArray(entriesValue) && !isRecord(entriesValue)) {
    throw new Error('lorebook field "entries" must be an array or object');
  }

  const pairs: Array<[string, unknown]> = Array.isArray(entriesValue)
    ? entriesValue.map((entry, index) => [String(index), entry])
    : Object.entries(entriesValue);
  const entries: NormalizedLoreEntry[] = [];
  const diagnostics: string[] = [];
  pairs.forEach(([id, candidate], index) => {
    const normalized = normalizeEntry(candidate, id, index, format);
    if (normalized) entries.push(normalized);
    else diagnostics.push(`Skipped malformed entry ${id}`);
  });

  const sourceName = typeof source.name === 'string' ? source.name.trim() : '';
  const rootName = typeof value.name === 'string' ? value.name.trim() : '';
  const name = sourceName || rootName || fallbackName.trim() || 'Imported lorebook';
  return { name, origin, format, entries, diagnostics, raw };
}

export function parseLorebookJson(
  json: string,
  fallbackName = 'Imported lorebook',
  origin: LorebookOrigin = 'imported'
): ImportedLorebook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('lorebook is not valid JSON');
  }
  return normalizeLorebook(parsed, fallbackName, origin);
}

function integerSetting(value: unknown, name: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function booleanSetting(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value;
}

export function resolveLorebookSettings(
  value: unknown,
  maxContextTokens = DEFAULT_LOREBOOK_SETTINGS.maxContextTokens
): LorebookSettings {
  if (value !== undefined && value !== null && !isRecord(value)) throw new Error('lorebookSettings must be an object');
  const input = isRecord(value) ? value : {};
  return {
    scanDepth: integerSetting(input.scanDepth, 'scanDepth', 0, 1000, DEFAULT_LOREBOOK_SETTINGS.scanDepth),
    minActivations: integerSetting(input.minActivations, 'minActivations', 0, 100, DEFAULT_LOREBOOK_SETTINGS.minActivations),
    minActivationsDepthMax: integerSetting(input.minActivationsDepthMax, 'minActivationsDepthMax', 0, 100, DEFAULT_LOREBOOK_SETTINGS.minActivationsDepthMax),
    budgetPercent: integerSetting(input.budgetPercent, 'budgetPercent', 1, 100, DEFAULT_LOREBOOK_SETTINGS.budgetPercent),
    includeNames: booleanSetting(input.includeNames, 'includeNames', DEFAULT_LOREBOOK_SETTINGS.includeNames),
    recursive: booleanSetting(input.recursive, 'recursive', DEFAULT_LOREBOOK_SETTINGS.recursive),
    caseSensitive: booleanSetting(input.caseSensitive, 'caseSensitive', DEFAULT_LOREBOOK_SETTINGS.caseSensitive),
    matchWholeWords: booleanSetting(input.matchWholeWords, 'matchWholeWords', DEFAULT_LOREBOOK_SETTINGS.matchWholeWords),
    maxContextTokens: integerSetting(maxContextTokens, 'maxContextTokens', 1, 2_000_000, DEFAULT_LOREBOOK_SETTINGS.maxContextTokens),
    budgetCap: integerSetting(input.budgetCap, 'budgetCap', 0, 65_536, DEFAULT_LOREBOOK_SETTINGS.budgetCap),
    maxRecursionSteps: integerSetting(input.maxRecursionSteps, 'maxRecursionSteps', 0, 10, DEFAULT_LOREBOOK_SETTINGS.maxRecursionSteps),
    useGroupScoring: booleanSetting(input.useGroupScoring, 'useGroupScoring', DEFAULT_LOREBOOK_SETTINGS.useGroupScoring)
  };
}

export function lorePromptContextTokens(modelContextTokens: number, responseTokenLimit: number): number {
  if (!Number.isInteger(modelContextTokens) || modelContextTokens < 1) {
    throw new Error('modelContextTokens must be a positive integer');
  }
  if (!Number.isInteger(responseTokenLimit) || responseTokenLimit < 1) {
    throw new Error('responseTokenLimit must be a positive integer');
  }
  return Math.max(1, modelContextTokens - responseTokenLimit);
}

function regexFromSlashNotation(value: string): { source: string; flags: string } | null {
  const match = value.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (!match || match[1].match(/(^|[^\\])\//)) return null;
  return { source: match[1].replace('\\/', '/'), flags: match[2] };
}

async function matchesKey(
  haystack: string,
  key: string,
  entry: NormalizedLoreEntry,
  settings: LorebookSettings,
  regexTest: NonNullable<ScanOptions['regexTest']>
): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const slashRegex = regexFromSlashNotation(trimmed);
  if (slashRegex) {
    const result = await regexTest(slashRegex.source, slashRegex.flags, haystack);
    if (!result.invalid) return result.matched;
  }

  const caseSensitive = entry.caseSensitive ?? settings.caseSensitive;
  const transformedHaystack = caseSensitive ? haystack : haystack.toLowerCase();
  const transformedKey = caseSensitive ? trimmed : trimmed.toLowerCase();
  const wholeWords = entry.matchWholeWords ?? settings.matchWholeWords;
  if (!wholeWords || /\s/.test(transformedKey)) return transformedHaystack.includes(transformedKey);
  const escaped = transformedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(transformedHaystack);
}

async function entryMatches(
  haystack: string,
  entry: NormalizedLoreEntry,
  settings: LorebookSettings,
  substitute: (value: string) => string,
  regexTest: NonNullable<ScanOptions['regexTest']>
): Promise<boolean> {
  if (entry.constant) return true;
  if (!entry.keys.length) return false;
  let primary = false;
  for (const key of entry.keys) {
    if (await matchesKey(haystack, substitute(key), entry, settings, regexTest)) {
      primary = true;
      break;
    }
  }
  if (!primary) return false;
  if (!entry.selective || !entry.secondaryKeys.length) return true;

  const matches: boolean[] = [];
  for (const key of entry.secondaryKeys) {
    matches.push(await matchesKey(haystack, substitute(key), entry, settings, regexTest));
  }
  if (entry.selectiveLogic === 0) return matches.some(Boolean);
  if (entry.selectiveLogic === 1) return !matches.every(Boolean);
  if (entry.selectiveLogic === 2) return !matches.some(Boolean);
  return matches.every(Boolean);
}

function estimateTokensForTests(value: string): number {
  return Math.ceil(new TextEncoder().encode(value).byteLength / 4);
}

function groupNames(entry: NormalizedLoreEntry): string[] {
  return entry.group.split(/,\s*/).map((group) => group.trim()).filter(Boolean);
}

type Candidate = {
  book: ImportedLorebook;
  bookIndex: number;
  entry: NormalizedLoreEntry;
  identity: string;
  timedKey: string;
  fingerprint: number;
  score: number;
};

function getStringHash(value: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2_654_435_761);
    h2 = Math.imul(h2 ^ code, 1_597_334_677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_269_909_909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_269_909_909);
  return 4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0);
}

function timedFingerprint(book: ImportedLorebook, entry: NormalizedLoreEntry): number {
  return getStringHash(JSON.stringify({
    ...entry.raw,
    world: book.name,
    uid: entry.id,
    decorators: entry.decorators,
    content: entry.content
  }));
}

type TimedRuntime = {
  state: LoreTimedState;
  sticky: Set<string>;
  cooldown: Set<string>;
  delay: Set<string>;
};

function prepareTimedRuntime(candidates: Candidate[], input: unknown, messageCount: number): TimedRuntime {
  const state = normalizeLoreTimedState(input);
  const byKey = new Map(candidates.map((candidate) => [candidate.timedKey, candidate]));
  const sticky = new Set<string>();
  const cooldown = new Set<string>();
  const delay = new Set(candidates.filter(({ entry }) => entry.delay > 0 && messageCount < entry.delay).map(({ timedKey }) => timedKey));

  for (const [key, effect] of Object.entries(state.sticky)) {
    const candidate = byKey.get(key);
    if (messageCount <= effect.start && !effect.protected) {
      delete state.sticky[key];
      continue;
    }
    if (!candidate || candidate.fingerprint !== effect.fingerprint) {
      if (messageCount >= effect.end) delete state.sticky[key];
      continue;
    }
    if (!candidate.entry.sticky) {
      delete state.sticky[key];
      continue;
    }
    if (messageCount >= effect.end) {
      delete state.sticky[key];
      if (candidate.entry.cooldown) {
        state.cooldown[key] = {
          fingerprint: candidate.fingerprint,
          start: messageCount,
          end: messageCount + candidate.entry.cooldown,
          protected: true
        };
      }
      continue;
    }
    sticky.add(key);
  }

  for (const [key, effect] of Object.entries(state.cooldown)) {
    const candidate = byKey.get(key);
    if (messageCount <= effect.start && !effect.protected) {
      delete state.cooldown[key];
      continue;
    }
    if (!candidate || candidate.fingerprint !== effect.fingerprint) {
      if (messageCount >= effect.end) delete state.cooldown[key];
      continue;
    }
    if (!candidate.entry.cooldown) {
      delete state.cooldown[key];
      continue;
    }
    if (messageCount >= effect.end) {
      delete state.cooldown[key];
      continue;
    }
    cooldown.add(key);
  }

  return { state, sticky, cooldown, delay };
}

function setTimedEffects(runtime: TimedRuntime, activated: Candidate[], messageCount: number): void {
  for (const candidate of activated) {
    const { entry, timedKey, fingerprint } = candidate;
    if (entry.sticky && !runtime.state.sticky[timedKey]) {
      runtime.state.sticky[timedKey] = {
        fingerprint,
        start: messageCount,
        end: messageCount + entry.sticky,
        protected: false
      };
    }
    if (entry.cooldown && !runtime.state.cooldown[timedKey]) {
      runtime.state.cooldown[timedKey] = {
        fingerprint,
        start: messageCount,
        end: messageCount + entry.cooldown,
        protected: false
      };
    }
  }
}

function filterInclusionGroups(
  candidates: Candidate[],
  activatedGroups: Set<string>,
  random: () => number,
  useGroupScoring: boolean,
  timed: TimedRuntime
): Candidate[] {
  const survivors = new Set(candidates);
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    for (const group of groupNames(candidate.entry)) {
      const members = groups.get(group) ?? [];
      members.push(candidate);
      groups.set(group, members);
    }
  }

  for (const [group, members] of groups) {
    let available = members.filter((member) => survivors.has(member));
    const stickyMembers = available.filter((member) => timed.sticky.has(member.timedKey));
    if (stickyMembers.length > 0) {
      available.filter((member) => !timed.sticky.has(member.timedKey)).forEach((member) => survivors.delete(member));
      continue;
    }
    available.filter((member) => timed.cooldown.has(member.timedKey) || timed.delay.has(member.timedKey))
      .forEach((member) => survivors.delete(member));
    available = available.filter((member) => survivors.has(member));
    if (activatedGroups.has(group)) {
      available.forEach((member) => survivors.delete(member));
      continue;
    }
    if (available.length <= 1) continue;

    if (useGroupScoring || available.some((member) => member.entry.useGroupScoring === true)) {
      const maximumScore = Math.max(...available.map((member) => member.score));
      for (const member of available) {
        const scored = member.entry.useGroupScoring ?? useGroupScoring;
        if (scored && member.score < maximumScore) survivors.delete(member);
      }
      available = available.filter((member) => survivors.has(member));
      if (available.length <= 1) continue;
    }

    const override = available.filter((member) => member.entry.groupOverride)
      .sort((a, b) => b.entry.insertionOrder - a.entry.insertionOrder)[0];
    let winner: Candidate = override ?? available[0]!;
    if (!override) {
      const totalWeight = available.reduce((total, member) => total + member.entry.groupWeight, 0);
      let roll = random() * totalWeight;
      winner = available.at(-1)!;
      for (const member of available) {
        roll -= member.entry.groupWeight;
        if (roll <= 0) {
          winner = member;
          break;
        }
      }
    }
    available.forEach((member) => {
      if (member !== winner) survivors.delete(member);
    });
  }
  return candidates.filter((candidate) => survivors.has(candidate));
}

async function entryMatchScore(
  haystack: string,
  entry: NormalizedLoreEntry,
  settings: LorebookSettings,
  substitute: (value: string) => string,
  regexTest: NonNullable<ScanOptions['regexTest']>
): Promise<number> {
  if (!entry.keys.length) return 0;
  let primary = 0;
  let secondary = 0;
  for (const key of entry.keys) primary += await matchesKey(haystack, substitute(key), entry, settings, regexTest) ? 1 : 0;
  for (const key of entry.secondaryKeys) secondary += await matchesKey(haystack, substitute(key), entry, settings, regexTest) ? 1 : 0;
  if (entry.selectiveLogic === 0) return primary + secondary;
  if (entry.selectiveLogic === 3 && secondary === entry.secondaryKeys.length) return primary + secondary;
  return primary;
}

function scanText(
  historyNewestFirst: string[],
  entry: NormalizedLoreEntry,
  settings: LorebookSettings,
  recursion: string[],
  scanDepthSkew: number,
  includeRecursion: boolean,
  options: ScanOptions
): string {
  const depth = Math.max(0, Math.min(1000, Math.trunc(entry.scanDepth ?? settings.scanDepth + scanDepthSkew)));
  if (depth === 0) return '';
  const buffer = historyNewestFirst.slice(0, depth);
  const card = options.card;
  if (entry.matchPersonaDescription) buffer.push(options.personaDescription ?? '');
  if (card && entry.matchCharacterDescription) buffer.push(card.data.description);
  if (card && entry.matchCharacterPersonality) buffer.push(card.data.personality);
  if (entry.matchCharacterDepthPrompt) buffer.push(options.characterDepthPrompt ?? '');
  if (card && entry.matchScenario) buffer.push(card.data.scenario);
  if (card && entry.matchCreatorNotes) buffer.push(card.data.creatorNotes);
  buffer.push(...(options.scanInjections ?? []));
  if (includeRecursion) buffer.push(...recursion);
  return buffer.filter(Boolean).join('\n\x01');
}

function characterFilterAllows(entry: NormalizedLoreEntry, options: ScanOptions): boolean {
  const filter = entry.characterFilter;
  if (!filter) return true;
  const currentNames = new Set(options.characterFilterNames ?? []);
  const currentTags = new Set(options.characterTags ?? []);
  if (filter.names.length > 0) {
    const included = filter.names.some((name) => currentNames.has(name));
    if (filter.isExclude ? included : !included) return false;
  }
  if (filter.tags.length > 0) {
    const included = filter.tags.some((tag) => currentTags.has(tag));
    if (filter.isExclude ? included : !included) return false;
  }
  return true;
}

type ScanState = 'initial' | 'recursion' | 'min_activations';

export async function scanLorebooks(
  books: ImportedLorebook[],
  history: ChatMessage[],
  settingsInput: LorebookSettings | unknown = DEFAULT_LOREBOOK_SETTINGS,
  options: ScanOptions = {}
): Promise<LoreScanResult> {
  const contextTokens = isRecord(settingsInput) && typeof settingsInput.maxContextTokens === 'number'
    ? settingsInput.maxContextTokens
    : DEFAULT_LOREBOOK_SETTINGS.maxContextTokens;
  const settings = resolveLorebookSettings(settingsInput, contextTokens);
  const tokenCount = options.tokenCount ?? estimateTokensForTests;
  const regexTest = options.regexTest ?? (() => {
    throw new Error('regex sandbox is required for regex lore keys');
  });
  const generationTrigger = options.generationTrigger?.trim() || 'normal';
  const random = options.random ?? Math.random;
  const userName = options.userName?.trim() || 'You';
  const assistantName = options.card?.data.nickname || options.card?.data.name || options.assistantName?.trim() || 'Assistant';
  const substitute = (value: string) => substituteCardMacros(value, assistantName, userName);
  const historyNewestFirst = [...history].reverse().map((message) => {
    if (!settings.includeNames) return message.content;
    const name = message.role === 'user' ? userName : message.role === 'assistant' ? assistantName : 'System';
    return `${name}: ${message.content}`;
  });

  const candidates: Candidate[] = books.flatMap((book, bookIndex) => book.entries.map((entry) => ({
    book,
    bookIndex,
    entry,
    identity: `${bookIndex}:${entry.id}`,
    timedKey: JSON.stringify([book.name, entry.id]),
    fingerprint: timedFingerprint(book, entry),
    score: 0
  })))
    .sort((a, b) => b.entry.insertionOrder - a.entry.insertionOrder
      || (a.book.origin === b.book.origin ? 0 : a.book.origin === 'embedded' ? -1 : 1)
      || a.bookIndex - b.bookIndex
      || a.entry.sourceIndex - b.entry.sourceIndex);
  let budgetTokens = Math.round(settings.budgetPercent * settings.maxContextTokens / 100) || 1;
  if (settings.budgetCap > 0) budgetTokens = Math.min(budgetTokens, settings.budgetCap);
  const timed = prepareTimedRuntime(candidates, options.timedState, history.length);

  const activated = new Map<string, { candidate: Candidate; book: ImportedLorebook; entry: NormalizedLoreEntry; content: string }>();
  const activatedGroups = new Set<string>();
  const failedProbabilityChecks = new Set<string>();
  const recursion: string[] = [];
  const skipped: string[] = books.flatMap((book) => book.diagnostics.map((diagnostic) => `${book.name}: ${diagnostic}`));
  const recursionDelayLevels = [...new Set(candidates.map(({ entry }) => entry.delayUntilRecursion).filter(Boolean))]
    .sort((a, b) => a - b);
  let currentRecursionDelayLevel = recursionDelayLevels.shift() ?? 0;
  let allActivatedText = '';
  let budgetOverflowed = false;
  let iteration = 0;
  let scanState: ScanState = 'initial';
  let scanDepthSkew = 0;

  while (true) {
    if (settings.maxRecursionSteps > 0 && iteration >= settings.maxRecursionSteps) break;
    iteration += 1;
    let matched: Candidate[] = [];

    for (const candidate of candidates) {
      const { book, entry } = candidate;
      if (activated.has(candidate.identity) || failedProbabilityChecks.has(candidate.identity) || !entry.enabled) continue;
      if (entry.triggers.length > 0 && !entry.triggers.includes(generationTrigger)) continue;
      if (!characterFilterAllows(entry, options)) continue;
      const isSticky = timed.sticky.has(candidate.timedKey);
      if (timed.delay.has(candidate.timedKey)) continue;
      if (timed.cooldown.has(candidate.timedKey) && !isSticky) continue;
      if (scanState !== 'recursion' && entry.delayUntilRecursion > 0 && !isSticky) continue;
      if (scanState === 'recursion' && entry.delayUntilRecursion > currentRecursionDelayLevel && !isSticky) continue;
      if (scanState === 'recursion' && settings.recursive && entry.excludeRecursion && !isSticky) continue;
      if (entry.decorators.includes('@@activate')) {
        const haystack = scanText(historyNewestFirst, entry, settings, recursion, scanDepthSkew, scanState !== 'min_activations', options);
        candidate.score = await entryMatchScore(haystack, entry, settings, substitute, regexTest);
        matched.push(candidate);
        continue;
      }
      if (entry.decorators.includes('@@dont_activate')) continue;
      if (isSticky) {
        candidate.score = 0;
        matched.push(candidate);
        continue;
      }
      const haystack = scanText(historyNewestFirst, entry, settings, recursion, scanDepthSkew, scanState !== 'min_activations', options);
      if (!await entryMatches(haystack, entry, settings, substitute, regexTest)) continue;
      candidate.score = await entryMatchScore(haystack, entry, settings, substitute, regexTest);
      matched.push(candidate);
    }

    matched.sort((a, b) => Number(timed.sticky.has(b.timedKey)) - Number(timed.sticky.has(a.timedKey)));
    matched = filterInclusionGroups(matched, activatedGroups, random, settings.useGroupScoring, timed);
    const priorTokens = await tokenCount(allActivatedText);
    let newContent = '';
    let remainingBudgetIgnored = matched.filter(({ entry }) => entry.ignoreBudget).length;
    const newRecursion: string[] = [];

    for (const candidate of matched) {
      const { book, entry } = candidate;
      remainingBudgetIgnored -= entry.ignoreBudget ? 1 : 0;
      if (budgetOverflowed && !entry.ignoreBudget) {
        if (remainingBudgetIgnored > 0) continue;
        break;
      }
      if (!timed.sticky.has(candidate.timedKey) && entry.useProbability && entry.probability < 100 && random() * 100 > entry.probability) {
        failedProbabilityChecks.add(candidate.identity);
        continue;
      }

      const content = substitute(entry.content).trim();
      newContent += `${content}\n`;
      if (!entry.ignoreBudget && priorTokens + await tokenCount(newContent) >= budgetTokens) {
        budgetOverflowed = true;
        skipped.push(`${book.name}: ${entry.name} exceeded the ${budgetTokens}-token lore budget`);
        continue;
      }

      activated.set(candidate.identity, { candidate, book, entry, content });
      groupNames(entry).forEach((group) => activatedGroups.add(group));
      if (!entry.preventRecursion && content) newRecursion.push(content);
    }

    let nextScanState: ScanState | null = settings.recursive && !budgetOverflowed && newRecursion.length > 0
      ? 'recursion'
      : null;
    if (!nextScanState && settings.recursive && !budgetOverflowed && scanState === 'min_activations' && recursion.length > 0) {
      nextScanState = 'recursion';
    }
    const scanDepth = settings.scanDepth + scanDepthSkew;
    const minActivationsNotSatisfied = settings.minActivations > 0 && activated.size < settings.minActivations;
    const minActivationDepthAvailable = (settings.minActivationsDepthMax === 0 || scanDepth <= settings.minActivationsDepthMax)
      && scanDepth <= historyNewestFirst.length;
    if (!nextScanState && !budgetOverflowed && minActivationsNotSatisfied && minActivationDepthAvailable) {
      scanDepthSkew += 1;
      nextScanState = 'min_activations';
    }
    if (!nextScanState && !budgetOverflowed && recursionDelayLevels.length > 0) {
      currentRecursionDelayLevel = recursionDelayLevels.shift() ?? currentRecursionDelayLevel;
      nextScanState = 'recursion';
    }
    if (!nextScanState) break;
    scanState = nextScanState;
    if (newRecursion.length) {
      recursion.push(...newRecursion);
      allActivatedText = `${newRecursion.join('\n')}\n${allActivatedText}`;
    }
  }

  const beforeCharacter: string[] = [];
  setTimedEffects(timed, [...activated.values()].map(({ candidate }) => candidate), history.length);
  const afterCharacter: string[] = [];
  const authorNoteBefore: string[] = [];
  const authorNoteAfter: string[] = [];
  const examplesBefore: string[] = [];
  const examplesAfter: string[] = [];
  const depth: LoreDepthInjection[] = [];
  const outlets: Record<string, string[]> = {};
  const activatedReport: LoreActivation[] = [];
  [...activated.values()].sort((a, b) => b.entry.insertionOrder - a.entry.insertionOrder).forEach(({ book, entry, content }) => {
    activatedReport.push({ book: book.name, entryId: entry.id, name: entry.name });
    if (!content) return;
    if (entry.position === 0) beforeCharacter.unshift(content);
    else if (entry.position === 1) afterCharacter.unshift(content);
    else if (entry.position === 2) authorNoteBefore.unshift(content);
    else if (entry.position === 3) authorNoteAfter.unshift(content);
    else if (entry.position === 4) {
      const existing = depth.find((injection) => injection.depth === entry.depth && injection.role === entry.role);
      if (existing) existing.content = `${content}\n${existing.content}`;
      else depth.push({ depth: entry.depth, role: entry.role, content });
    }
    else if (entry.position === 5) examplesBefore.unshift(content);
    else if (entry.position === 6) examplesAfter.unshift(content);
    else if (entry.position === 7 && entry.outletName) (outlets[entry.outletName] ??= []).push(content);
    else if (entry.position === 7) skipped.push(`${book.name}: ${entry.name} has no outlet name`);
    else skipped.push(`${book.name}: ${entry.name} uses unsupported position ${entry.position}`);
  });

  const usedTokens = await tokenCount([...activated.values()].map(({ content }) => content).join('\n'));
  return {
    beforeCharacter,
    afterCharacter,
    authorNoteBefore,
    authorNoteAfter,
    examplesBefore,
    examplesAfter,
    depth,
    outlets,
    activated: activatedReport,
    skipped,
    budgetTokens,
    usedTokens,
    timedState: timed.state
  };
}

function roleFromNumber(role: 0 | 1 | 2): ChatMessage['role'] {
  return role === 1 ? 'user' : role === 2 ? 'assistant' : 'system';
}

export function injectLoreDepth(history: ChatMessage[], depthEntries: LoreDepthInjection[]): ChatMessage[] {
  const result = [...history];
  [...depthEntries].sort((a, b) => b.depth - a.depth).forEach((entry) => {
    const index = Math.max(0, result.length - entry.depth);
    result.splice(index, 0, { role: roleFromNumber(entry.role), content: entry.content });
  });
  return result;
}

export function injectLoreContext(
  history: ChatMessage[],
  result: LoreScanResult,
  authorNoteSettings: AuthorNoteSettings = DEFAULT_AUTHOR_NOTE_SETTINGS
): ChatMessage[] {
  const interval = Number.isInteger(authorNoteSettings.interval) ? authorNoteSettings.interval : 1;
  const userMessageCount = history.filter((message) => message.role === 'user').length;
  const authorNoteFires = authorNoteSettings.enabled !== false
    && interval > 0
    && userMessageCount > 0
    && (interval === 1 || userMessageCount % interval === 0);
  const authorNote = authorNoteFires
    ? [
      ...result.authorNoteBefore,
      authorNoteSettings.prompt,
      ...result.authorNoteAfter
    ].filter(Boolean).join('\n')
    : '';
  const depth = authorNote
    ? [...result.depth, { depth: authorNoteSettings.depth, role: authorNoteSettings.role, content: authorNote }]
    : result.depth;
  return injectLoreDepth(history, depth);
}

export function compileUnboundLoreMessages(history: ChatMessage[], result: LoreScanResult): ChatMessage[] {
  const context: ChatMessage[] = [];
  if (result.beforeCharacter.length) context.push({ role: 'system', content: result.beforeCharacter.join('\n') });
  if (result.afterCharacter.length) context.push({ role: 'system', content: result.afterCharacter.join('\n') });
  if (result.examplesBefore.length) context.push({ role: 'system', content: result.examplesBefore.join('\n') });
  if (result.examplesAfter.length) context.push({ role: 'system', content: result.examplesAfter.join('\n') });
  return [...context, ...injectLoreContext(history, result)];
}
