import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;

/** One in-memory replica set for the whole run; each test file uses its own database. */
export async function setup({ provide }) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  provide('mongoUri', replSet.getUri());
}

export async function teardown() {
  await replSet?.stop();
  fs.rmSync(path.resolve(import.meta.dirname, '../.data/test-uploads'), { recursive: true, force: true });
}
