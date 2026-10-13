import express from 'express';
import request from 'supertest';
import { ViolationTypes } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import { createLoginUserLimiter } from './limiter';

const env = {
  DOMAIN_CLIENT: 'http://client.test',
  LIMIT_LOGIN_USER: 'true',
  LOGIN_USER_MAX: '2',
  LOGIN_USER_WINDOW: '5',
};

/** The OpenID callback as the app mounts it: authentication names the user, then the limiter. */
const createApp = (limiterEnv: NodeJS.ProcessEnv = env) => {
  const logViolation = jest.fn().mockResolvedValue(undefined);
  const limiter = createLoginUserLimiter({
    env: limiterEnv,
    limiterCache: () => undefined,
    logViolation,
  });
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const user = req.header('x-user');
    Object.assign(req, { isOAuthNavigation: true, user: user ? { id: user } : undefined });
    next();
  });
  app.get('/oauth/openid/callback', limiter, (_req, res) => {
    res.status(204).end();
  });
  return { app, logViolation };
};

const signIn = (app: express.Express, user?: string) => {
  const req = request(app).get('/oauth/openid/callback');
  return user ? req.set('x-user', user) : req;
};

describe('createLoginUserLimiter', () => {
  it('sends a user back to the login page after too many sign-ins, whatever their address', async () => {
    const { app, logViolation } = createApp();
    await signIn(app, 'u1').set('x-forwarded-for', '198.51.100.1').expect(204);
    await signIn(app, 'u1').set('x-forwarded-for', '198.51.100.2').expect(204);

    const response = await signIn(app, 'u1').expect(302);
    expect(response.headers.location).toBe(
      'http://client.test/login?redirect=false&error=auth_rate_limited',
    );
    expect(logViolation).toHaveBeenCalledTimes(1);
    expect(logViolation.mock.calls[0][2]).toBe(ViolationTypes.LOGINS);
    expect(logViolation.mock.calls[0][3]).toEqual({
      type: ViolationTypes.LOGINS,
      max: 2,
      limiter: 'user',
      windowInMinutes: 5,
    });
  });

  it('counts each user separately, and passes requests with no user', async () => {
    const { app } = createApp();
    await signIn(app, 'u1').expect(204);
    await signIn(app, 'u1').expect(204);
    await signIn(app, 'u2').expect(204);
    const anonymous = [await signIn(app), await signIn(app), await signIn(app)];
    expect(anonymous.map((response) => response.status)).toEqual([204, 204, 204]);
  });

  it('is off unless LIMIT_LOGIN_USER is true', async () => {
    const { app, logViolation } = createApp({ ...env, LIMIT_LOGIN_USER: undefined });
    for (let i = 0; i < 4; i++) {
      await signIn(app, 'u1').expect(204);
    }
    expect(logViolation).not.toHaveBeenCalled();
  });
});
