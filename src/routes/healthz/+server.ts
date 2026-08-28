import { json } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export const GET = () =>
  json(
    {
      status: 'ok',
      service: runtime.service,
      model: runtime.modelId,
      revision: runtime.revision
    },
    {
      headers: {
        'cache-control': 'no-store'
      }
    }
  );

