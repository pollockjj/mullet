import {
  normalizeCharacterCard,
  substituteCardMacros,
  type ImportedCharacterCard,
  type JsonObject
} from './character-card.ts';
import { normalizeLorebook, type ImportedLorebook } from './lorebook.ts';
import {
  PORTRAIT_TEMPLATE_ID,
  isPortraitLoraName,
  isPortraitModelTemplate,
  isPortraitReferenceTemplateId,
  type PortraitModelTemplate,
  type PortraitReferenceImage
} from './portrait.ts';
import { isExpressionLabel, type ExpressionLabel } from './sidecar.ts';

export const SCENARIO_CATALOG_SPEC = 'mullet_scenario_catalog_v2' as const;
export const SCENARIO_STARTERS_SPEC = 'mullet_scenario_starters_v1' as const;

export type ScenarioCatalogStarter = {
  id: string;
  label: string;
};

export type ScenarioCatalogEntry = {
  id: string;
  version: string;
  title: string;
  summary: string;
  card: string;
  lorebook: string;
  starters: ScenarioCatalogStarter[];
};

export type ScenarioCatalog = {
  spec: typeof SCENARIO_CATALOG_SPEC;
  scenarios: ScenarioCatalogEntry[];
};

export type ScenarioPackage = {
  entry: ScenarioCatalogEntry;
  card: ImportedCharacterCard;
  lorebook: ImportedLorebook;
  portraitCast: ScenarioPortraitCast;
  starters: ScenarioStarters;
};

export type ScenarioStarter = {
  id: string;
  label: string;
  title: string;
  summary: string;
  greetingIndex: number;
  portraitProfileId: string;
};

export type ScenarioStarters = {
  spec: typeof SCENARIO_STARTERS_SPEC;
  defaultStarterId: string;
  starters: ScenarioStarter[];
};

export type ScenarioPortraitProfile = {
  id: string;
  displayName: string;
  aliases: string[];
  subject: string;
  attire: string;
  setting: string;
  seed: number;
  expressionPrompts: Partial<Record<ExpressionLabel, string>>;
  modelTemplate: PortraitModelTemplate;
  subjectLora: ScenarioPortraitSubjectLora | null;
  referenceImage: PortraitReferenceImage;
  bodyReferenceImage: PortraitReferenceImage | null;
  fingerprint: string;
};

export type ScenarioPortraitSubjectLora = {
  name: string;
  trigger: string;
  sha256: string;
};

export type ScenarioPortraitCast = {
  spec: 'mullet_portrait_cast_v2';
  defaultProfileId: string;
  profiles: ScenarioPortraitProfile[];
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${field} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function scenarioAsset(value: unknown, field: string): string {
  const asset = requiredString(value, field, 200);
  if (asset.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(asset)) {
    throw new Error(`${field} must be a safe JSON filename`);
  }
  return asset;
}

function deepEqualJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqualJson(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && deepEqualJson(left[key], right[key]));
}

function profileFingerprint(fields: readonly string[]): string {
  const bytes = new TextEncoder().encode(fields.join('\u001f'));
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function greatestCommonDivisor(left: number, right: number): number {
  let dividend = left;
  let divisor = right;
  while (divisor !== 0) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }
  return dividend;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return Number(value);
}

function normalizeScenarioPortraitReference(
  value: unknown,
  index: number,
  fieldName: 'reference_image' | 'body_reference_image'
): PortraitReferenceImage {
  const field = `scenario portrait profile ${index} ${fieldName}`;
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  if (typeof value.name !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(value.name)
    || value.subfolder !== 'mullet/identity'
    || value.type !== 'input'
    || typeof value.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new Error(`${field} is invalid`);
  }
  const width = positiveInteger(value.width, `${field} width`);
  const height = positiveInteger(value.height, `${field} height`);
  const suppliedAspectRatio = requiredString(value.aspect_ratio, `${field} aspect_ratio`, 50);
  const aspectDivisor = greatestCommonDivisor(width, height);
  const aspectRatio = `${width / aspectDivisor}:${height / aspectDivisor}`;
  if (suppliedAspectRatio !== aspectRatio) {
    throw new Error(`${field} aspect_ratio must be the exact GCD-reduced dimensions ${aspectRatio}`);
  }
  return {
    name: value.name,
    subfolder: 'mullet/identity',
    type: 'input',
    sha256: value.sha256,
    width,
    height,
    aspectRatio
  };
}

