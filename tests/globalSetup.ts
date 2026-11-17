import type { GlobalSetupContext } from 'vitest/node';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Pinned MongoDB binary version – keep in sync with MONGOMS_VERSION in .env.example
const MONGO_VERSION = process.env.MONGOMS_VERSION ?? '7.0.14';

let replSet: MongoMemoryReplSet | null = null;

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  // Ensure the binary downloader targets the pinned version
  process.env.MONGOMS_VERSION = MONGO_VERSION;

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: MONGO_VERSION },
  });

  const uri = replSet.getUri();

  // Share the URI with every test worker via Vitest's provide/inject mechanism
  provide('sharedMongoUri', uri);
  // Also propagate via env so setup.ts and direct-node usages can read it
  process.env.__SHARED_MONGO_URI__ = uri;
}

export async function teardown(): Promise<void> {
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}
