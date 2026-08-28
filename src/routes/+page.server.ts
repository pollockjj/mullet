import type { PageServerLoad } from './$types';
import { runtime } from '$lib/server/runtime';

export const load: PageServerLoad = () => ({
  model: runtime.modelId,
  revision: runtime.revision,
  maxTokens: runtime.maxTokens,
  defaultMaxTokens: runtime.defaultMaxTokens
});
