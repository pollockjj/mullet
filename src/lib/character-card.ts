export type CharacterCardVersion = 1 | 2 | 3;

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type JsonObject = Record<string, unknown>;

export type NormalizedCharacterData = {
  name: string;
  nickname: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  groupOnlyGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
  extensions: JsonObject;
  characterBook?: unknown;
};

export type ImportedCharacterCard = {
  version: CharacterCardVersion;
  spec: 'chara_card_v1' | 'chara_card_v2' | 'chara_card_v3';
  specVersion: string;
  data: NormalizedCharacterData;
  raw: JsonObject;
};

export type CharacterPromptInjections = {
  beforeCharacter?: string[];
  afterCharacter?: string[];
  examplesBefore?: string[];
  examplesAfter?: string[];
  outlets?: Record<string, string[]>;
};

export type CharacterDepthPrompt = {
  content: string;
  depth: number;
  role: ChatRole;
};

export const DEFAULT_MAIN_PROMPT = "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.";

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function requireLegacyString(card: JsonObject, field: string): void {
  if (typeof card[field] !== 'string') throw new Error(`character card field "${field}" must be a string`);
}

function validateV2Data(data: JsonObject): void {
  const stringFields = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'creator_notes',
    'system_prompt',
    'post_history_instructions',
    'creator',
    'character_version'
  ];
  for (const field of stringFields) {
    if (typeof data[field] !== 'string') throw new Error(`V2 character card field "data.${field}" must be a string`);
  }
  for (const field of ['alternate_greetings', 'tags']) {
    if (!Array.isArray(data[field]) || !data[field].every((item) => typeof item === 'string')) {
      throw new Error(`V2 character card field "data.${field}" must be an array of strings`);
    }
  }
  if (!isRecord(data.extensions)) throw new Error('V2 character card field "data.extensions" must be an object');

  if (data.character_book !== undefined) {
    if (!isRecord(data.character_book)) throw new Error('V2 character card field "data.character_book" must be an object');
    if (!Array.isArray(data.character_book.entries)) {
      throw new Error('V2 character card field "data.character_book.entries" must be an array');
    }
    if (!isRecord(data.character_book.extensions)) {
      throw new Error('V2 character card field "data.character_book.extensions" must be an object');
    }
  }
}

function normalizeData(source: JsonObject): NormalizedCharacterData {
  const extensions = isRecord(source.extensions) ? cloneJsonObject(source.extensions) : {};

  return {
    name: stringValue(source.name).trim(),
    nickname: stringValue(source.nickname).trim(),
    description: stringValue(source.description),
    personality: stringValue(source.personality),
    scenario: stringValue(source.scenario),
    firstMes: stringValue(source.first_mes),
    mesExample: stringValue(source.mes_example),
    creatorNotes: stringValue(source.creator_notes),
    systemPrompt: stringValue(source.system_prompt),
    postHistoryInstructions: stringValue(source.post_history_instructions),
    alternateGreetings: stringArray(source.alternate_greetings),
    groupOnlyGreetings: stringArray(source.group_only_greetings),
    tags: stringArray(source.tags),
    creator: stringValue(source.creator),
    characterVersion: stringValue(source.character_version),
    extensions,
    ...(source.character_book === undefined ? {} : { characterBook: source.character_book })
  };
}

export function normalizeCharacterCard(value: unknown): ImportedCharacterCard {
  if (!isRecord(value)) throw new Error('character card must be a JSON object');

  const raw = cloneJsonObject(value);
  const spec = typeof value.spec === 'string' ? value.spec : '';
  let version: CharacterCardVersion;
  let normalizedSpec: ImportedCharacterCard['spec'];
  let specVersion: string;
  let source: JsonObject;

  if (spec === 'chara_card_v2') {
    if (value.spec_version !== '2.0') throw new Error('V2 character card spec_version must be "2.0"');
    if (!isRecord(value.data)) throw new Error('V2 character card field "data" must be an object');
    validateV2Data(value.data);
    version = 2;
    normalizedSpec = 'chara_card_v2';
    specVersion = '2.0';
    source = value.data;
  } else if (spec === 'chara_card_v3') {
    const parsedVersion = Number(value.spec_version);
    if (!Number.isFinite(parsedVersion) || parsedVersion < 3 || parsedVersion >= 4) {
      throw new Error('V3 character card spec_version must be in the 3.x range');
    }
    if (!isRecord(value.data)) throw new Error('V3 character card field "data" must be an object');
    version = 3;
    normalizedSpec = 'chara_card_v3';
    specVersion = String(value.spec_version);
    source = value.data;
  } else if (spec) {
    throw new Error(`unsupported character card spec "${spec}"`);
  } else {
    for (const field of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example']) {
      requireLegacyString(value, field);
    }
    version = 1;
    normalizedSpec = 'chara_card_v1';
    specVersion = '1.0';
    source = value;
  }

  const data = normalizeData(source);
  if (!data.name) throw new Error('character card field "name" must not be empty');

  return { version, spec: normalizedSpec, specVersion, data, raw };
}

