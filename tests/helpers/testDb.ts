import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { withGlobalScope } from '../../src/utils/tenantBypass.js';

let replSet: MongoMemoryReplSet | null = null;

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
 * Starts the in-memory MongoDB replica set, connects Mongoose,
 * ensures all module models are registered, and awaits index initialization.
 */
export async function startTestDb(): Promise<void> {
  if (!replSet) {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri();
    await mongoose.connect(uri);

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
 * Disconnects Mongoose and stops the in-memory replica set.
 */
export async function stopTestDb(): Promise<void> {
  if (replSet) {
    await mongoose.disconnect();
    await replSet.stop();
    replSet = null;
  }
}
