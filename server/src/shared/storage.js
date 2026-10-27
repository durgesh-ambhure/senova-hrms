import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Private file storage behind an interface so a cloud provider (S3, Azure Blob, GCS — see
 * DECISIONS E4) can replace the local driver without touching business code.
 * Files are addressed by random keys; original names are kept only as metadata.
 */
class LocalStorage {
  constructor(root) {
    this.root = path.resolve(import.meta.dirname, '../..', root);
    fs.mkdirSync(this.root, { recursive: true });
  }

  #resolve(key) {
    if (!/^[a-z0-9/-]+$/i.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }

  async put(buffer, { prefix }) {
    const key = `${prefix}/${crypto.randomUUID()}`;
    const file = this.#resolve(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
    return key;
  }

  createReadStream(key) {
    return fs.createReadStream(this.#resolve(key));
  }

  async remove(key) {
    await fsp.rm(this.#resolve(key), { force: true });
  }
}

export const storage = new LocalStorage(env.UPLOAD_DIR);

if (env.isProduction) {
  logger.warn('Documents are stored on local disk. Configure private object storage before go-live (DECISIONS E4).');
}
