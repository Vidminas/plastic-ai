import { logger } from '@librechat/data-schemas';
import type { TSentPrompt } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import { getSafeErrorMetadata } from '~/utils/errors';

export interface SentPromptHandlerDeps {
  getSentPrompt(
    user: string,
    conversationId: string,
    messageId: string,
  ): Promise<TSentPrompt | null>;
}

type SentRequest = Request & { config?: AppConfig; user?: { id?: string } };

const NOT_FOUND = { message: 'Not found' };

/**
 * `GET /api/messages/:conversationId/:messageId/sent-prompt`: what the user's message sent the
 * model. 404 while `interface.sentPrompt` is off, and when nothing was kept for this message of
 * theirs; the route's own validation has already checked the conversation is theirs.
 */
export function createSentPromptHandler(deps: SentPromptHandlerDeps) {
  return async (req: Request, res: Response): Promise<unknown> => {
    const request = req as SentRequest;
    const userId = request.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (request.config?.interfaceConfig?.sentPrompt !== true) {
      return res.status(404).json(NOT_FOUND);
    }
    const { conversationId, messageId } = req.params as {
      conversationId?: string;
      messageId?: string;
    };
    if (!conversationId || !messageId) {
      return res.status(400).json({ message: 'Invalid message' });
    }
    try {
      const sentPrompt = await deps.getSentPrompt(userId, conversationId, messageId);
      return sentPrompt == null ? res.status(404).json(NOT_FOUND) : res.json({ sentPrompt });
    } catch (error) {
      logger.error('[sent] Could not load what a message sent', getSafeErrorMetadata(error));
      return res.status(500).json({ message: 'Failed to load what was sent' });
    }
  };
}
