/* eslint-disable no-unused-vars */
/**
 * File storage service implementations
 * 
 * This file defines interfaces and implementations for project file storage.
 * All services are designed to be instantiated PER REQUEST with no shared state
 * to support high concurrency with 40,000+ users.
 */
import path from 'path';
import fs from 'fs-extra';
import { File } from '@google-cloud/storage';
import { isFirebaseEnabled, isLocalStorageEnabled } from '../../config/environment';
import { logError, logInfo, logWarning } from '../../utils/logging';
import { FirestoreLogger } from '../../utils/firestore-logger';

/**
 * Interface for file storage operations
 */
export interface FileStorage {
  /**
   * Upload project files to storage
   * @param projectId - Unique project identifier
   * @param directory - Source directory containing files to upload
   * @param logger - Optional logger for progress information
   */
  uploadProjectFiles(projectId: string, directory: string, logger?: FirestoreLogger): Promise<void>;
  
  /**
   * Download project files from storage
   * @param projectId - Unique project identifier
   * @param targetDirectory - Directory where files should be saved
   */
  downloadProjectFiles(projectId: string, targetDirectory: string): Promise<void>;
  
  /**
   * Delete all files for a project
   * @param projectId - Unique project identifier
   */
  deleteProjectFiles(projectId: string): Promise<void>;
}

/**
 * Constants for file storage
 */
const PROJECT_FILES_PREFIX = 'projects';

/**
 * Local file system storage implementation
 */
export class LocalFileStorage implements FileStorage {
  private readonly storageDirectory: string;
  
  constructor() {
    this.storageDirectory = path.join(process.cwd(), 'data', 'files');
    fs.ensureDirSync(this.storageDirectory);
  }
  
