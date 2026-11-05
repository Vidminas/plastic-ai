import type { OtlpSpan } from '~/safeguarding/sink';
import { recordParticipant } from './participant';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('recordParticipant', () => {
  it('sends the user ID, Cognito ID and email one time', async () => {
    const send = jest.fn(async (_span: OtlpSpan) => undefined);
    const user = { id: 'u1', openidId: 'cog-1', email: 'one@study.test' };
    recordParticipant(user, send);
    recordParticipant(user, send);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({
      name: 'participant.seen',
      scope: 'participant',
      attributes: { userId: 'u1', cognitoId: 'cog-1', email: 'one@study.test' },
    });
  });

  it('sends again when the email changes', async () => {
    const send = jest.fn(async (_span: OtlpSpan) => undefined);
    recordParticipant({ id: 'u2', openidId: 'cog-2', email: 'old@study.test' }, send);
    recordParticipant({ id: 'u2', openidId: 'cog-2', email: 'new@study.test' }, send);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].attributes).toMatchObject({ email: 'new@study.test' });
  });

  it('sends again after a failed send', async () => {
    const send = jest.fn(async (_span: OtlpSpan) => undefined);
    send.mockRejectedValueOnce(new Error('collector answered 503'));
    const user = { id: 'u3', openidId: 'cog-3' };
    recordParticipant(user, send);
    await flush();
    recordParticipant(user, send);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends nothing without a user ID, or without a Cognito ID and email', async () => {
    const send = jest.fn(async (_span: OtlpSpan) => undefined);
    recordParticipant(undefined, send);
    recordParticipant({ openidId: 'cog-4' }, send);
    recordParticipant({ id: 'u4' }, send);
    await flush();
    expect(send).not.toHaveBeenCalled();
  });
});
