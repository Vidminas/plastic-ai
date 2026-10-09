import { getBasePath } from '~/utils/path';

/**
 * Where the app serves S3 objects itself when `S3_PROXY_FILES` is on. A link is
 * this route followed by the object's key, so it never expires and the key
 * names the owner the route authorizes against.
 */
export const S3_PROXY_ROUTE = '/api/s3-files';

/** The app's link to an S3 object, with `filename` set for a download. */
export function getS3ProxyURL(key: string, filename?: string | null): string {
  const path = key
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `${getBasePath()}${S3_PROXY_ROUTE}/${path}`;
  return filename ? `${url}?filename=${encodeURIComponent(filename)}` : url;
}

/** The S3 key behind one of the app's links, or `null` for any other value. */
export function getKeyFromS3ProxyURL(value: string): string | null {
  const prefix = `${getBasePath()}${S3_PROXY_ROUTE}/`;
  if (!value.startsWith(prefix)) {
    return null;
  }
  const path = value.slice(prefix.length).split(/[?#]/, 1)[0];
  try {
    return path.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}
