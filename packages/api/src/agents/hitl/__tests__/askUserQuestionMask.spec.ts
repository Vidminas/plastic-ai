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

  it('passes chosen option values through and masks only typed answers', async () => {
    const maskAll = jest.fn(async () => '{USERNAME}');
    jest.mocked(askUserQuestions).mockReturnValue({
      answers: { stage: 'just_starting', fields: 'physics, maths', why: 'my_own_words' },
    });
    const tool = createAskUserQuestionTool(undefined, { maskText: maskAll });
    const result = await tool.invoke(
      call({
        questions: [
          {
            id: 'stage',
            question: 'Where are you?',
            options: [
              { label: 'Just starting', value: 'just_starting' },
              { label: 'Nearly decided', value: 'nearly_decided' },
            ],
          },
          {
            id: 'fields',
            question: 'Which fields?',
            multiSelect: true,
            options: [
              { label: 'Physics', value: 'physics' },
              { label: 'Maths', value: 'maths' },
            ],
          },
          {
            id: 'why',
            question: 'Why?',
            options: [{ label: 'Interest', value: 'interest' }],
          },
        ],
      }),
    );
    expect(JSON.parse(result.content as string)).toEqual({
      answers: { stage: 'just_starting', fields: 'physics, maths', why: '{USERNAME}' },
    });
    expect(maskAll).toHaveBeenCalledTimes(1);
    expect(maskAll).toHaveBeenCalledWith('my_own_words');
  });

  it('masks a multi-select answer that mixes option values with typed text', async () => {
    jest.mocked(askUserQuestions).mockReturnValue({
      answers: { fields: 'physics, sam@example.com' },
    });
    const tool = createAskUserQuestionTool(undefined, { maskText: maskEmail });
    const result = await tool.invoke(
      call({
        questions: [
          {
            id: 'fields',
            question: 'Which fields?',
            multiSelect: true,
            options: [
              { label: 'Physics', value: 'physics' },
              { label: 'Maths', value: 'maths' },
            ],
          },
        ],
      }),
    );
    expect(JSON.parse(result.content as string)).toEqual({
      answers: { fields: 'physics, {EMAIL}' },
    });
  });

  it('masks answers that are not plain text, and any other text in the resolution', async () => {
    jest.mocked(askUserQuestions).mockReturnValue({
      answers: { contact: ['physics', 'sam@example.com'], when: { note: 'pat@example.com' } },
      comment: 'Reach me at lee@example.com',
    } as unknown as ReturnType<typeof askUserQuestions>);
    const tool = createAskUserQuestionTool(undefined, { maskText: maskEmail });
    const result = await tool.invoke(
      call({
        questions: [
          {
            id: 'contact',
            question: 'How?',
            options: [{ label: 'Physics', value: 'physics' }],
          },
          { id: 'when', question: 'When?' },
        ],
      }),
    );
    expect(JSON.parse(result.content as string)).toEqual({
      answers: { contact: ['physics', '{EMAIL}'], when: { note: '{EMAIL}' } },
      comment: 'Reach me at {EMAIL}',
    });
  });

  it('passes a single option value that contains a comma through', async () => {
    const maskAll = jest.fn(async () => '{USERNAME}');
    jest.mocked(askUserQuestions).mockReturnValue({ answers: { go: 'yes, please' } });
    const tool = createAskUserQuestionTool(undefined, { maskText: maskAll });
    const result = await tool.invoke(
      call({
        questions: [
          {
            id: 'go',
            question: 'Go on?',
            options: [
              { label: 'Yes, please', value: 'yes, please' },
              { label: 'No', value: 'no' },
            ],
          },
        ],
      }),
    );
    expect(JSON.parse(result.content as string)).toEqual({ answers: { go: 'yes, please' } });
    expect(maskAll).not.toHaveBeenCalled();
  });

  it('passes a chosen legacy option value through', async () => {
    const maskAll = jest.fn(async () => '{USERNAME}');
    jest.mocked(askUserQuestion).mockReturnValue({ answer: 'goal_changed' });
    const tool = createAskUserQuestionTool(undefined, { maskText: maskAll });
    const result = await tool.invoke(
      call({
        question: 'Carry on?',
        options: [
          { label: 'Carry on', value: 'continue' },
          { label: 'My goal has changed', value: 'goal_changed' },
        ],
      }),
    );
    expect(JSON.parse(result.content as string)).toEqual({ answer: 'goal_changed' });
    expect(maskAll).not.toHaveBeenCalled();
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
