// Paired cold/warm timing for the expression-still candidates, all at the 576x1024
// expression contract, same identity reference, same seed, same prompt intent.
// Evidence for milestone 1's default choice.

import { writeFile } from 'node:fs/promises';
import { pairedRun } from './comfy-timing.mjs';

const IMAGE_LANE = process.env.IMAGE_COMFY_BASE_URL ?? 'http://firestorm:8188';
const REF = 'mullet/identity/jenna-stannis-v1.jpg';
const W = 576;
const H = 1024;
const SEED = 19790213;

const EDIT_PROMPT =
  'Use the supplied canonical Jenna Stannis reference as the identity source. Preserve the exact facial identity, '
  + 'hair, and wardrobe. Head-and-chest portrait, restrained fear expression, natural skin texture, detailed eyes, '
  + 'coherent anatomy, cinematic lighting, no text, no watermark.';

const GEN_PROMPT =
  'head-and-chest portrait of Sally Knyvette portraying Jenna Stannis in the 1979 BBC series Blake’s 7, '
  + 'restrained fear expression, cinematic realistic fiction still, coherent anatomy, natural skin texture, '
  + 'detailed eyes, controlled depth of field, no text, no watermark';

const qwen = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_edit_2511_int8_convrot.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
  '4': { class_type: 'LoadImage', inputs: { image: REF } },
  '5': { class_type: 'ImageScale', inputs: { image: ['4', 0], upscale_method: 'lanczos', width: W, height: H, crop: 'center' } },
  '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.1 } },
  '7': { class_type: 'CFGNorm', inputs: { model: ['6', 0], strength: 1, pre_cfg: false } },
  '8': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['7', 0], lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', strength_model: 1 } },
  '9': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: ['5', 0], prompt: EDIT_PROMPT } },
  '10': { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], image1: ['5', 0], prompt: '' } },
  '11': { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['3', 0] } },
  '12': { class_type: 'KSampler', inputs: { model: ['8', 0], positive: ['9', 0], negative: ['10', 0], latent_image: ['11', 0], seed: SEED, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
  '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['3', 0] } },
  '14': { class_type: 'SaveImage', inputs: { images: ['13', 0], filename_prefix: 'mullet/timing-qwen' } }
};

const zimage = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_int8_convrot.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: GEN_PROMPT } },
  '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
  '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
  '7': { class_type: 'EmptySD3LatentImage', inputs: { width: W, height: H, batch_size: 1 } },
  '8': { class_type: 'KSampler', inputs: { model: ['6', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0], seed: SEED, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1 } },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'mullet/timing-zimage' } }
};

function h3Still({ steps, lora }) {
  const graph = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' } },
    '5': { class_type: 'LoadImage', inputs: { image: REF } },
    '19': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['1', 0], shift_video: 12, shift_audio: 3 } },
    '20': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { clip: ['2', 0], vae: ['3', 0], audio_vae: ['4', 0], prompt: EDIT_PROMPT, width: W, height: H, length: 5, ref_image_size: 'match', 'ref_images.ref_image_0': ['5', 0] } },
    '21': { class_type: 'BasicGuider', inputs: { model: ['19', 0], conditioning: ['20', 0] } },
    '22': { class_type: 'KSamplerSelect', inputs: { sampler_name: lora ? 'euler' : 'res_multistep' } },
    '23': { class_type: 'BasicScheduler', inputs: { model: ['19', 0], scheduler: 'simple', steps, denoise: 1 } },
    '24': { class_type: 'RandomNoise', inputs: { noise_seed: SEED } },
    '25': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['24', 0], guider: ['21', 0], sampler: ['22', 0], sigmas: ['23', 0], latent_image: ['20', 1] } },
    '26': { class_type: 'VAEDecode', inputs: { samples: ['25', 0], vae: ['3', 0] } },
    '27': { class_type: 'ImageFromBatch', inputs: { image: ['26', 0], batch_index: 0, length: 1 } },
    '28': { class_type: 'SaveImage', inputs: { images: ['27', 0], filename_prefix: `mullet/timing-h3-${steps}step` } }
  };
  if (lora) {
    graph['18'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: lora, strength_model: 1 } };
    graph['19'].inputs.model = ['18', 0];
  }
  return graph;
}

const CANDIDATES = [
  { label: 'qwen-image-edit-2511-lightning-4step', graph: qwen, warmRuns: 2, reference: true },
  { label: 'z-image-turbo-8step', graph: zimage, warmRuns: 2, reference: false },
  { label: 'h3-ref2va-still-4step-turbo', graph: h3Still({ steps: 4, lora: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors' }), warmRuns: 1, reference: true },
  { label: 'h3-ref2va-still-20step-current-default', graph: h3Still({ steps: 20, lora: null }), warmRuns: 1, reference: true }
];

const results = [];
for (const candidate of CANDIDATES) {
  process.stdout.write(`\n### ${candidate.label}\n`);
  try {
    const run = await pairedRun(IMAGE_LANE, candidate.graph, { label: candidate.label, warmRuns: candidate.warmRuns });
    results.push({ ...run, reference: candidate.reference, ok: true });
    console.log(`  cold ${run.cold.totalMs} ms   warm ${run.warmBest.totalMs} ms   -> ${run.cold.outputs[0]?.filename}`);
  } catch (error) {
    results.push({ label: candidate.label, ok: false, error: error.message });
    console.log(`  FAILED: ${error.message}`);
  }
}

await writeFile('scratch/still-candidate-timings.json', `${JSON.stringify(results, null, 2)}\n`);

console.log('\n=== expression still, 576x1024, same reference and seed ===');
console.log('candidate                                 cold(s)  warm(s)  ref  gate<=8s');
for (const r of results) {
  if (!r.ok) { console.log(`${r.label.padEnd(41)} FAILED  ${r.error.slice(0, 60)}`); continue; }
  const warm = r.warmBest.totalMs / 1000;
  console.log(
    `${r.label.padEnd(41)} ${(r.cold.totalMs / 1000).toFixed(1).padStart(6)}  ${warm.toFixed(1).padStart(6)}  `
    + `${r.reference ? 'yes' : 'no '}  ${warm <= 8 ? 'PASS' : 'FAIL'}`
  );
}
