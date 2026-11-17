import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { inject } from 'vitest';
import { withGlobalScope } from '../../src/utils/tenantBypass.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let localReplSet: MongoMemoryReplSet | null = null;
let currentDbName: string | null = null;

function getAllModelFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllModelFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.model.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Connects Mongoose to the shared replica set with an isolated database per test file/worker,
 * ensures all module models are registered, and awaits index initialization.
 * Falls back to starting a local replica set if globalSetup wasn't triggered (e.g. standalone test execution).
 */
export async function startTestDb(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  let baseUri: string | undefined =
    inject('sharedMongoUri') ?? process.env.__SHARED_MONGO_URI__;
  if (!baseUri) {
    if (!localReplSet) {
      localReplSet = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        binary: {
          version: process.env.MONGOMS_VERSION || '7.0.14',
        },
      });
    }
    baseUri = localReplSet.getUri();
  }

  // Generate unique database name per test suite/worker to ensure complete test isolation
  currentDbName = `test_${crypto.randomUUID().replace(/-/g, '')}`;
  const url = new URL(baseUri);
  url.pathname = `/${currentDbName}`;
  const connectionUri = url.toString();

  await mongoose.connect(connectionUri);

  // Dynamically register all models from modules
  const modulesDir = path.resolve(__dirname, '../../src/modules');
  const modelFiles = getAllModelFiles(modulesDir);
  for (const file of modelFiles) {
    await import(pathToFileURL(file).href);
  }

  // Await init() on every registered model so indexes exist before tests run
  for (const modelName of mongoose.modelNames()) {
    await mongoose.model(modelName).init();
  }
}

/**
 * Clears all documents from every registered Mongoose model collection.
 */
export async function clearAllCollections(): Promise<void> {
  await withGlobalScope(async () => {
    for (const modelName of mongoose.modelNames()) {
      await mongoose.model(modelName).deleteMany({});
    }
  });
}

/**
 * Drops the isolated test database and disconnects Mongoose.
 * If a fallback localReplSet was created, stops it.
 */
export async function stopTestDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
      }
    } catch {
      // Best-effort cleanup
    }
    await mongoose.disconnect();
  }

  if (localReplSet) {
    await localReplSet.stop();
    localReplSet = null;
  }
}