function starterId(value: unknown, field: string): string {
  const id = requiredString(value, field, 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${field} must be lowercase kebab-case`);
  }
  return id;
}

export function normalizeScenarioPortraitCast(value: unknown): ScenarioPortraitCast {
  if (!isRecord(value) || value.spec !== 'mullet_portrait_cast_v2') {
    throw new Error('scenario portrait cast must use mullet_portrait_cast_v2');
  }
  const defaultProfileId = requiredString(value.default_profile_id, 'scenario portrait default profile id', 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(defaultProfileId)) {
    throw new Error('scenario portrait default profile id must be lowercase kebab-case');
  }
  if (!Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > 100) {
    throw new Error('scenario portrait cast must contain between 1 and 100 profiles');
  }
  const ids = new Set<string>();
  const aliases = new Set<string>();
  const profiles = value.profiles.map((candidate, index): ScenarioPortraitProfile => {
    if (!isRecord(candidate)) throw new Error(`scenario portrait profile ${index} must be an object`);
    const id = requiredString(candidate.id, `scenario portrait profile ${index} id`, 100);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`scenario portrait profile ${index} id must be lowercase kebab-case`);
    if (ids.has(id)) throw new Error(`duplicate scenario portrait profile id "${id}"`);
    ids.add(id);
    const displayName = requiredString(candidate.display_name, `scenario portrait profile ${index} display_name`, 200);
    if (!Array.isArray(candidate.aliases) || candidate.aliases.length < 1 || candidate.aliases.length > 20) {
      throw new Error(`scenario portrait profile ${index} aliases must contain between 1 and 20 names`);
    }
    const profileAliases = candidate.aliases.map((alias, aliasIndex) => {
      const normalized = requiredString(alias, `scenario portrait profile ${index} alias ${aliasIndex}`, 100);
      const folded = normalized.toLocaleLowerCase('en-US');
      if (aliases.has(folded)) throw new Error(`duplicate scenario portrait alias "${normalized}"`);
      aliases.add(folded);
      return normalized;
    });
    if (!isRecord(candidate.visual_profile)) throw new Error(`scenario portrait profile ${index} visual_profile must be an object`);
    const visual = candidate.visual_profile;
    const subject = requiredString(visual.subject, `scenario portrait profile ${index} subject`, 500);
    const attire = requiredString(visual.attire, `scenario portrait profile ${index} attire`, 500);
    const setting = requiredString(visual.setting, `scenario portrait profile ${index} setting`, 500);
    if (!Number.isSafeInteger(visual.seed) || Number(visual.seed) < 0 || Number(visual.seed) > Number.MAX_SAFE_INTEGER) {
      throw new Error(`scenario portrait profile ${index} seed must be a non-negative safe integer`);
    }
    const seed = Number(visual.seed);
    if (!isRecord(visual.expression_prompts)) {
      throw new Error(`scenario portrait profile ${index} expression_prompts must be an object`);
    }
    const expressionPrompts: Partial<Record<ExpressionLabel, string>> = {};
    const promptFingerprintFields: string[] = [];
    for (const [expression, prompt] of Object.entries(visual.expression_prompts).sort(([left], [right]) => left.localeCompare(right))) {
      if (!isExpressionLabel(expression)) {
        throw new Error(`scenario portrait profile ${index} expression prompt "${expression}" is invalid`);
      }
      const normalizedPrompt = requiredString(prompt, `scenario portrait profile ${index} ${expression} expression prompt`, 2000);
      expressionPrompts[expression] = normalizedPrompt;
      promptFingerprintFields.push(expression, normalizedPrompt);
    }
    if (!isPortraitModelTemplate(visual.model_template)) {
      throw new Error(`scenario portrait profile ${index} model_template is unsupported`);
    }
    const modelTemplate: PortraitModelTemplate = visual.model_template;
    let subjectLora: ScenarioPortraitSubjectLora | null = null;
    if (visual.subject_lora !== undefined && visual.subject_lora !== null) {
      if (!isRecord(visual.subject_lora)) {
        throw new Error(`scenario portrait profile ${index} subject_lora must be an object`);
      }
      const name = requiredString(visual.subject_lora.name, `scenario portrait profile ${index} subject_lora name`, 200);
      if (!isPortraitLoraName(name)) {
        throw new Error(`scenario portrait profile ${index} subject_lora name must be a safe Z-Image LoRA path`);
      }
      const trigger = requiredString(
        visual.subject_lora.trigger,
        `scenario portrait profile ${index} subject_lora trigger`,
        100
      );
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(trigger)) {
        throw new Error(`scenario portrait profile ${index} subject_lora trigger must be a lowercase token`);
      }
      const sha256 = requiredString(
        visual.subject_lora.sha256,
        `scenario portrait profile ${index} subject_lora sha256`,
        64
      );
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error(`scenario portrait profile ${index} subject_lora sha256 must be lowercase hexadecimal`);
      }
      subjectLora = { name, trigger, sha256 };
    }
    if (modelTemplate === PORTRAIT_TEMPLATE_ID && subjectLora === null) {
      throw new Error(`scenario portrait profile ${index} Z-Image template requires subject_lora`);
    }
    if (isPortraitReferenceTemplateId(modelTemplate) && subjectLora !== null) {
      throw new Error(`scenario portrait profile ${index} reference-conditioned template cannot use subject_lora`);
    }
    const referenceImage = normalizeScenarioPortraitReference(visual.reference_image, index, 'reference_image');
    const bodyReferenceImage = visual.body_reference_image === undefined || visual.body_reference_image === null
      ? null
      : normalizeScenarioPortraitReference(visual.body_reference_image, index, 'body_reference_image');
    return {
      id,
      displayName,
      aliases: profileAliases,
      subject,
      attire,
      setting,
      seed,
      expressionPrompts,
      modelTemplate,
      subjectLora,
      referenceImage,
      bodyReferenceImage,
      fingerprint: profileFingerprint([
        id,
        displayName,
        ...profileAliases,
        subject,
        attire,
        setting,
        String(seed),
        ...promptFingerprintFields,
        modelTemplate,
        subjectLora?.name ?? '',
        subjectLora?.trigger ?? '',
        subjectLora?.sha256 ?? '',
        referenceImage.name,
        referenceImage.sha256,
        String(referenceImage.width),
        String(referenceImage.height),
        referenceImage.aspectRatio,
        ...(bodyReferenceImage ? [
          bodyReferenceImage.name,
          bodyReferenceImage.sha256,
          String(bodyReferenceImage.width),
          String(bodyReferenceImage.height),
          bodyReferenceImage.aspectRatio
        ] : [])
      ])
    };
  });
  if (!profiles.some((profile) => profile.id === defaultProfileId)) {
    throw new Error('scenario portrait default profile does not exist');
  }
  return { spec: 'mullet_portrait_cast_v2', defaultProfileId, profiles };
}

export function scenarioPortraitCast(card: ImportedCharacterCard | null): ScenarioPortraitCast | null {
  if (!card || !isRecord(card.data.characterBook) || !isRecord(card.data.characterBook.extensions)) return null;
  const metadata = card.data.characterBook.extensions.mullet;
  if (!isRecord(metadata)) return null;
  try {
    return normalizeScenarioPortraitCast(metadata.portrait_cast_v2);
  } catch {
    return null;
  }
}

export function defaultScenarioPortraitProfile(card: ImportedCharacterCard | null): ScenarioPortraitProfile | null {
  const cast = scenarioPortraitCast(card);
  return cast?.profiles.find((profile) => profile.id === cast.defaultProfileId) ?? null;
}

export function normalizeScenarioStarters(
  value: unknown,
  portraitCast: ScenarioPortraitCast,
  greetingCount: number
): ScenarioStarters {
  if (!isRecord(value) || value.spec !== SCENARIO_STARTERS_SPEC) {
    throw new Error(`scenario starters must use ${SCENARIO_STARTERS_SPEC}`);
  }
  const defaultStarterId = starterId(value.default_starter_id, 'scenario default starter id');
  if (!Array.isArray(value.starters) || value.starters.length < 1 || value.starters.length > 20) {
    throw new Error('scenario starters must contain between 1 and 20 starters');
  }
  const ids = new Set<string>();
  const labels = new Set<string>();
  const greetingIndexes = new Set<number>();
  const starters = value.starters.map((candidate, index): ScenarioStarter => {
    if (!isRecord(candidate)) throw new Error(`scenario starter ${index} must be an object`);
    const id = starterId(candidate.id, `scenario starter ${index} id`);
    if (ids.has(id)) throw new Error(`duplicate scenario starter id "${id}"`);
    ids.add(id);
    const label = requiredString(candidate.label, `scenario starter ${index} label`, 50);
    const foldedLabel = label.toLocaleLowerCase('en-US');
    if (labels.has(foldedLabel)) throw new Error(`duplicate scenario starter label "${label}"`);
    labels.add(foldedLabel);
    if (!Number.isSafeInteger(candidate.greeting_index)
      || Number(candidate.greeting_index) < 0
      || Number(candidate.greeting_index) >= greetingCount) {
      throw new Error(`scenario starter ${index} greeting_index must select an available greeting`);
    }
    const greetingIndex = Number(candidate.greeting_index);
    if (greetingIndexes.has(greetingIndex)) {
      throw new Error(`duplicate scenario starter greeting_index ${greetingIndex}`);
    }
    greetingIndexes.add(greetingIndex);
    const portraitProfileId = starterId(
      candidate.portrait_profile_id,
      `scenario starter ${index} portrait_profile_id`
    );
    if (!portraitCast.profiles.some((profile) => profile.id === portraitProfileId)) {
      throw new Error(`scenario starter ${index} portrait profile does not exist`);
    }
    return {
      id,
      label,
      title: requiredString(candidate.title, `scenario starter ${index} title`, 200),
      summary: requiredString(candidate.summary, `scenario starter ${index} summary`, 1_000),
      greetingIndex,
      portraitProfileId
    };
  });
  if (!starters.some((starter) => starter.id === defaultStarterId)) {
    throw new Error('scenario default starter does not exist');
  }
  return { spec: SCENARIO_STARTERS_SPEC, defaultStarterId, starters };
}

export function scenarioStarters(card: ImportedCharacterCard | null): ScenarioStarters | null {
  if (!card || !isRecord(card.data.extensions.mullet)) return null;
  const portraitCast = scenarioPortraitCast(card);
  if (!portraitCast) return null;
  try {
    return normalizeScenarioStarters(
      card.data.extensions.mullet.starters_v1,
      portraitCast,
      1 + card.data.alternateGreetings.length
    );
  } catch {
    return null;
  }
}

function selectedScenarioStarter(card: ImportedCharacterCard, selectedStarterId: string): ScenarioStarter | null {
  const starters = scenarioStarters(card);
  if (!starters) return null;
  return starters.starters.find((starter) => starter.id === selectedStarterId)
    ?? starters.starters.find((starter) => starter.id === starters.defaultStarterId)
    ?? null;
}

export function scenarioStarterMessage(
  card: ImportedCharacterCard,
  selectedStarterId: string,
  userName = 'You'
): string {
  const starter = selectedScenarioStarter(card, selectedStarterId);
  const greeting = starter?.greetingIndex === 0
    ? card.data.firstMes
    : card.data.alternateGreetings[(starter?.greetingIndex ?? 0) - 1] ?? card.data.firstMes;
  return substituteCardMacros(greeting, card.data.nickname || card.data.name, userName);
}

export function scenarioStarterPortraitProfile(
  card: ImportedCharacterCard | null,
  selectedStarterId: string
): ScenarioPortraitProfile | null {
  if (!card) return null;
  const starter = selectedScenarioStarter(card, selectedStarterId);
  const cast = scenarioPortraitCast(card);
  if (!starter || !cast) return defaultScenarioPortraitProfile(card);
  return cast.profiles.find((profile) => profile.id === starter.portraitProfileId)
    ?? defaultScenarioPortraitProfile(card);
}

function scenarioMetadata(value: unknown, field: string): JsonObject {
  if (!isRecord(value) || value.kind !== 'scenario') {
    throw new Error(`${field} must identify a scenario`);
  }
  return value;
}

export function normalizeScenarioCatalog(value: unknown): ScenarioCatalog {
  if (!isRecord(value) || value.spec !== SCENARIO_CATALOG_SPEC) {
    throw new Error(`scenario catalog spec must be "${SCENARIO_CATALOG_SPEC}"`);
  }
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0 || value.scenarios.length > 100) {
    throw new Error('scenario catalog must contain between 1 and 100 scenarios');
  }

  const seenIds = new Set<string>();
  const scenarios = value.scenarios.map((candidate, index): ScenarioCatalogEntry => {
    if (!isRecord(candidate)) throw new Error(`scenario catalog entry ${index} must be an object`);
    const id = requiredString(candidate.id, `scenario catalog entry ${index} id`, 100);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`scenario catalog entry ${index} id must be lowercase kebab-case`);
    }
    if (seenIds.has(id)) throw new Error(`duplicate scenario id "${id}"`);
    seenIds.add(id);
    const version = requiredString(candidate.version, `scenario catalog entry ${index} version`, 50);
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`scenario catalog entry ${index} version must be semantic versioning`);
    }
    if (!Array.isArray(candidate.starters) || candidate.starters.length < 1 || candidate.starters.length > 20) {
      throw new Error(`scenario catalog entry ${index} starters must contain between 1 and 20 starters`);
    }
    const starterIds = new Set<string>();
    const starterLabels = new Set<string>();
    const starters = candidate.starters.map((starter, starterIndex): ScenarioCatalogStarter => {
      if (!isRecord(starter)) throw new Error(`scenario catalog entry ${index} starter ${starterIndex} must be an object`);
      const id = starterId(starter.id, `scenario catalog entry ${index} starter ${starterIndex} id`);
      if (starterIds.has(id)) throw new Error(`duplicate scenario catalog starter id "${id}"`);
      starterIds.add(id);
      const label = requiredString(starter.label, `scenario catalog entry ${index} starter ${starterIndex} label`, 50);
      const foldedLabel = label.toLocaleLowerCase('en-US');
      if (starterLabels.has(foldedLabel)) throw new Error(`duplicate scenario catalog starter label "${label}"`);
      starterLabels.add(foldedLabel);
      return { id, label };
    });
    return {
      id,
      version,
      title: requiredString(candidate.title, `scenario catalog entry ${index} title`, 200),
      summary: requiredString(candidate.summary, `scenario catalog entry ${index} summary`, 1_000),
      card: scenarioAsset(candidate.card, `scenario catalog entry ${index} card`),
      lorebook: scenarioAsset(candidate.lorebook, `scenario catalog entry ${index} lorebook`),
      starters
    };
  });

  return { spec: SCENARIO_CATALOG_SPEC, scenarios };
}

export function validateScenarioPackage(
  entry: ScenarioCatalogEntry,
  cardValue: unknown,
  lorebookValue: unknown
): ScenarioPackage {
  const card = normalizeCharacterCard(cardValue);
  if (card.spec !== 'chara_card_v3' || card.specVersion !== '3.0') {
    throw new Error('bundled scenario card must use chara_card_v3@3.0');
  }
  if (!card.data.firstMes.trim()) throw new Error('bundled scenario card must provide a first message');
  const cardMetadata = scenarioMetadata(card.data.extensions.mullet, 'character card data.extensions.mullet');
  if (cardMetadata.scenario_id !== entry.id || cardMetadata.scenario_version !== entry.version) {
    throw new Error('character card scenario identity does not match the catalog');
  }

  if (!isRecord(lorebookValue) || lorebookValue.spec !== 'lorebook_v3' || !isRecord(lorebookValue.data)) {
    throw new Error('bundled scenario lorebook must use the lorebook_v3 wrapper');
  }
  const loreMetadata = scenarioMetadata(
    isRecord(lorebookValue.data.extensions) ? lorebookValue.data.extensions.mullet : undefined,
    'lorebook data.extensions.mullet'
  );
  if (loreMetadata.scenario_id !== entry.id || loreMetadata.scenario_version !== entry.version) {
    throw new Error('lorebook scenario identity does not match the catalog');
  }
  const portraitCast = normalizeScenarioPortraitCast(loreMetadata.portrait_cast_v2);
  const starters = normalizeScenarioStarters(
    cardMetadata.starters_v1,
    portraitCast,
    1 + card.data.alternateGreetings.length
  );
  const packagedStarterCatalog = starters.starters.map(({ id, label }) => ({ id, label }));
  if (!deepEqualJson(packagedStarterCatalog, entry.starters)) {
    throw new Error('character card starters do not match the catalog');
  }
  if (!deepEqualJson(card.data.characterBook, lorebookValue.data)) {
    throw new Error('embedded and standalone scenario lorebooks must be identical');
  }

  const lorebook = normalizeLorebook(lorebookValue, entry.title, 'imported');
  if (lorebook.diagnostics.length > 0) throw new Error('bundled scenario lorebook contains malformed entries');
  const entryIds = lorebook.entries.map((loreEntry) => loreEntry.id);
  if (new Set(entryIds).size !== entryIds.length) throw new Error('bundled scenario lorebook entry ids must be unique');

  return { entry, card, lorebook, portraitCast, starters };
}

export function isScenarioCard(card: ImportedCharacterCard | null): boolean {
  return card?.data.extensions.mullet !== null
    && isRecord(card?.data.extensions.mullet)
    && card.data.extensions.mullet.kind === 'scenario';
}

export function scenarioPortraitGenerationReady(
  card: ImportedCharacterCard | null,
  scenarioCatalogSettled: boolean
): boolean {
  return !isScenarioCard(card) || scenarioCatalogSettled;
}
