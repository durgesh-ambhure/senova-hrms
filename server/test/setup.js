import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';

beforeAll(async () => {
  await mongoose.connect(inject('mongoUri'), { dbName: `test_${crypto.randomBytes(6).toString('hex')}` });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
