import { askUserQuestion, askUserQuestions } from '@librechat/agents';
import { createAskUserQuestionTool } from '../askUserQuestionTool';

/** The resume pass: the SDK helpers return the human's answers instead of interrupting. */
jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  askUserQuestion: jest.fn(),
  askUserQuestions: jest.fn(),
}));

const maskEmail = jest.fn(async (text: string) => text.replace(/\S+@\S+/g, '{EMAIL}'));

const call = (args: object) => ({
  id: 'call-1',
  name: 'ask_user_question',
  args,
  type: 'tool_call' as const,
});

describe('ask_user_question answer masking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('masks each answer of a batch before it becomes the tool result', async () => {
    jest.mocked(askUserQuestions).mockReturnValue({
      answers: { contact: 'Email me at sam@example.com', when: 'Tomorrow' },
    });
    const tool = createAskUserQuestionTool(undefined, { maskText: maskEmail });
    const result = await tool.invoke(
      call({
        questions: [
          { id: 'contact', question: 'How?' },
          { id: 'when', question: 'When?' },
        ],
      }),
    );
    expect(JSON.parse(result.content as string)).toEqual({
      answers: { contact: 'Email me at {EMAIL}', when: 'Tomorrow' },
    });
    expect(maskEmail).toHaveBeenCalledWith('Email me at sam@example.com');
    expect(maskEmail).not.toHaveBeenCalledWith('contact');
  });

  it('masks a single legacy answer', async () => {
    jest.mocked(askUserQuestion).mockReturnValue({ answer: 'sam@example.com' });
    const tool = createAskUserQuestionTool(undefined, { maskText: maskEmail });
    const result = await tool.invoke(call({ question: 'Your email?' }));
    expect(JSON.parse(result.content as string)).toEqual({ answer: '{EMAIL}' });
  });

  it('leaves answers as given without a masker', async () => {
    jest.mocked(askUserQuestions).mockReturnValue({ answers: { contact: 'sam@example.com' } });
    const result = await createAskUserQuestionTool().invoke(
      call({ questions: [{ id: 'contact', question: 'How?' }] }),
    );
    expect(JSON.parse(result.content as string)).toEqual({
      answers: { contact: 'sam@example.com' },
    });
  });

  it('fails the tool call rather than send an answer it could not mask', async () => {
    jest.mocked(askUserQuestions).mockReturnValue({ answers: { contact: 'sam@example.com' } });
    const failing = jest.fn().mockRejectedValue(new Error('guardrail unavailable'));
    const tool = createAskUserQuestionTool(undefined, { maskText: failing });
    await expect(
      tool.invoke(call({ questions: [{ id: 'contact', question: 'How?' }] })),
    ).rejects.toThrow('guardrail unavailable');
  });
});
