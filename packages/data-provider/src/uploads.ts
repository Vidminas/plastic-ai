/**
 * Upload restrictions shared by the composer and the server (`fileConfig.allowedExtensions`).
 * The extension is the file name's own, so this is a policy on what users may upload, not a
 * check of the bytes; the MIME allowlists still apply alongside it.
 */

/** Lower-cased extensions without their leading dot, so `.PDF` and `pdf` both read `pdf`. */
export function normalizeFileExtensions(extensions: string[]): string[] {
  return extensions.map((extension) => extension.trim().replace(/^\./, '').toLowerCase());
}

/** The text after a file name's last dot, lower-cased; empty when the name has none. */
export function getFileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Whether a file may be uploaded under `allowedExtensions`; no list allows every name. */
export function isAllowedFileExtension(
  fileName: string,
  allowedExtensions: string[] | undefined,
): boolean {
  if (allowedExtensions == null) {
    return true;
  }
  const extension = getFileExtension(fileName);
  return extension !== '' && normalizeFileExtensions(allowedExtensions).includes(extension);
}
