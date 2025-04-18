/**
 * Firebase Admin SDK configuration
 * 
 * This file provides initialization and access to Firebase Admin SDK
 * services for server-side operations. It includes safety checks to
 * ensure the service account exists and proper error handling.
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs-extra';
import * as path from 'path';
import dotenv from 'dotenv';
import { logError, logWarning } from '../utils/logging';

// Load environment variables
dotenv.config();

// Check if Firebase is enabled in environment settings
const isEnabled = process.env.FIREBASE_STORAGE_ENABLED === 'true';

// Singleton instance of Firebase Admin app
let adminApp: admin.app.App | null = null;

/**
 * Initialize Firebase Admin SDK
 * 
 * @returns Initialized Firebase Admin app or null if disabled or error occurred
 */
export const initializeFirebaseAdmin = async (): Promise<admin.app.App | null> => {
  // Return early if Firebase is disabled in settings
  if (!isEnabled) {
    return null;
  }

  // Return existing instance if already initialized
  if (adminApp) {
    return adminApp;
  }

  try {
    // Get environment - Cloud Run environments typically have this variable
    const isCloudRun = !!process.env.K_SERVICE;
    const projectId = process.env.FIREBASE_PROJECT_ID || 'appily-dev';
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'appily-dev.firebasestorage.app';
    
    if (isCloudRun) {
      // In Cloud Run, use Application Default Credentials
      // This uses the Cloud Run service account automatically
      logWarning('Initializing Firebase Admin with Application Default Credentials');
      adminApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
        storageBucket
      });
    } else {
      // In local development, try to use service account key file
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || 
        path.join(process.cwd(), 'firebase-service-account-key.json');

      // Check if the service account file exists
      if (!await fs.pathExists(serviceAccountPath)) {
        logWarning(`Firebase service account key file not found at: ${serviceAccountPath}`);
        logWarning('Attempting to use Application Default Credentials as fallback...');
        
        // Try application default credentials as fallback
        adminApp = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId,
          storageBucket
        });
      } else {
        // Read and parse the service account key
        const serviceAccount = JSON.parse(await fs.readFile(serviceAccountPath, 'utf8'));
        
        // Initialize with the service account key
        adminApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId,
          storageBucket
        });
      }
    }

    return adminApp;
  } catch (error) {
    logError('Error initializing Firebase Admin SDK:', error);
    return null;
  }
};

/**
 * Get Firestore database instance
 * @returns Firestore database instance or null if Firebase is disabled
 */
export const getFirestore = async () => {
  const app = await initializeFirebaseAdmin();
  return app ? app.firestore() : null;
};

/**
 * Get Firebase Storage instance
 * @returns Firebase Storage instance or null if Firebase is disabled
 */
export const getStorage = async () => {
  const app = await initializeFirebaseAdmin();
  return app ? app.storage() : null;
};

/**
 * Check if Firebase is enabled in the application settings
 * @returns true if Firebase is enabled, false otherwise
 */
export const isFirebaseEnabled = () => isEnabled;

/**
 * Check if Firebase Admin is initialized 
 * @returns true if Firebase Admin is initialized, false otherwise
 */
export const isInitialized = () => !!adminApp;

/**
 * Get the Firebase Admin app instance
 * @returns Firebase Admin app instance or null if not initialized
 */
export const getFirebaseAdmin = async (): Promise<admin.app.App | null> => {
  // If already initialized, return the instance
  if (adminApp) {
    return adminApp;
  }
  
  // Otherwise initialize it
  return initializeFirebaseAdmin();
};
