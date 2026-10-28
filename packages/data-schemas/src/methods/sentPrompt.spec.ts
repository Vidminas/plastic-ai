import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createSentPromptMethods, type SentPromptMethods } from './sentPrompt';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: SentPromptMethods;

const user = new mongoose.Types.ObjectId().toString();
const other = new mongoose.Types.ObjectId().toString();

const sent = (overrides: Record<string, unknown> = {}) => ({
  user,
  conversationId: 'c1',
  messageId: 'm1',
  system: 'Be helpful.',
  message: 'Hello',
  historyCount: 2,
  tools: ['web_search'],
  truncated: false,
  ...overrides,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  methods = createSentPromptMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all(
    ['SentPrompt', 'Conversation'].map((name) => mongoose.models[name].deleteMany({})),
  );
});

describe('sent prompts', () => {
  it('keeps what a message sent, the latest send replacing the last', async () => {
    await methods.saveSentPrompt(sent());
    await methods.saveSentPrompt(sent({ system: 'Be brief.', historyCount: 3 }));
    await expect(methods.getSentPrompt(user, 'c1', 'm1')).resolves.toEqual({
      system: 'Be brief.',
      message: 'Hello',
      historyCount: 3,
      tools: ['web_search'],
      truncated: false,
      createdAt: expect.any(String),
    });
    await expect(mongoose.models.SentPrompt.countDocuments({ user })).resolves.toBe(1);
  });

  it("gives nobody else's, and nothing for a message in another conversation", async () => {
    await methods.saveSentPrompt(sent());
    await expect(methods.getSentPrompt(other, 'c1', 'm1')).resolves.toBeNull();
    await expect(methods.getSentPrompt(user, 'c2', 'm1')).resolves.toBeNull();
  });

  it('deletes them with their conversation, and all of them with their user', async () => {
    const { createMethods } = await import('./index');
    const { deleteConvos } = createMethods(mongoose);
    await mongoose.models.Conversation.create([
      { conversationId: 'c1', user, endpoint: 'bedrock' },
      { conversationId: 'c2', user, endpoint: 'bedrock' },
    ]);
    await methods.saveSentPrompt(sent());
    await methods.saveSentPrompt(sent({ conversationId: 'c2', messageId: 'm2' }));
    await methods.saveSentPrompt(sent({ user: other }));

    await deleteConvos(user, { conversationId: 'c1' });
    await expect(methods.getSentPrompt(user, 'c1', 'm1')).resolves.toBeNull();
    await expect(methods.getSentPrompt(user, 'c2', 'm2')).resolves.not.toBeNull();

    await methods.deleteSentPromptsByUser(user);
    await expect(mongoose.models.SentPrompt.countDocuments({ user })).resolves.toBe(0);
    await expect(mongoose.models.SentPrompt.countDocuments({ user: other })).resolves.toBe(1);
  });
});
