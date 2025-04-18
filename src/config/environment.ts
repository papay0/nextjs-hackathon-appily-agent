/**
 * Environment configuration helpers
 * 
 * This file contains utility functions to access environment variables
 * in a type-safe manner with proper defaults.
 */
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Check if Firebase storage is enabled
 * @returns true if Firebase storage should be used
 */
export function isFirebaseEnabled(): boolean {
  return process.env.FIREBASE_STORAGE_ENABLED === 'true';
}

/**
 * Check if local storage is enabled
 * @returns true if local filesystem storage should be used
 */
export function isLocalStorageEnabled(): boolean {
  return process.env.LOCAL_STORAGE_ENABLED !== 'false'; // Default to true unless explicitly disabled
}

/**
 * Get the local storage directory path
 * @returns path to local storage directory
 */
export function getLocalStoragePath(): string {
  return process.env.LOCAL_STORAGE_PATH || 'data';
}
