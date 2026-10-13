import sharp from 'sharp';
import { DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import type { TextractClient } from '@aws-sdk/client-textract';

/** Reads the text shown in an image; `ok: false` when the image cannot be read. */
export interface ImageTextReader {
  read(path: string): Promise<{ ok: true; text: string } | { ok: false }>;
}

/** Textract's synchronous limit, per image. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Longest side sent to Textract; larger images are scaled down, which keeps text legible. */
const MAX_SIDE = 4_000;
/** Frames of an animated GIF or WebP read before the image is refused. */
export const MAX_IMAGE_PAGES = 10;

/** Errors Textract raises for an image it cannot read, rather than for a service failure. */
const UNREADABLE_ERRORS = new Set([
  'BadDocumentException',
  'UnsupportedDocumentException',
  'InvalidParameterException',
  'DocumentTooLargeException',
]);

/**
 * One PNG per page, flattened onto white so text on a transparent background stays visible,
 * turned upright from its EXIF orientation, and scaled to fit Textract's limits. Falls back
 * to JPEG when a PNG would be over Textract's size limit.
 */
async function toTextractImages(path: string, pages: number): Promise<Buffer[]> {
  const images: Buffer[] = [];
  for (let page = 0; page < pages; page++) {
    const pipeline = sharp(path, { page })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    let image = await pipeline.clone().png().toBuffer();
    if (image.length > MAX_IMAGE_BYTES) {
      image = await pipeline.clone().jpeg({ quality: 85 }).toBuffer();
    }
    images.push(image);
  }
  return images;
}

/**
 * Reads image text with Amazon Textract's DetectDocumentText, sending the image bytes in the
 * request so no other principal needs the quarantined object. Every frame or page is read, up
 * to `MAX_IMAGE_PAGES`; an image with more, or one sharp cannot decode or Textract cannot
 * read, gives `ok: false`.
 */
export function createTextractReader({
  client,
}: {
  client: Pick<TextractClient, 'send'>;
}): ImageTextReader {
  return {
    async read(path) {
      let images: Buffer[];
      try {
        const { pages = 1 } = await sharp(path).metadata();
        if (pages > MAX_IMAGE_PAGES) {
          return { ok: false };
        }
        images = await toTextractImages(path, pages);
      } catch {
        return { ok: false };
      }
      const lines: string[] = [];
      for (const Bytes of images) {
        try {
          const { Blocks = [] } = await client.send(
            new DetectDocumentTextCommand({ Document: { Bytes } }),
          );
          for (const block of Blocks) {
            if (block.BlockType === 'LINE' && block.Text) {
              lines.push(block.Text);
            }
          }
        } catch (error) {
          if (error instanceof Error && UNREADABLE_ERRORS.has(error.name)) {
            return { ok: false };
          }
          throw error;
        }
      }
      return { ok: true, text: lines.join('\n') };
    },
  };
}
