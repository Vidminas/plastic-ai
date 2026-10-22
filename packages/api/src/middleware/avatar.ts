import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * Rejects profile picture uploads when the deployment set `interface.avatarUpload: false`, so a
 * deployment that hides the setting also refuses the request, before the file is read. Requires
 * the app config to already be resolved onto the request.
 */
export function requireAvatarUploadEnabled(
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.config?.interfaceConfig?.avatarUpload === false) {
    res.status(403).json({ error: 'Profile picture uploads are disabled' });
    return;
  }
  next();
}
