/**
 * Firebase File Storage Service
 * 
 * This service handles storing and retrieving project files from Firebase Storage.
 * It provides methods for uploading, downloading, and managing files in Storage.
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import { getStorage } from '../config/firebase-admin-config';
import { logError, logInfo, logWarning } from '../utils/logging';
import { FirestoreLogger } from '../utils/firestore-logger';

// Storage structure constants
const PROJECT_FILES_PREFIX = 'projects';

/**
 * Service for managing project files in Firebase Storage
 */
export class FirebaseFileStorage {
  /**
   * Upload an entire project directory to Firebase Storage
   * 
   * @param projectId - Project ID to store files under
   * @param localDirectory - Local directory containing the project files
   * @param firestoreLogger - Optional stream logger for progress updates
   * @returns Promise resolving to true if successful, false otherwise
   */
  async uploadProjectFiles(
    projectId: string,
    localDirectory: string,
    firestoreLogger?: FirestoreLogger
  ): Promise<boolean> {
    try {
      const storage = await getStorage();
      if (!storage) {
        logError('Firebase Storage is not initialized');
        return false;
      }
      
      const bucket = storage.bucket();

      // Ensure the local directory exists
      if (!await fs.pathExists(localDirectory)) {
        logError(`Local directory ${localDirectory} does not exist`);
        return false;
      }

      // Get all files recursively from the local directory
      const allFiles = await this.getAllFilesRecursively(localDirectory);
      
      // Filter out files from the out/ directory and .next/ directory
      const filteredFiles = allFiles.filter(filePath => {
        const relativePath = path.relative(localDirectory, filePath);
        return !relativePath.startsWith('out/') && 
               !relativePath.startsWith('out\\') &&
               !relativePath.startsWith('.next/') &&
               !relativePath.startsWith('.next\\');
      });
      
      if (filteredFiles.length === 0) {
        logWarning(`No files found in ${localDirectory} (or all files were in excluded directories)`);
        return false;
      }
      
      logInfo(`Uploading ${filteredFiles.length} files to Firebase Storage for project ${projectId} (excluding out/ directory)`);
      firestoreLogger?.info(`Uploading ${filteredFiles.length} files to Firebase Storage (excluding out/ directory)`);
      
      // Upload files in batches to avoid overwhelming Firebase
      const BATCH_SIZE = 10;
      const batches = [];
      
      for (let i = 0; i < filteredFiles.length; i += BATCH_SIZE) {
        const batch = filteredFiles.slice(i, i + BATCH_SIZE);
        batches.push(batch);
      }
      
      let uploadedCount = 0;
      
      // Process batches sequentially
      for (const batch of batches) {
        await Promise.all(batch.map(async (filePath) => {
          // Get the relative path from the local directory
          const relativePath = path.relative(localDirectory, filePath);
          // Normalize path separators to forward slashes
          const normalizedPath = relativePath.replace(/\\/g, '/');
          // Construct the storage path
          const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/files/${normalizedPath}`;
          
          try {
            // Read file content
            const content = await fs.readFile(filePath);
            
            // Create a file in the bucket
            const file = bucket.file(storagePath);
            
            // Upload the file
            await file.save(content, {
              contentType: this.getContentType(filePath),
              metadata: {
                projectId,
                originalPath: normalizedPath
              }
            });
            
            uploadedCount++;
            
            if (uploadedCount % 10 === 0 || uploadedCount === filteredFiles.length) {
              const percentage = Math.round((uploadedCount / filteredFiles.length) * 100);
              firestoreLogger?.info(`Uploaded ${uploadedCount} of ${filteredFiles.length} files (${percentage}%)`);
            }
          } catch (error) {
            logError(`Error uploading file ${relativePath} to Firebase Storage: ${error}`);
            firestoreLogger?.error(`Failed to upload ${relativePath}: ${error}`);
          }
        }));
      }
      
      firestoreLogger?.success(`Successfully uploaded ${uploadedCount} files to Firebase Storage`);
      logInfo(`Successfully uploaded ${uploadedCount} files to Firebase Storage for project ${projectId}`);
      
      return uploadedCount > 0;
    } catch (error) {
      logError(`Error uploading project files to Firebase Storage: ${error}`);
      firestoreLogger?.error(`Error uploading project files: ${error}`);
      return false;
    }
  }
  
  /**
   * Download a single file from Firebase Storage
   * 
   * @param projectId - Project ID
   * @param filePath - Relative path of the file within the project
   * @returns Promise resolving to file content as string or null if not found
   */
  async downloadFile(projectId: string, filePath: string): Promise<string | null> {
    try {
      const storage = await getStorage();
      if (!storage) {
        logError('Firebase Storage is not initialized');
        return null;
      }
      
      const bucket = storage.bucket();
      
      // Normalize path separators
      const normalizedPath = filePath.replace(/\\/g, '/');
      // Construct the storage path
      const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/files/${normalizedPath}`;
      
      // Get file from bucket
      const file = bucket.file(storagePath);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        logWarning(`File ${filePath} not found in Firebase Storage for project ${projectId}`);
        return null;
      }
      
      // Download file content
      const [content] = await file.download();
      return content.toString('utf-8');
    } catch (error) {
      logError(`Error downloading file ${filePath} from Firebase Storage: ${error}`);
      return null;
    }
  }
  
  /**
   * Download all project files to a local directory
   * 
   * @param projectId - Project ID
   * @param localDirectory - Local directory to download files to
   * @param firestoreLogger - Optional stream logger for progress updates
   * @returns Promise resolving to number of downloaded files
   */
  async downloadProjectFiles(
    projectId: string,
    localDirectory: string,
    firestoreLogger?: FirestoreLogger
  ): Promise<number> {
    try {
      const storage = await getStorage();
      if (!storage) {
        logError('Firebase Storage is not initialized');
        return 0;
      }
      
      const bucket = storage.bucket();
      
      // Ensure local directory exists
      await fs.ensureDir(localDirectory);
      
      // List all files in the project's storage path
      const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/files/`;
      const [files] = await bucket.getFiles({ prefix: storagePath });
      
      if (files.length === 0) {
        logWarning(`No files found in Firebase Storage for project ${projectId}`);
        return 0;
      }
      
      logInfo(`Downloading ${files.length} files from Firebase Storage for project ${projectId}`);
      firestoreLogger?.info(`Downloading ${files.length} files from Firebase Storage`);
      
      let downloadedCount = 0;
      
      for (const file of files) {
        try {
          // Get the relative path by removing the prefix
          const relativePath = file.name.replace(storagePath, '');
          if (!relativePath) continue; // Skip the directory itself
          
          // Construct the local file path
          const localFilePath = path.join(localDirectory, relativePath);
          
          // Ensure parent directory exists
          await fs.ensureDir(path.dirname(localFilePath));
          
          // Download the file
          const [content] = await file.download();
          
          // Write to local file
          await fs.writeFile(localFilePath, content);
          
          downloadedCount++;
          
          if (downloadedCount % 10 === 0 || downloadedCount === files.length) {
            const percentage = Math.round((downloadedCount / files.length) * 100);
            firestoreLogger?.info(`Downloaded ${downloadedCount} of ${files.length} files (${percentage}%)`);
          }
        } catch (error) {
          logError(`Error downloading file ${file.name} from Firebase Storage: ${error}`);
          firestoreLogger?.error(`Failed to download ${file.name}: ${error}`);
        }
      }
      
      firestoreLogger?.success(`Successfully downloaded ${downloadedCount} files from Firebase Storage`);
      logInfo(`Successfully downloaded ${downloadedCount} files from Firebase Storage for project ${projectId}`);
      
      return downloadedCount;
    } catch (error) {
      logError(`Error downloading project files from Firebase Storage: ${error}`);
      firestoreLogger?.error(`Error downloading project files: ${error}`);
      return 0;
    }
  }
  
  /**
   * Delete all files for a project from Firebase Storage
   * 
   * @param projectId - Project ID
   * @returns Promise resolving to true if successful, false otherwise
   */
  async deleteProjectFiles(projectId: string): Promise<boolean> {
    try {
      const storage = await getStorage();
      if (!storage) {
        logError('Firebase Storage is not initialized');
        return false;
      }
      
      const bucket = storage.bucket();
      
      // List all files in the project's storage path
      const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/`;
      const [files] = await bucket.getFiles({ prefix: storagePath });
      
      if (files.length === 0) {
        logWarning(`No files found in Firebase Storage for project ${projectId}`);
        return true; // Consider it successful if there are no files to delete
      }
      
      logInfo(`Deleting ${files.length} files from Firebase Storage for project ${projectId}`);
      
      // Delete files in batches
      const BATCH_SIZE = 10;
      const batches = [];
      
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        batches.push(batch);
      }
      
      // Process batches sequentially
      for (const batch of batches) {
        await Promise.all(batch.map(file => file.delete()));
      }
      
      logInfo(`Successfully deleted ${files.length} files from Firebase Storage for project ${projectId}`);
      return true;
    } catch (error) {
      logError(`Error deleting project files from Firebase Storage: ${error}`);
      return false;
    }
  }
  
  /**
   * List all files in a project directory in Firebase Storage
   * 
   * @param projectId - Project ID
   * @returns Promise resolving to array of file paths
   */
  async listProjectFiles(projectId: string): Promise<string[]> {
    try {
      const storage = await getStorage();
      if (!storage) {
        logError('Firebase Storage is not initialized');
        return [];
      }
      
      const bucket = storage.bucket();
      
      // List all files in the project's storage path
      const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/files/`;
      const [files] = await bucket.getFiles({ prefix: storagePath });
      
      // Extract relative paths
      return files
        .map(file => file.name.replace(storagePath, ''))
        .filter(path => path.length > 0); // Filter out the directory itself
    } catch (error) {
      logError(`Error listing project files from Firebase Storage: ${error}`);
      return [];
    }
  }
  
  /**
   * Check if a project exists in Firebase Storage
   * 
   * @param projectId - Project ID
   * @returns Promise resolving to true if project exists, false otherwise
   */
  async projectExists(projectId: string): Promise<boolean> {
    try {
      const storage = await getStorage();
      if (!storage) {
        return false;
      }
      
      const bucket = storage.bucket();
      
      // List files in the project's storage path with a limit of 1
      const storagePath = `${PROJECT_FILES_PREFIX}/${projectId}/`;
      const [files] = await bucket.getFiles({ 
        prefix: storagePath,
        maxResults: 1
      });
      
      return files.length > 0;
    } catch (error) {
      logError(`Error checking if project exists in Firebase Storage: ${error}`);
      return false;
    }
  }
  
  /**
   * Get all files recursively from a directory
   * 
   * @param directory - Directory to scan
   * @param results - Array to store results (used in recursion)
   * @returns Promise resolving to array of file paths
   */
  private async getAllFilesRecursively(
    directory: string, 
    results: string[] = []
  ): Promise<string[]> {
    const files = await fs.readdir(directory);
    
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        // Recursively scan subdirectories
        await this.getAllFilesRecursively(filePath, results);
      } else {
        // Add file to results
        results.push(filePath);
      }
    }
    
    return results;
  }
  
  /**
   * Get content type based on file extension
   * 
   * @param filePath - Path to the file
   * @returns Content type string
   */
  private getContentType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    
    // Map common extensions to MIME types
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.ts': 'application/typescript',
      '.tsx': 'application/typescript',
      '.jsx': 'application/javascript',
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
  }
}
