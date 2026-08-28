import adapter from '@sveltejs/adapter-node';

const configuredBase = process.env.BASE_PATH ?? '';
const base = configuredBase === '/' ? '' : configuredBase.replace(/\/$/, '');
const buildOutputDirectory = process.env.BUILD_OUTPUT_DIR ?? 'scratch/build';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ out: buildOutputDirectory }),
    outDir: 'scratch/.svelte-kit',
    paths: { base }
  }
};

export default config;
