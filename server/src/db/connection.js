import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri, options = {}) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, ...options });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}
