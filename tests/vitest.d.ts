import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** MongoDB replica set URI provided by globalSetup and injected into test workers */
    sharedMongoUri: string;
  }
}
