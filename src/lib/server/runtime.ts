import { env } from '$env/dynamic/private';
import { DEFAULT_RESPONSE_TOKENS, MAX_RESPONSE_TOKENS } from '$lib/token-limit';

const parsedMaxTokens = Number.parseInt(env.MODEL_MAX_TOKENS ?? String(MAX_RESPONSE_TOKENS), 10);
const maxTokens = Number.isInteger(parsedMaxTokens) && parsedMaxTokens >= 1 ? parsedMaxTokens : MAX_RESPONSE_TOKENS;
const parsedDefaultTokens = Number.parseInt(env.MODEL_DEFAULT_TOKENS ?? String(DEFAULT_RESPONSE_TOKENS), 10);
const defaultMaxTokens = Number.isInteger(parsedDefaultTokens) && parsedDefaultTokens >= 1 && parsedDefaultTokens <= maxTokens
  ? parsedDefaultTokens
  : Math.min(DEFAULT_RESPONSE_TOKENS, maxTokens);
const parsedTemperature = Number.parseFloat(env.MODEL_TEMPERATURE ?? '0.85');

function lane(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/$/, '');
}

export const runtime = {
  service: 'mullet',
  modelBaseUrl: (env.MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1').replace(/\/$/, ''),
  modelId: env.MODEL_ID ?? 'local-model',
  // Lanes are split by PIPELINE, not by media type. The expression pipeline (still and
  // motion) owns one ComfyUI instance and the scene pipeline (still and motion) owns the
  // other, so a portrait job can never queue ahead of a scene job or vice versa.
  // The legacy IMAGE_/VIDEO_ variables are accepted as the defaults for each lane.
  expressionComfyBaseUrl: lane(env.EXPRESSION_COMFY_BASE_URL ?? env.IMAGE_COMFY_BASE_URL),
  sceneComfyBaseUrl: lane(env.SCENE_COMFY_BASE_URL ?? env.VIDEO_COMFY_BASE_URL),
  // Per-stage overrides (operator order 2026-09-02: benchmark both layouts and run the
  // faster one). Unset, each stage follows its pipeline lane above. Set
  // PORTRAIT_VIDEO_COMFY_BASE_URL and SCENE_STILL_COMFY_BASE_URL to swap to the
  // media-type layout: every still on one instance, every H3 loop on the other.
  portraitStillComfyBaseUrl: lane(env.PORTRAIT_STILL_COMFY_BASE_URL ?? env.EXPRESSION_COMFY_BASE_URL ?? env.IMAGE_COMFY_BASE_URL),
  portraitVideoComfyBaseUrl: lane(env.PORTRAIT_VIDEO_COMFY_BASE_URL ?? env.EXPRESSION_COMFY_BASE_URL ?? env.IMAGE_COMFY_BASE_URL),
  sceneStillComfyBaseUrl: lane(env.SCENE_STILL_COMFY_BASE_URL ?? env.SCENE_COMFY_BASE_URL ?? env.VIDEO_COMFY_BASE_URL),
  sceneVideoComfyBaseUrl: lane(env.SCENE_VIDEO_COMFY_BASE_URL ?? env.SCENE_COMFY_BASE_URL ?? env.VIDEO_COMFY_BASE_URL),
  maxTokens,
  defaultMaxTokens,
  temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : 0.85,
  revision: env.BUILD_SHA ?? env.PUBLIC_BUILD_SHA ?? 'development'
};