  async uploadProjectFiles(projectId: string, directory: string, logger?: FirestoreLogger): Promise<void> {
    try {
      logger?.info(`Starting local file backup for project ${projectId}`);
      
      // Create project directory
      const projectDir = path.join(this.storageDirectory, projectId);
      await fs.ensureDir(projectDir);
      
      // Copy entire project directory
      await fs.copy(directory, projectDir, {
        filter: (src) => {
          // Skip node_modules and .git directories
          return !src.includes('node_modules') && !src.includes('.git');
        }
      });
      
      logger?.info(`Local file backup complete for project ${projectId}`);
    } catch (error) {
      logError(`Error backing up files locally for project ${projectId}:`, error);
      logger?.error(`Failed to backup files locally: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  async downloadProjectFiles(projectId: string, targetDirectory: string): Promise<void> {
    try {
      const projectDir = path.join(this.storageDirectory, projectId);
      
      // Check if project directory exists
      if (!await fs.pathExists(projectDir)) {
        throw new Error(`Local files for project ${projectId} not found`);
      }
      
      // Ensure target directory exists
      await fs.ensureDir(targetDirectory);
      
      // Copy files to target directory
      await fs.copy(projectDir, targetDirectory);
      
      logInfo(`Project files for ${projectId} downloaded to ${targetDirectory}`);
    } catch (error) {
      logError(`Error downloading files for project ${projectId}:`, error);
      throw error;
    }
  }
  
  async deleteProjectFiles(projectId: string): Promise<void> {
    try {
      const projectDir = path.join(this.storageDirectory, projectId);
      
      // Remove directory if it exists
      if (await fs.pathExists(projectDir)) {
        await fs.remove(projectDir);
        logInfo(`Local files for project ${projectId} deleted`);
      }
    } catch (error) {
      logError(`Error deleting local files for project ${projectId}:`, error);
      throw error;
    }
  }
}

/**
 * Firebase Storage implementation
 */
export class FirebaseFileStorage implements FileStorage {
  constructor() {
    // No initialization needed - we'll get a fresh Storage instance on each method call
  }
  
  /**
   * Get content type based on file extension
   */
  private getContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.tsx': 'application/typescript',
      '.ts': 'application/typescript',
      '.jsx': 'application/javascript'
    };
    
    return contentTypes[extension] || 'application/octet-stream';
  }
  
  /**
   * Normalize path for Firebase Storage
   */
  private normalizePath(filePath: string): string {
    // Remove leading slashes and normalize path separators
    return filePath.replace(/^\//g, '').replace(/\\/g, '/');
  }
  
  async uploadProjectFiles(projectId: string, directory: string, logger?: FirestoreLogger): Promise<void> {
    try {
      logger?.info(`Starting Firebase upload for project ${projectId}`);
      
      const { getFirebaseAdmin } = require('../../config/firebase-admin-config');
      const app = await getFirebaseAdmin();
      if (!app) {
        throw new Error('Firebase Admin SDK is not initialized');
      }
      
      // Use Firebase Admin's storage
      const storage = app.storage();
      
      logger?.info(`Starting Firebase Storage upload for project ${projectId}`);
      
      // Get all files in project directory
      const files = await this.getFilesRecursively(directory);
      logger?.info(`Found ${files.length} files to upload`);
      
      // Upload in batches to avoid too many concurrent requests
      const batchSize = 10;
      let uploaded = 0;
      
      // Process files in batches
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(batch.map(async (filePath) => {
          try {
            // Get file path relative to the project directory
            const relativePath = path.relative(directory, filePath);
            const normalizedPath = this.normalizePath(relativePath);
            
            // Skip node_modules, .git, out, and .next directories
            if (normalizedPath.includes('node_modules/') || 
                normalizedPath.includes('.git/') ||
                normalizedPath.startsWith('out/') ||
                normalizedPath.startsWith('.next/')) {
              return;
            }
            
            // Read file content
            const content = await fs.readFile(filePath);
            
            // Upload to Firebase Storage
            const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/files/${normalizedPath}`;
            
            // Get the default bucket
            const bucket = storage.bucket();
            
            // Use the bucket to get the file reference
            const file = bucket.file(storagePath);
            
            // Upload the file
            await file.save(content, { 
              contentType: this.getContentType(filePath),
              metadata: {
                projectId: projectId,
                originalPath: relativePath
              }
            });
            
            uploaded++;
            
            // Log progress periodically
            if (uploaded % 20 === 0 || uploaded === files.length) {
              logger?.info(`Uploaded ${uploaded}/${files.length} files to Firebase Storage`);
            }
          } catch (error) {
            logger?.error(`Failed to upload file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }));
      }
      
      logger?.info(`Firebase Storage upload complete for project ${projectId}`);
    } catch (error) {
      logError(`Error uploading files to Firebase for project ${projectId}:`, error);
      logger?.error(`Failed to upload to Firebase: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Recursively get all files in a directory
   */
  private async getFilesRecursively(directory: string): Promise<string[]> {
    const files: string[] = [];
    
    async function traverseDirectory(currentPath: string) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules, .git, out, and .next directories
          if (entry.name !== 'node_modules' && 
              entry.name !== '.git' && 
              entry.name !== 'out' && 
              entry.name !== '.next') {
            await traverseDirectory(fullPath);
          }
        } else {
          files.push(fullPath);
        }
      }
    }
    
    await traverseDirectory(directory);
    return files;
  }
  
  async downloadProjectFiles(projectId: string, targetDirectory: string): Promise<void> {
    try {
      const { getFirebaseAdmin } = require('../../config/firebase-admin-config');
      const app = await getFirebaseAdmin();
      if (!app) {
        throw new Error('Firebase Admin SDK is not initialized');
      }
      
      // Use Firebase Admin's storage
      const storage = app.storage();
      
      // Ensure target directory exists
      await fs.ensureDir(targetDirectory);
      
      // List all files for this project
      const [files] = await storage.bucket().getFiles({
        prefix: `${PROJECT_FILES_PREFIX}/${projectId}/files/`
      });
      
      if (files.length === 0) {
        throw new Error(`No files found for project ${projectId}`);
      }
      
      // Download each file
      await Promise.all(files.map(async (file: File) => {
        // Get relative path within the project
        const storagePath = file.name;
        const prefixToRemove = `${PROJECT_FILES_PREFIX}/${projectId}/files/`;
        
        if (!storagePath.startsWith(prefixToRemove)) {
          return; // Skip if not part of this project's files
        }
        
        const relativePath = storagePath.substring(prefixToRemove.length);
        const targetPath = path.join(targetDirectory, relativePath);
        
        // Ensure directory exists
        await fs.ensureDir(path.dirname(targetPath));
        
        // Download file
        await (file as File).download({ destination: targetPath });
      }));
      
      logInfo(`Project files for ${projectId} downloaded to ${targetDirectory}`);
    } catch (error) {
      logError(`Error downloading files from Firebase for project ${projectId}:`, error);
      throw error;
    }
  }
  
  async deleteProjectFiles(projectId: string): Promise<void> {
    try {
      const { getFirebaseAdmin } = require('../../config/firebase-admin-config');
      const app = await getFirebaseAdmin();
      if (!app) {
        throw new Error('Firebase Admin SDK is not initialized');
      }
      
      // Use Firebase Admin's storage
      const storage = app.storage();
      
      // Get the bucket
      const bucket = storage.bucket();
      
      // List all files for this project
      const [files] = await bucket.getFiles({
        prefix: `${PROJECT_FILES_PREFIX}/${projectId}/`
      });
      
      // Delete each file
      if (files.length > 0) {
        await Promise.all(files.map((file: File) => file.delete()));
        logInfo(`Deleted ${files.length} files for project ${projectId} from Firebase Storage`);
      }
    } catch (error) {
      logError(`Error deleting files from Firebase for project ${projectId}:`, error);
      throw error;
    }
  }
}

/**
 * Combined file storage service that can use both local and Firebase storage.
 * Each instance is constructed fresh per request.
 */
export class DualFileStorage implements FileStorage {
  private readonly localStorage: LocalFileStorage;
  private readonly firebaseStorage: FirebaseFileStorage | null;
  private readonly useLocalStorage: boolean;
  private readonly useFirebase: boolean;
  
