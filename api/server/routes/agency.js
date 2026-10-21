const express = require('express');
const { createAgencyHandlers, createAgencyEventRecorder } = require('@librechat/api');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createAgencyHandlers({
  getAgencyIntentions: db.getAgencyIntentions,
  setAgencyIntentions: db.setAgencyIntentions,
  getConversationGoal: db.getConversationGoal,
  setConversationGoal: db.setConversationGoal,
  getAgencyRecap: db.getAgencyRecap,
  getConvo: db.getConvo,
  listAgencyReflections: db.listAgencyReflections,
  createAgencyReflection: db.createAgencyReflection,
  updateAgencyReflection: db.updateAgencyReflection,
  record: createAgencyEventRecorder({ recordAgencyEvent: db.recordAgencyEvent }),
});

router.use(requireJwtAuth, configMiddleware);
router.get('/intentions', handlers.getIntentions);
router.put('/intentions', handlers.putIntentions);
router.get('/conversations/:conversationId/goal', handlers.getGoal);
router.put('/conversations/:conversationId/goal', handlers.putGoal);
router.post('/events', handlers.postEvent);
router.get('/recap', handlers.getRecap);
router.get('/reflections', handlers.getReflections);
router.post('/reflections', handlers.postReflection);
router.patch('/reflections/:reflectionId', handlers.patchReflection);

module.exports = router;
