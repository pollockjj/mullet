export function prependSseMetadata(
  source: ReadableStream<Uint8Array>,
  metadata: unknown
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const prefix = new TextEncoder().encode(`data: ${JSON.stringify({ mullet: metadata })}\n\n`);
  let prefixed = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixed) {
        prefixed = true;
        controller.enqueue(prefix);
        return;
      }
      try {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (cause) {
        controller.error(cause);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}
