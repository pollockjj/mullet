import { env } from '$env/dynamic/private';
import { DEFAULT_RESPONSE_TOKENS, MAX_RESPONSE_TOKENS } from '$lib/token-limit';

const parsedMaxTokens = Number.parseInt(env.MODEL_MAX_TOKENS ?? String(MAX_RESPONSE_TOKENS), 10);
const maxTokens = Number.isInteger(parsedMaxTokens) && parsedMaxTokens >= 1 ? parsedMaxTokens : MAX_RESPONSE_TOKENS;
const parsedDefaultTokens = Number.parseInt(env.MODEL_DEFAULT_TOKENS ?? String(DEFAULT_RESPONSE_TOKENS), 10);
const defaultMaxTokens = Number.isInteger(parsedDefaultTokens) && parsedDefaultTokens >= 1 && parsedDefaultTokens <= maxTokens
  ? parsedDefaultTokens
  : Math.min(DEFAULT_RESPONSE_TOKENS, maxTokens);
const parsedTemperature = Number.parseFloat(env.MODEL_TEMPERATURE ?? '0.85');

export const runtime = {
  service: 'mullet',
  modelBaseUrl: (env.MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1').replace(/\/$/, ''),
  modelId: env.MODEL_ID ?? 'local-model',
  imageComfyBaseUrl: (env.IMAGE_COMFY_BASE_URL ?? '').trim().replace(/\/$/, ''),
  videoComfyBaseUrl: (env.VIDEO_COMFY_BASE_URL ?? '').trim().replace(/\/$/, ''),
  minimaxH3T1StillValidated: env.MINIMAX_H3_T1_STILL_VALIDATED === 'true',
  maxTokens,
  defaultMaxTokens,
  temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : 0.85,
  revision: env.BUILD_SHA ?? env.PUBLIC_BUILD_SHA ?? 'development'
};
