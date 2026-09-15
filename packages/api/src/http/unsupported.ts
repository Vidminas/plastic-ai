import express from 'express';

import type { RequestHandler, Router } from 'express';

export interface UnsupportedFeatureBody {
  error: 'unsupported_feature';
  feature: string;
  message: string;
}

export function unsupportedFeature(feature: string): RequestHandler {
  return (_req, res) => {
    const body: UnsupportedFeatureBody = {
      error: 'unsupported_feature',
      feature,
      message: `${feature} is not available with the DynamoDB core persistence profile.`,
    };
    res.status(501).json(body);
  };
}

export function createUnsupportedRouter(feature: string): Router {
  const router = express.Router();
  router.use(unsupportedFeature(feature));
  return router;
}
