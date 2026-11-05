import type { OtlpSpan } from '~/safeguarding/sink';
import { recordLoginRefusal, recordParticipant } from './participant';

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

describe('recordLoginRefusal', () => {
  const tokenset = { claims: () => ({ sub: 'cog-5', email: 'five@study.test' }) };

  it.each([
    ['Email domain not allowed', 'domain_not_allowed'],
    ['auth_failed', 'auth_failed'],
    ['You must have student role to log in.', 'role_required'],
    ['connection reset', 'error'],
  ])('sends the Cognito ID, email and a reason code for "%s"', async (message, reason) => {
    const send = jest.fn(async (_span: OtlpSpan) => undefined);
    recordLoginRefusal(tokenset, new Error(message), send);
    await flush();
    expect(send).toHaveBeenCalledWith({
      name: 'login.refused',
      scope: 'participant',
      attributes: { cognitoId: 'cog-5', email: 'five@study.test', reason },
    });
  });

  it('reads plain claims, and sends no identity when the claims fail', async () => {
    const send = jest.fn(async (_span: OtlpSpan) => undefined);
    recordLoginRefusal({ sub: 'cog-6' }, new Error('x'), send);
    recordLoginRefusal(
      {
        claims: () => {
          throw new Error('no id token');
        },
      },
      new Error('x'),
      send,
    );
    await flush();
    expect(send.mock.calls[0][0].attributes).toMatchObject({ cognitoId: 'cog-6' });
    expect(send.mock.calls[1][0].attributes).toEqual({
      cognitoId: undefined,
      email: undefined,
      reason: 'error',
    });
  });
});
