const {
  createAgencyClassifier,
  withClassifierSpans,
  createAgencyEventRecorder,
  createAgencyClassifierInvoker,
} = require('@librechat/api');
const db = require('~/models');

let agencyClassifier;

/**
 * Labels support types and topics for the agency recap (`agency.classifier`). Built on first
 * use, since most requests never need it.
 */
const getAgencyClassifier = () =>
  (agencyClassifier ??= createAgencyClassifier({
    invoke: createAgencyClassifierInvoker({
      db: { getUserKey: db.getUserKey, getUserKeyValues: db.getUserKeyValues },
      usage: {
        spendTokens: db.spendTokens,
        spendStructuredTokens: db.spendStructuredTokens,
        pricing: { getMultiplier: db.getMultiplier, getCacheMultiplier: db.getCacheMultiplier },
        bulkWriteOps: { insertMany: db.bulkInsertTransactions, updateBalance: db.updateBalance },
      },
    }),
    record: withClassifierSpans(
      createAgencyEventRecorder({ recordAgencyEvent: db.recordAgencyEvent }),
    ),
    getConversationGoal: db.getConversationGoal,
    getMessages: db.getMessages,
  }));

module.exports = { getAgencyClassifier };
