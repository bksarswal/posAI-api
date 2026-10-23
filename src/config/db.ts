import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'MongoDB connection error');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

/**
 * Connects to MongoDB using Mongoose.
 * Fails fast and terminates the process if the initial connection fails.
 */
export async function connectDB(): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    logger.info(
      { host: conn.connection.host, name: conn.connection.name },
      'Connected to MongoDB successfully',
    );
    return conn;
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB on startup');
    throw error;
  }
}

/**
 * Gracefully closes the MongoDB connection.
 */
export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB gracefully');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from MongoDB');
    throw error;
  }
}