export function parseCharacterCardJson(json: string): ImportedCharacterCard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('character card is not valid JSON');
  }
  return normalizeCharacterCard(parsed);
}

export function substituteCardMacros(value: string, characterName: string, userName = 'You'): string {
  return value
    .replace(/{{\s*charIfNotGroup\s*}}/gi, characterName)
    .replace(/{{\s*char\s*}}/gi, characterName)
    .replace(/<(?:char|bot)>/gi, characterName)
    .replace(/{{\s*user\s*}}/gi, userName)
    .replace(/<user>/gi, userName);
}

export function characterSourceIdentifier(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

export function firstCharacterMessage(card: ImportedCharacterCard, userName = 'You'): string {
  return substituteCardMacros(card.data.firstMes, card.data.nickname || card.data.name, userName);
}

export function splitMessageExamples(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || /^<START>$/i.test(trimmed)) return [];
  return trimmed
    .split(/<START>/gi)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function characterDepthPrompt(
  card: ImportedCharacterCard,
  userName = 'You'
): CharacterDepthPrompt | null {
  const value = card.data.extensions.depth_prompt;
  if (!isRecord(value) || typeof value.prompt !== 'string' || !value.prompt.trim()) return null;
  const characterName = card.data.nickname || card.data.name;
  const rawDepth = typeof value.depth === 'number' && Number.isFinite(value.depth) ? value.depth : 4;
  const depth = Math.max(0, Math.min(1000, Math.trunc(rawDepth)));
  const role: ChatRole = value.role === 'user' || value.role === 'assistant' ? value.role : 'system';
  return {
    content: substituteCardMacros(value.prompt.trim(), characterName, userName),
    depth,
    role
  };
}

function injectCharacterDepthPrompt(
  history: ChatMessage[],
  prompt: CharacterDepthPrompt | null
): ChatMessage[] {
  if (!prompt) return history;
  const result = [...history];
  result.splice(Math.max(0, result.length - prompt.depth), 0, { role: prompt.role, content: prompt.content });
  return result;
}

export function compileCharacterMessages(
  card: ImportedCharacterCard,
  history: ChatMessage[],
  userName = 'You',
  injections: CharacterPromptInjections = {}
): ChatMessage[] {
  const characterName = card.data.nickname || card.data.name;
  const substitute = (value: string) => substituteCardMacros(value, characterName, userName)
    .replace(/{{outlet::(.+?)}}/gi, (_match, key: string) => injections.outlets?.[key.trim()]?.join('\n') ?? '');
  const mainPrompt = substitute(card.data.systemPrompt.trim() || DEFAULT_MAIN_PROMPT);
  const context = [mainPrompt];
  const preparedHistory = injectCharacterDepthPrompt(history, characterDepthPrompt(card, userName));

  context.push(...(injections.beforeCharacter ?? []).filter((value) => value.trim()));
  if (card.data.description.trim()) context.push(`[Character description]\n${substitute(card.data.description)}`);
  if (card.data.personality.trim()) context.push(`[Character personality]\n${substitute(card.data.personality)}`);
  if (card.data.scenario.trim()) context.push(`[Scenario]\n${substitute(card.data.scenario)}`);
  context.push(...(injections.afterCharacter ?? []).filter((value) => value.trim()));
  const exampleMessages: ChatMessage[] = [
    ...(injections.examplesBefore ?? []).filter((value) => value.trim()).map((content) => ({ role: 'system' as const, content })),
    ...splitMessageExamples(substitute(card.data.mesExample)).map((example) => ({
      role: 'system' as const,
      content: `[Example dialogue]\n${example}`
    })),
    ...(injections.examplesAfter ?? []).filter((value) => value.trim()).map((content) => ({ role: 'system' as const, content }))
  ];
  const compiled: ChatMessage[] = [
    { role: 'system', content: context.join('\n\n') },
    ...exampleMessages,
    ...preparedHistory
  ];
  if (card.data.postHistoryInstructions.trim()) {
    compiled.push({ role: 'system', content: substitute(card.data.postHistoryInstructions) });
  }
  return compiled;
}

export function embeddedLoreEntryCount(card: ImportedCharacterCard): number {
  const book = card.data.characterBook;
  return isRecord(book) && Array.isArray(book.entries) ? book.entries.length : 0;
}
