import { open } from 'node:fs/promises';

/** How a file is screened: documents and text have their text checked; images do not. */
export type ScreenedKind = 'document' | 'text' | 'image';

interface FileKind {
  readonly kind: ScreenedKind;
  /** Whether the first bytes are what the extension promises. Text is checked in full later. */
  readonly matches: (head: Buffer) => boolean;
}

const HEAD_BYTES = 64;

const startsWith =
  (...signatures: readonly (readonly number[])[]) =>
  (head: Buffer): boolean =>
    signatures.some((signature) => signature.every((byte, index) => head[index] === byte));

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const pdf: FileKind = {
  kind: 'document',
  /** Readers accept a little junk before the header, so look for it near the start. */
  matches: (head) => head.includes('%PDF-'),
};
/** docx, xlsx, pptx, odt and ods are all ZIP containers; the parser checks what is inside. */
const zip: FileKind = { kind: 'document', matches: startsWith([0x50, 0x4b, 0x03, 0x04]) };
/** Legacy .xls is an OLE compound file. */
const ole: FileKind = {
  kind: 'document',
  matches: startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};
const text: FileKind = { kind: 'text', matches: () => true };

const image = (matches: FileKind['matches']): FileKind => ({ kind: 'image', matches });

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const heif = image(
  (head) =>
    head.toString('latin1', 4, 8) === 'ftyp' && HEIF_BRANDS.has(head.toString('latin1', 8, 12)),
);

const KINDS: Readonly<Record<string, FileKind>> = {
  pdf,
  docx: zip,
  xlsx: zip,
  pptx: zip,
  odt: zip,
  ods: zip,
  xls: ole,
  txt: text,
  md: text,
  csv: text,
  tsv: text,
  json: text,
  xml: text,
  yaml: text,
  yml: text,
  htm: text,
  html: text,
  svg: text,
  png: image(startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: image(startsWith([0xff, 0xd8, 0xff])),
  jpeg: image(startsWith([0xff, 0xd8, 0xff])),
  jpe: image(startsWith([0xff, 0xd8, 0xff])),
  gif: image(startsWith(ascii('GIF87a'), ascii('GIF89a'))),
  bmp: image(startsWith(ascii('BM'))),
  webp: image(
    (head) => startsWith(ascii('RIFF'))(head) && head.toString('latin1', 8, 12) === 'WEBP',
  ),
  tif: image(startsWith([0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a])),
  tiff: image(startsWith([0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a])),
  jp2: image(
    startsWith(
      [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a],
      [0xff, 0x4f, 0xff, 0x51],
    ),
  ),
  heic: heif,
  heif,
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export type ContentCheck =
  | { readonly ok: true; readonly kind: ScreenedKind }
  | { readonly ok: false; readonly reason: 'unsupported_type' | 'type_mismatch' };

/**
 * Checks that a file's first bytes match its extension, so a renamed executable or archive
 * cannot pass as a document or image. Extensions it has no signature for are refused, since
 * their content could not be screened.
 */
export async function checkFileContent(path: string, filename: string): Promise<ContentCheck> {
  const fileKind = KINDS[extensionOf(filename)];
  if (fileKind == null) {
    return { ok: false, reason: 'unsupported_type' };
  }
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0);
    return fileKind.matches(head.subarray(0, bytesRead))
      ? { ok: true, kind: fileKind.kind }
      : { ok: false, reason: 'type_mismatch' };
  } finally {
    await handle.close();
  }
}
