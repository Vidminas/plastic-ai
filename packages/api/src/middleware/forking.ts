import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * Rejects conversation forks when the deployment set `interface.forking: false`, so a
 * deployment that hides the Fork button also refuses the request. Requires the app
 * config to already be resolved onto the request.
 */
export function requireForkingEnabled(req: ServerRequest, res: Response, next: NextFunction): void {
  if (req.config?.interfaceConfig?.forking === false) {
    res.status(403).json({ error: 'Forking is disabled' });
    return;
  }
  next();
}
