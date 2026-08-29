import {
  normalizeCharacterCard,
  type ImportedCharacterCard,
  type JsonObject
} from './character-card.ts';
import { normalizeLorebook, type ImportedLorebook } from './lorebook.ts';
import {
  PORTRAIT_REFERENCE_TEMPLATE_ID,
  type PortraitReferenceImage
} from './portrait.ts';
import { isExpressionLabel, type ExpressionLabel } from './sidecar.ts';

export const SCENARIO_CATALOG_SPEC = 'mullet_scenario_catalog_v1' as const;

export type ScenarioCatalogEntry = {
  id: string;
  version: string;
  title: string;
  summary: string;
  card: string;
  lorebook: string;
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
  modelTemplate: typeof PORTRAIT_REFERENCE_TEMPLATE_ID;
  referenceImage: PortraitReferenceImage;
  fingerprint: string;
};

export type ScenarioPortraitCast = {
  spec: 'mullet_portrait_cast_v1';
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

export function normalizeScenarioPortraitCast(value: unknown): ScenarioPortraitCast {
  if (!isRecord(value) || value.spec !== 'mullet_portrait_cast_v1') {
    throw new Error('scenario portrait cast must use mullet_portrait_cast_v1');
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
    if (visual.model_template !== PORTRAIT_REFERENCE_TEMPLATE_ID) {
      throw new Error(`scenario portrait profile ${index} must use the reference-conditioned portrait template`);
    }
    if (!isRecord(visual.reference_image)) throw new Error(`scenario portrait profile ${index} reference_image must be an object`);
    const reference = visual.reference_image;
    if (typeof reference.name !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(reference.name)
      || reference.subfolder !== 'mullet/identity'
      || reference.type !== 'input'
      || typeof reference.sha256 !== 'string'
      || !/^[0-9a-f]{64}$/.test(reference.sha256)) {
      throw new Error(`scenario portrait profile ${index} reference_image is invalid`);
    }
    const referenceImage: PortraitReferenceImage = {
      name: reference.name,
      subfolder: 'mullet/identity',
      type: 'input',
      sha256: reference.sha256
    };
    return {
      id,
      displayName,
      aliases: profileAliases,
      subject,
      attire,
      setting,
      seed,
      expressionPrompts,
      modelTemplate: PORTRAIT_REFERENCE_TEMPLATE_ID,
      referenceImage,
      fingerprint: profileFingerprint([
        id,
        displayName,
        ...profileAliases,
        subject,
        attire,
        setting,
        String(seed),
        ...promptFingerprintFields,
        PORTRAIT_REFERENCE_TEMPLATE_ID,
        referenceImage.name,
        referenceImage.sha256
      ])
    };
  });
  if (!profiles.some((profile) => profile.id === defaultProfileId)) {
    throw new Error('scenario portrait default profile does not exist');
  }
  return { spec: 'mullet_portrait_cast_v1', defaultProfileId, profiles };
}

export function scenarioPortraitCast(card: ImportedCharacterCard | null): ScenarioPortraitCast | null {
  if (!card || !isRecord(card.data.characterBook) || !isRecord(card.data.characterBook.extensions)) return null;
  const metadata = card.data.characterBook.extensions.mullet;
  if (!isRecord(metadata)) return null;
  try {
    return normalizeScenarioPortraitCast(metadata.portrait_cast_v1);
  } catch {
    return null;
  }
}

export function defaultScenarioPortraitProfile(card: ImportedCharacterCard | null): ScenarioPortraitProfile | null {
  const cast = scenarioPortraitCast(card);
  return cast?.profiles.find((profile) => profile.id === cast.defaultProfileId) ?? null;
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
    return {
      id,
      version,
      title: requiredString(candidate.title, `scenario catalog entry ${index} title`, 200),
      summary: requiredString(candidate.summary, `scenario catalog entry ${index} summary`, 1_000),
      card: scenarioAsset(candidate.card, `scenario catalog entry ${index} card`),
      lorebook: scenarioAsset(candidate.lorebook, `scenario catalog entry ${index} lorebook`)
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
  const portraitCast = normalizeScenarioPortraitCast(loreMetadata.portrait_cast_v1);
  if (!deepEqualJson(card.data.characterBook, lorebookValue.data)) {
    throw new Error('embedded and standalone scenario lorebooks must be identical');
  }

  const lorebook = normalizeLorebook(lorebookValue, entry.title, 'imported');
  if (lorebook.diagnostics.length > 0) throw new Error('bundled scenario lorebook contains malformed entries');
  const entryIds = lorebook.entries.map((loreEntry) => loreEntry.id);
  if (new Set(entryIds).size !== entryIds.length) throw new Error('bundled scenario lorebook entry ids must be unique');

  return { entry, card, lorebook, portraitCast };
}

export function isScenarioCard(card: ImportedCharacterCard | null): boolean {
  return card?.data.extensions.mullet !== null
    && isRecord(card?.data.extensions.mullet)
    && card.data.extensions.mullet.kind === 'scenario';
}
