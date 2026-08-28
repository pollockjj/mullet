import { env } from '$env/dynamic/private';

const parsedMaxTokens = Number.parseInt(env.MODEL_MAX_TOKENS ?? '2048', 10);
const parsedTemperature = Number.parseFloat(env.MODEL_TEMPERATURE ?? '0.85');

export const runtime = {
  service: 'mullet',
  modelBaseUrl: (env.MODEL_BASE_URL ?? 'http://127.0.0.1:1234/v1').replace(/\/$/, ''),
  modelId: env.MODEL_ID ?? 'local-model',
  maxTokens: Number.isFinite(parsedMaxTokens) ? parsedMaxTokens : 2048,
  temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : 0.85,
  revision: env.BUILD_SHA ?? env.PUBLIC_BUILD_SHA ?? 'development'
};

