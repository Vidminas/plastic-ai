import { readFile } from 'node:fs/promises';
import type { ScreenedKind } from './content';
import { isBinaryBuffer } from '../../skills/binary';
import { parseDocument } from '../documents/crud';

export type ScreeningText = { readonly ok: true; readonly text: string } | { readonly ok: false };

/** What `parseDocument` throws for a document with no text layer, such as a scanned PDF. */
const NO_TEXT_MESSAGE = 'No text found in document';

/**
 * The text of a document or text file, whichever way it will later reach the model, so it
 * can be screened. A document with no text (a scanned PDF, an image-only deck) gives empty
 * text; one that cannot be parsed, or a text file that is really binary, gives `ok: false`.
 */
export async function extractScreeningText(
  file: Express.Multer.File,
  kind: Exclude<ScreenedKind, 'image'>,
): Promise<ScreeningText> {
  if (kind === 'text') {
    const buffer = await readFile(file.path);
    return isBinaryBuffer(buffer) ? { ok: false } : { ok: true, text: buffer.toString('utf8') };
  }
  try {
    const { text } = await parseDocument({ file });
    return { ok: true, text };
  } catch (error) {
    if (error instanceof Error && error.message === NO_TEXT_MESSAGE) {
      return { ok: true, text: '' };
    }
    return { ok: false };
  }
}
