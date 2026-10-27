import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let transport;
const sentInTest = [];

function getTransport() {
  if (transport) return transport;
  if (env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transport;
}

/**
 * Sends an email. Without SMTP configured (development only — production config requires it),
 * the message is written to the server console so invite/reset links can be followed locally.
 */
export async function sendMail({ to, subject, text }) {
  if (env.isTest) {
    sentInTest.push({ to, subject, text });
    return;
  }
  const t = getTransport();
  if (!t) {
    logger.warn({ to, subject }, `SMTP not configured — email not sent. Development preview:\n${text}`);
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

/** Test helper: messages "sent" during tests. */
export function takeSentMail() {
  return sentInTest.splice(0, sentInTest.length);
}
