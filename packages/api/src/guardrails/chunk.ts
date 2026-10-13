/**
 * The most text one guardrail check takes. Bedrock refuses more than 106 text units (of up
 * to 1,000 characters each) for a sensitive information policy in one request, reporting
 * it as a `ThrottlingException`, so retrying cannot help. UTF-8 bytes are never fewer than
 * characters, so a chunk of this many bytes is at most 100 units.
 */
export const MAX_GUARDRAIL_CHUNK_BYTES = 100_000;
/** How far back from a chunk's end to look for whitespace to break on. */
const BREAK_WINDOW = 1_000;

/**
 * Splits text into pieces of at most `maxBytes` UTF-8 bytes, breaking at whitespace where
 * it can, each starting `overlap` characters before the previous one ended. With no overlap
 * the pieces join back into the text exactly.
 */
export function chunkText(
  text: string,
  maxBytes: number = MAX_GUARDRAIL_CHUNK_BYTES,
  overlap: number = 0,
): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxBytes);
    while (Buffer.byteLength(text.slice(start, end), 'utf8') > maxBytes) {
      end = start + Math.floor((end - start) * 0.9);
    }
    if (end < text.length) {
      const window = text.slice(Math.max(start + overlap + 1, end - BREAK_WINDOW), end);
      const lastSpace = window.search(/\s\S*$/);
      if (lastSpace > 0) {
        end = end - window.length + lastSpace + 1;
      }
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) {
      break;
    }
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
