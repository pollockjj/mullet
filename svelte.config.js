import adapter from '@sveltejs/adapter-node';

const configuredBase = process.env.BASE_PATH ?? '';
const base = configuredBase === '/' ? '' : configuredBase.replace(/\/$/, '');

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ out: 'scratch/build' }),
    outDir: 'scratch/.svelte-kit',
    paths: { base }
  }
};

export default config;

