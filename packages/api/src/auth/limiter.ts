import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { ErrorTypes, ViolationTypes } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from 'express-rate-limit';
import type { TwoFactorTempRequest } from './tempuser';
import { redirectToAuthFailure } from '~/oauth/callback';

type ViolationMessage = {
  type: ViolationTypes;
  max: string | number;
  limiter: string;
  windowInMinutes: number;
};

export interface TwoFactorLimiterDependencies {
  env: NodeJS.ProcessEnv;
  limiterCache: (prefix: string) => Store | undefined;
  removePorts: (req: Request) => string | undefined;
  logViolation: (
    req: Request,
    res: Response,
    type: ViolationTypes,
    message: ViolationMessage,
    score: string | number | undefined,
  ) => Promise<void>;
}

interface TwoFactorLimiterPolicy {
  namespace: string;
  windowMinutes: string | number;
  max: string | number;
  score: string | number | undefined;
  describeAttempts: string;
}

export function createTwoFactorLimiter(
  deps: TwoFactorLimiterDependencies,
  policy: TwoFactorLimiterPolicy,
) {
  const { namespace, max, score, describeAttempts } = policy;
  const windowMs = Number(policy.windowMinutes) * 60 * 1000;
  const windowInMinutes = windowMs / 60000;
  const message = `Too many ${describeAttempts}, please try again after ${windowInMinutes} minutes.`;

  const getEnrollmentToken = (req: TwoFactorTempRequest): string | undefined =>
    req.body?.[req.twoFactorTokenField ?? 'tempToken'];

  const getUserLimiterKey = (req: Request): string => {
    const tempReq = req as TwoFactorTempRequest;
    const userId = tempReq.user?.id ?? tempReq.user?._id;
    if (userId) {
      return `user:${userId.toString()}`;
    }
    const token = getEnrollmentToken(tempReq);
    if (typeof token === 'string' && token) {
      return `temp:${createHash('sha256').update(token).digest('hex')}`;
    }
    const ip = deps.removePorts(req);
    return ip ? `ip:${ip}` : 'ip:unknown';
  };

  const getTempTokenUserId = (token: string | undefined): string | null => {
    if (!token) {
      return null;
    }
    try {
      const payload = jwt.verify(token, deps.env.JWT_SECRET ?? '');
      return typeof payload === 'object' && typeof payload.userId === 'string'
        ? payload.userId
        : null;
    } catch {
      return null;
    }
  };

  const createHandler =
    (limiter: string) =>
    async (req: Request, res: Response): Promise<Response> => {
      const type = ViolationTypes.LOGINS;
      const errorMessage = { type, max, limiter, windowInMinutes };
      const tempReq = req as TwoFactorTempRequest;
      const userId = getTempTokenUserId(getEnrollmentToken(tempReq));
      if (userId && !tempReq.user) {
        tempReq.user = { id: userId };
      } else if (userId && tempReq.user && !tempReq.user.id && !tempReq.user._id) {
        tempReq.user.id = userId;
      }
      await deps.logViolation(req, res, type, errorMessage, score);
      return res.status(429).json({ message });
    };

  const ipLimiter = rateLimit({
    windowMs,
    max: Number(max),
    skip: (req) =>
      namespace === 'two_factor_setup' &&
      Boolean((req as TwoFactorTempRequest).user?.id ?? (req as TwoFactorTempRequest).user?._id),
    handler: createHandler('ip'),
    keyGenerator: deps.removePorts as (req: Request) => string,
    store: deps.limiterCache(`${namespace}_limiter`),
  });
  const userLimiter = rateLimit({
    windowMs,
    max: Number(max),
    handler: createHandler('user'),
    keyGenerator: getUserLimiterKey,
    store: deps.limiterCache(`${namespace}_user_limiter`),
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    ipLimiter(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      userLimiter(req, res, next);
    });
  };
}