  constructor() {
    this.useLocalStorage = isLocalStorageEnabled();
    this.useFirebase = isFirebaseEnabled();
    
    this.localStorage = new LocalFileStorage();
    this.firebaseStorage = this.useFirebase ? new FirebaseFileStorage() : null;
  }
  
  async uploadProjectFiles(projectId: string, directory: string, logger?: FirestoreLogger): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.useLocalStorage) {
      promises.push(this.localStorage.uploadProjectFiles(projectId, directory, logger));
    }
    
    if (this.useFirebase && this.firebaseStorage) {
      promises.push(this.firebaseStorage.uploadProjectFiles(projectId, directory, logger));
    }
    
    if (promises.length === 0) {
      throw new Error('No file storage providers enabled');
    }
    
    await Promise.all(promises);
  }
  
  async downloadProjectFiles(projectId: string, targetDirectory: string): Promise<void> {
    // Try Firebase first if available (typically more up-to-date in production)
    if (this.useFirebase && this.firebaseStorage) {
      try {
        await this.firebaseStorage.downloadProjectFiles(projectId, targetDirectory);
        return;
      } catch (error) {
        logWarning(`Error downloading from Firebase Storage, falling back to local: ${
          error instanceof Error ? error.message : String(error)
        }`);
      }
    }
    
    // Fall back to local storage
    if (this.useLocalStorage) {
      await this.localStorage.downloadProjectFiles(projectId, targetDirectory);
      return;
    }
    
    throw new Error('No file storage providers enabled or available');
  }
  
  async deleteProjectFiles(projectId: string): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.useLocalStorage) {
      promises.push(this.localStorage.deleteProjectFiles(projectId));
    }
    
    if (this.useFirebase && this.firebaseStorage) {
      promises.push(this.firebaseStorage.deleteProjectFiles(projectId));
    }
    
    if (promises.length === 0) {
      return; // Nothing to do
    }
    
    await Promise.all(promises);
  }
}
