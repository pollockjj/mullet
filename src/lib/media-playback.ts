export type PlaybackState = 'idle' | 'starting' | 'playing' | 'fallback';

export const MEDIA_PLAYBACK_START_TIMEOUT_MS = 5_000;

export function mediaPlaybackTimeAdvanced(
  startSeconds: number,
  currentSeconds: number,
  fps: number,
  durationSeconds: number
): boolean {
  if (
    !Number.isFinite(startSeconds)
    || !Number.isFinite(currentSeconds)
    || !Number.isFinite(fps)
    || !Number.isFinite(durationSeconds)
    || startSeconds < 0
    || currentSeconds < 0
    || fps <= 0
    || durationSeconds <= 0
    || startSeconds > durationSeconds
    || currentSeconds > durationSeconds
  ) return false;

  const elapsedSeconds = currentSeconds >= startSeconds
    ? currentSeconds - startSeconds
    : durationSeconds - startSeconds + currentSeconds;

  return elapsedSeconds >= 0.5 / fps;
}