export function createTwoFactorLimiters(deps: TwoFactorLimiterDependencies): {
  twoFactorTempLimiter: (req: Request, res: Response, next: NextFunction) => void;
  twoFactorSetupLimiter: (req: Request, res: Response, next: NextFunction) => void;
} {
  const {
    LOGIN_WINDOW = 5,
    LOGIN_MAX = 7,
    LOGIN_VIOLATION_SCORE,
    TWO_FACTOR_TEMP_WINDOW = LOGIN_WINDOW,
    TWO_FACTOR_TEMP_MAX = LOGIN_MAX,
    TWO_FACTOR_TEMP_VIOLATION_SCORE,
    TWO_FACTOR_SETUP_WINDOW = TWO_FACTOR_TEMP_WINDOW,
    TWO_FACTOR_SETUP_MAX = 20,
    TWO_FACTOR_SETUP_VIOLATION_SCORE,
  } = deps.env;

  return {
    twoFactorTempLimiter: createTwoFactorLimiter(deps, {
      namespace: 'two_factor_temp',
      windowMinutes: TWO_FACTOR_TEMP_WINDOW,
      max: TWO_FACTOR_TEMP_MAX,
      score: TWO_FACTOR_TEMP_VIOLATION_SCORE ?? LOGIN_VIOLATION_SCORE,
      describeAttempts: 'verification attempts',
    }),
    twoFactorSetupLimiter: createTwoFactorLimiter(deps, {
      namespace: 'two_factor_setup',
      windowMinutes: TWO_FACTOR_SETUP_WINDOW,
      max: TWO_FACTOR_SETUP_MAX,
      score:
        TWO_FACTOR_SETUP_VIOLATION_SCORE ??
        TWO_FACTOR_TEMP_VIOLATION_SCORE ??
        LOGIN_VIOLATION_SCORE,
      describeAttempts: 'two-factor setup requests',
    }),
  };
}

export interface LoginUserLimiterDependencies {
  env: NodeJS.ProcessEnv;
  limiterCache: (prefix: string) => Store | undefined;
  logViolation: TwoFactorLimiterDependencies['logViolation'];
}

type LoginUserRequest = Request & {
  user?: { id?: string; _id?: { toString(): string } };
  isOAuthNavigation?: boolean;
};

const getLoginUserId = (req: Request): string | undefined => {
  const user = (req as LoginUserRequest).user;
  return user?.id ?? user?._id?.toString();
};

/**
 * Limits sign-ins per account, from any address, once authentication has named the user
 * (`req.user`). Off unless `LIMIT_LOGIN_USER` is true; `LOGIN_USER_MAX` sign-ins are allowed
 * every `LOGIN_USER_WINDOW` minutes. A request with no user passes through.
 */
export function createLoginUserLimiter(
  deps: LoginUserLimiterDependencies,
): (req: Request, res: Response, next: NextFunction) => void {
  const {
    LIMIT_LOGIN_USER,
    LOGIN_USER_MAX = 20,
    LOGIN_USER_WINDOW = 5,
    LOGIN_VIOLATION_SCORE: score,
  } = deps.env;
  if (LIMIT_LOGIN_USER?.toLowerCase().trim() !== 'true') {
    return (_req, _res, next) => next();
  }

  const max = Number(LOGIN_USER_MAX);
  const windowMs = Number(LOGIN_USER_WINDOW) * 60 * 1000;
  const windowInMinutes = windowMs / 60000;
  const message = `Too many login attempts, please try again after ${windowInMinutes} minutes.`;

  return rateLimit({
    windowMs,
    max,
    skip: (req) => getLoginUserId(req) == null,
    keyGenerator: (req) => `user:${getLoginUserId(req)}`,
    store: deps.limiterCache('login_user_limiter'),
    handler: async (req: Request, res: Response) => {
      const type = ViolationTypes.LOGINS;
      await deps.logViolation(
        req,
        res,
        type,
        { type, max, limiter: 'user', windowInMinutes },
        score,
      );
      /** A browser navigation would render the JSON body as the page. */
      if ((req as LoginUserRequest).isOAuthNavigation === true) {
        return redirectToAuthFailure(res, {
          clientDomain: deps.env.DOMAIN_CLIENT ?? '',
          authFailedError: ErrorTypes.AUTH_RATE_LIMITED,
        });
      }
      return res.status(429).json({ message });
    },
  });
}
