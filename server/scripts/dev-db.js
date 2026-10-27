/**
 * Starts a single-node MongoDB replica set for local development without installing MongoDB
 * (replica set = transactions available). Data persists in server/.data/mongo.
 * Point MONGODB_URI at mongodb://127.0.0.1:27017/senova?replicaSet=senova-dev
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.DEV_DB_PORT ?? 27017);
const dbPath = path.resolve(import.meta.dirname, '../.data/mongo');
fs.mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'senova-dev', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath, storageEngine: 'wiredTiger' }],
});

console.log(`Development MongoDB running: mongodb://127.0.0.1:${port}/senova?replicaSet=senova-dev`);
console.log(`Data directory: ${dbPath}. Press Ctrl+C to stop.`);

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
