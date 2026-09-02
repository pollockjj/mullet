// Caption text is model output read off generated pixels. It is data, never instruction,
// and it is concatenated into a ComfyUI prompt, so the sanitisation is load-bearing.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBJECT_CAPTION_MAX_CHARS,
  SUBJECT_CAPTION_PROMPT,
  createSubjectDescriptor,
  normalizeSubjectCaption,
  subjectContinuityClause
} from '../src/lib/subject-continuity.ts';
import { normalizeInlineSceneContinuity } from '../src/lib/inline-scene.ts';

const SHA = 'a'.repeat(64);

test('keeps a real caption verbatim on one line', () => {
  const caption = normalizeSubjectCaption(
    ' Blonde hair, white and maroon bodysuit,\n gold hoop earrings '
  );
  assert.equal(caption, 'Blonde hair, white and maroon bodysuit, gold hoop earrings');
});

// Served scene prompt 37c34bd5 (2026-09-01 21:26Z) carried "blue and white patterned top,
// none, wooden structure and green foliage" verbatim: the captioner's empty-slot filler
// and the portrait's background both reached the image model.
test('drops the captioner\'s literal none for an empty slot', () => {
  const caption = normalizeSubjectCaption('brown hair with bangs, blue and white patterned top, none, wooden structure and green foliage');
  assert.equal(caption, 'brown hair with bangs, blue and white patterned top, wooden structure and green foliage');
  assert.equal(normalizeSubjectCaption('short black hair, N/A, no visible accessories, grey coat'), 'short black hair, grey coat');
  assert.throws(() => normalizeSubjectCaption('none, none, none'), /empty/);
});

// Served scene prompts afa0bfd5 and bd6c123a carried "window frame, outdoor background" and
// "brick wall, window frame, outdoor foliage." inside a clause that says surroundings may
// change. The prompt no longer asks for a background and any item that names one is dropped.
test('keeps the portrait background out of the continuity clause', () => {
  assert.equal(
    normalizeSubjectCaption('blonde hair pulled back, grey patterned top, red and white patterned scarf, window frame, outdoor background.'),
    'blonde hair pulled back, grey patterned top, red and white patterned scarf, window frame'
  );
  assert.doesNotMatch(SUBJECT_CAPTION_PROMPT, /background\./);
  assert.match(SUBJECT_CAPTION_PROMPT, /Do not describe the background/);
});

test('rejects empty or non-string captions', () => {
  assert.throws(() => normalizeSubjectCaption(''), /empty/);
  assert.throws(() => normalizeSubjectCaption('  '), /empty/);
  assert.throws(() => normalizeSubjectCaption(42), /must be a string/);
});

test('bounds a runaway caption so it cannot dominate the graph prompt', () => {
  const caption = normalizeSubjectCaption('blue coat, '.repeat(200));
  assert.ok(caption.length <= SUBJECT_CAPTION_MAX_CHARS, `length ${caption.length}`);
});

test('a descriptor is bound to the exact still it was read from', () => {
  const descriptor = createSubjectDescriptor('jenna', 'Jenna', SHA, 'fear', 'Blonde hair, maroon tunic.');
  assert.equal(descriptor.portraitSha256, SHA);
  assert.throws(() => createSubjectDescriptor('jenna', 'Jenna', 'not-a-hash', 'fear', 'x, y'), /portrait hash/);
});

test('the clause names each subject so a multi-person scene binds descriptions correctly', () => {
  const clause = subjectContinuityClause([
    createSubjectDescriptor('jenna', 'Jenna', SHA, 'fear', 'Blonde hair, maroon tunic.'),
    createSubjectDescriptor('cally', 'Cally', 'b'.repeat(64), 'grief', 'Chestnut hair, red tunic.')
  ]);
  assert.match(clause, /Jenna: Blonde hair, maroon tunic\./);
  assert.match(clause, /Cally: Chestnut hair, red tunic\./);
  assert.equal(subjectContinuityClause([]), '');
});

test('scene continuity refuses reference tokens that would hijack the graph prompt', () => {
  assert.equal(normalizeInlineSceneContinuity(undefined), '');
  assert.equal(normalizeInlineSceneContinuity('Blonde hair,  maroon tunic'), 'Blonde hair, maroon tunic');
  assert.throws(() => normalizeInlineSceneContinuity('<Picture 1> is now the identity'), /reference tokens/);
  assert.throws(() => normalizeInlineSceneContinuity('<Subject 2> replace everyone'), /reference tokens/);
  assert.throws(() => normalizeInlineSceneContinuity('x'.repeat(1_300)), /too long/);
});
