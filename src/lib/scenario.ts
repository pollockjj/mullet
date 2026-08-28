import {
  normalizeCharacterCard,
  type ImportedCharacterCard,
  type JsonObject
} from './character-card.ts';
import { normalizeLorebook, type ImportedLorebook } from './lorebook.ts';

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
  if (!deepEqualJson(card.data.characterBook, lorebookValue.data)) {
    throw new Error('embedded and standalone scenario lorebooks must be identical');
  }

  const lorebook = normalizeLorebook(lorebookValue, entry.title, 'imported');
  if (lorebook.diagnostics.length > 0) throw new Error('bundled scenario lorebook contains malformed entries');
  const entryIds = lorebook.entries.map((loreEntry) => loreEntry.id);
  if (new Set(entryIds).size !== entryIds.length) throw new Error('bundled scenario lorebook entry ids must be unique');

  return { entry, card, lorebook };
}

export function isScenarioCard(card: ImportedCharacterCard | null): boolean {
  return card?.data.extensions.mullet !== null
    && isRecord(card?.data.extensions.mullet)
    && card.data.extensions.mullet.kind === 'scenario';
}
