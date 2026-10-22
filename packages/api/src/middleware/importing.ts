import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * Rejects conversation imports when the deployment set `interface.conversationImport: false`, so
 * a deployment that hides the import setting also refuses the request, before the file is read.
 * Requires the app config to already be resolved onto the request.
 */
export function requireConversationImportEnabled(
  req: ServerRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.config?.interfaceConfig?.conversationImport === false) {
    res.status(403).json({ error: 'Conversation import is disabled' });
    return;
  }
  next();
}
