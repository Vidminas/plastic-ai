import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@librechat/agents/langchain/messages';
import { maskModelMessages, maskTitleInput } from '../messages';

const maskEmail = jest.fn(async (text: string) => text.replace(/\S+@\S+\.\w+/g, '{EMAIL}'));

describe('maskModelMessages', () => {
  beforeEach(() => maskEmail.mockClear());

  it('masks the text of human and model messages, history included', async () => {
    const messages = [
      new SystemMessage('Contact the admin at admin@example.com'),
      new HumanMessage('My email is sam@example.com'),
      new AIMessage({
        content: [
          { type: 'text', text: 'Noted: sam@example.com' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      }),
      new HumanMessage({ content: [{ type: 'text', text: 'Write to jo@example.com too' }] }),
    ];
    await maskModelMessages(messages, maskEmail);

    expect(messages[0].content).toBe('Contact the admin at admin@example.com');
    expect(messages[1].content).toBe('My email is {EMAIL}');
    expect(messages[2].content).toEqual([
      { type: 'text', text: 'Noted: {EMAIL}' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
    expect(messages[3].content).toEqual([{ type: 'text', text: 'Write to {EMAIL} too' }]);
  });

  it('leaves tool results alone and keeps tool calls on model messages', async () => {
    const call = { id: 'call-1', name: 'lookup', args: { q: 'sam@example.com' } };
    const ai = new AIMessage({ content: 'Looking up sam@example.com', tool_calls: [call] });
    const tool = new ToolMessage({ content: 'Found sam@example.com', tool_call_id: 'call-1' });
    await maskModelMessages([ai, tool], maskEmail);

    expect(ai.content).toBe('Looking up {EMAIL}');
    expect(ai.tool_calls).toEqual([expect.objectContaining(call)]);
    expect(tool.content).toBe('Found sam@example.com');
  });

  it('updates the serialized fields a paused run is restored from', async () => {
    const message = new HumanMessage('My email is sam@example.com');
    await maskModelMessages([message], maskEmail);

    expect(message.lc_kwargs.content).toBe('My email is {EMAIL}');
    expect(JSON.stringify(message.toJSON())).not.toContain('sam@example.com');
  });

  it('does not change the content parts it was built from', async () => {
    const part = { type: 'text' as const, text: 'sam@example.com' };
    const message = new HumanMessage({ content: [part] });
    await maskModelMessages([message], maskEmail);

    expect(part.text).toBe('sam@example.com');
  });

  it('does nothing without a masker', async () => {
    const message = new HumanMessage('sam@example.com');
    await maskModelMessages([message], undefined);
    expect(message.content).toBe('sam@example.com');
  });

  it('fails rather than send text it could not mask', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('guardrail unavailable'));
    await expect(maskModelMessages([new HumanMessage('text')], failing)).rejects.toThrow(
      'guardrail unavailable',
    );
  });
});

describe('maskTitleInput', () => {
  it("masks the user's text and the response's text parts, as copies", async () => {
    const parts = [
      { type: 'text', text: 'I will email sam@example.com' },
      { type: 'tool_call', tool_call: { name: 'search' } },
    ];
    const result = await maskTitleInput(
      { inputText: 'Email sam@example.com', contentParts: parts },
      maskEmail,
    );

    expect(result.inputText).toBe('Email {EMAIL}');
    expect(result.contentParts).toEqual([
      { type: 'text', text: 'I will email {EMAIL}' },
      { type: 'tool_call', tool_call: { name: 'search' } },
    ]);
    expect(parts[0].text).toBe('I will email sam@example.com');
  });

  it('passes the input through without a masker', async () => {
    const input = { inputText: 'sam@example.com', contentParts: [] };
    expect(await maskTitleInput(input, undefined)).toEqual(input);
  });
});
