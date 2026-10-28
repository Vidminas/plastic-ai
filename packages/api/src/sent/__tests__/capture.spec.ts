import { logger } from '@librechat/data-schemas';
import { SENT_PROMPT_TEXT_MAX } from 'librechat-data-provider';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { snapshotOf, sentPromptCallbacks, createSentPromptCallback } from '../capture';

const agentCall = { langgraph_node: 'agent=a1', langgraph_step: 1 };

/** Calls the handler the way LangChain does: llm, messages, runId, parent, extra, tags, metadata. */
const start = (
  callback: ReturnType<typeof createSentPromptCallback>,
  messages: unknown,
  extra: unknown = {},
  metadata: unknown = agentCall,
) => callback.handleChatModelStart({}, messages, 'run', undefined, extra, [], metadata);

describe('snapshotOf', () => {
  it('keeps the system content, the last user message, and counts the rest', () => {
    const snapshot = snapshotOf(
      [
        [
          new SystemMessage('Be helpful.'),
          new HumanMessage('Earlier question'),
          new AIMessage('Earlier answer'),
          new HumanMessage({
            content: [
              { type: 'text', text: 'What is in this?' },
              { type: 'image_url', image_url: { url: 'data:…' } },
              { type: 'document', document: { name: 'notes.pdf' } },
              { type: 'cachePoint' },
            ],
          }),
        ],
      ],
      { invocation_params: { tools: [{ name: 'web_search' }, { function: { name: 'calc' } }] } },
    );
    expect(snapshot).toEqual({
      system: 'Be helpful.',
      message: 'What is in this?\n[image]\n[file: notes.pdf]',
      historyCount: 2,
      tools: ['web_search', 'calc'],
      truncated: false,
    });
  });

  it("reads Bedrock's tool specs, and plain role objects", () => {
    expect(
      snapshotOf(
        [
          { role: 'system', content: 'A' },
          { role: 'system', content: [{ type: 'text', text: 'B' }] },
          { role: 'user', content: 'Hi' },
        ],
        {
          invocation_params: {
            toolConfig: { tools: [{ toolSpec: { name: 'ask_user_question' } }] },
          },
        },
      ),
    ).toEqual({
      system: 'A\n\nB',
      message: 'Hi',
      historyCount: 0,
      tools: ['ask_user_question'],
      truncated: false,
    });
  });

  it('cuts long text at the limit and says so', () => {
    const long = 'x'.repeat(SENT_PROMPT_TEXT_MAX + 5);
    const snapshot = snapshotOf([new SystemMessage(long), new HumanMessage('hi')]);
    expect(snapshot.system).toHaveLength(SENT_PROMPT_TEXT_MAX);
    expect(snapshot.truncated).toBe(true);
  });

  it('gives an empty snapshot for shapes it does not know', () => {
    expect(snapshotOf('nonsense', null)).toEqual({
      system: '',
      message: '',
      historyCount: 0,
      tools: [],
      truncated: false,
    });
    expect(snapshotOf([null, 3, { content: { odd: true } }]).historyCount).toBe(3);
  });
});

describe('createSentPromptCallback', () => {
  it("keeps only the turn's first agent call, once it has ended", () => {
    const onCapture = jest.fn();
    const callback = createSentPromptCallback({ onCapture });
    start(callback, [[new HumanMessage('summarise this')]], {}, { langgraph_node: 'summarize=a1' });
    callback.handleLLMEnd({}, 'run');
    start(callback, [[new SystemMessage('S'), new HumanMessage('first')]]);
    expect(onCapture).not.toHaveBeenCalled();
    callback.handleLLMEnd({}, 'run');
    start(callback, [[new SystemMessage('S'), new HumanMessage('first'), new AIMessage('tool')]]);
    callback.handleLLMEnd({}, 'run');
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ message: 'first' }));
  });

  it('keeps nothing from a call that is refused or fails, and keeps the next one', () => {
    const onCapture = jest.fn();
    const callback = createSentPromptCallback({ onCapture });
    start(callback, [[new HumanMessage('blocked')]]);
    callback.handleLLMError(new Error('refused'), 'run');
    callback.handleLLMEnd({}, 'run');
    expect(onCapture).not.toHaveBeenCalled();
    start(callback, [[new HumanMessage('sent')]]);
    callback.handleLLMEnd({}, 'other-run');
    expect(onCapture).not.toHaveBeenCalled();
    callback.handleLLMEnd({}, 'run');
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ message: 'sent' }));
  });

  it('never throws into the run', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const callback = createSentPromptCallback({
      onCapture: () => {
        throw new Error('db down');
      },
    });
    start(callback, [[new HumanMessage('hi')]]);
    expect(() => callback.handleLLMEnd({}, 'run')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('sentPromptCallbacks', () => {
  const ids = { user: 'u1', conversationId: 'c1', messageId: 'm1' };

  it('adds nothing while the feature is off, in a temporary chat, or without a user message', () => {
    const saveSentPrompt = jest.fn();
    expect(sentPromptCallbacks({ ...ids, config: {}, saveSentPrompt })).toEqual([]);
    expect(
      sentPromptCallbacks({
        ...ids,
        isTemporary: true,
        config: { interfaceConfig: { sentPrompt: true } },
        saveSentPrompt,
      }),
    ).toEqual([]);
    expect(
      sentPromptCallbacks({
        ...ids,
        messageId: null,
        config: { interfaceConfig: { sentPrompt: true } },
        saveSentPrompt,
      }),
    ).toEqual([]);
  });

  it("saves the first agent call against the user's message, logging a failed save", async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const saveSentPrompt = jest.fn().mockRejectedValue(new Error('db down'));
    const [callback] = sentPromptCallbacks({
      ...ids,
      config: { interfaceConfig: { sentPrompt: true } },
      saveSentPrompt,
    });
    start(callback, [[new SystemMessage('S'), new HumanMessage('hi')]]);
    callback.handleLLMEnd({}, 'run');
    expect(saveSentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ ...ids, system: 'S', message: 'hi' }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledWith(
      '[sent] Could not save what the turn sent',
      expect.any(Object),
    );
    warn.mockRestore();
  });
});
