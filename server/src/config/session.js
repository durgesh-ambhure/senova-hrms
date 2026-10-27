import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { env } from './env.js';

export const SESSION_COOKIE = 'senova.sid';

/** Server-side sessions in MongoDB; the browser only holds an opaque, HttpOnly session ID. */
export function createSessionMiddleware() {
  const ttlSeconds = Math.round(env.SESSION_TTL_HOURS * 3600);
  return session({
    name: SESSION_COOKIE,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: env.TRUST_PROXY > 0,
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
      collectionName: 'sessions',
      ttl: ttlSeconds,
      autoRemove: 'native',
    }),
    cookie: {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: ttlSeconds * 1000,
      path: '/',
    },
  });
}
