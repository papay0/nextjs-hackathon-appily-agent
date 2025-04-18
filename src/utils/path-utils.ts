/**
 * Utility functions for handling project paths safely without relying on process.chdir()
 * 
 * This file provides helper functions to work with project directories and paths
 * in a thread-safe way that avoids race conditions with concurrent requests.
 */

import path from 'path';
import fs from 'fs-extra';

// Define the BufferEncoding type to match Node.js
type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';

/**
 * Resolves a relative path to an absolute path within a project directory
 * @param projectDir - The absolute path to the project directory
 * @param relativePath - A path relative to the project directory
 * @returns The absolute path
 */
export function resolveProjectPath(projectDir: string, relativePath: string): string {
  // Handle paths that might already be absolute
  if (path.isAbsolute(relativePath)) {
    // Ensure it's within the project directory to prevent security issues
    if (!relativePath.startsWith(projectDir)) {
      throw new Error(`Security violation: Path ${relativePath} is outside project directory ${projectDir}`);
    }
    return relativePath;
  }
  
  // Normalize to prevent path traversal attacks
  const normalizedPath = path.normalize(relativePath);
  
  // Validate that the path doesn't try to go outside the project directory
  if (normalizedPath.startsWith('..')) {
    throw new Error(`Security violation: Path ${relativePath} attempts to access parent directories`);
  }
  
  return path.join(projectDir, normalizedPath);
}

/**
 * Checks if a file exists within a project directory
 * 
 * @param projectDir - The absolute path to the project directory
 * @param relativePath - A path relative to the project directory
 * @returns Promise resolving to a boolean indicating if the file exists
 */
export async function fileExistsInProject(projectDir: string, relativePath: string): Promise<boolean> {
  const fullPath = resolveProjectPath(projectDir, relativePath);
  return fs.pathExists(fullPath);
}

/**
 * Asynchronously reads a file from a project directory
 * 
 * @param projectDir - The absolute path to the project directory
 * @param relativePath - A path relative to the project directory
 * @param encoding - Optional encoding (defaults to utf8)
 * @returns Promise that resolves to the file contents
 */
export async function readProjectFileAsync(projectDir: string, relativePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  const fullPath = resolveProjectPath(projectDir, relativePath);
  return fs.readFile(fullPath, { encoding });
}

/**
 * Asynchronously writes to a file in a project directory
 * 
 * @param projectDir - The absolute path to the project directory
 * @param relativePath - A path relative to the project directory
 * @param content - The content to write
 * @returns Promise that resolves when the write completes
 */
export async function writeProjectFileAsync(projectDir: string, relativePath: string, content: string | Buffer): Promise<void> {
  const fullPath = resolveProjectPath(projectDir, relativePath);
  const dirPath = path.dirname(fullPath);
  
  // Ensure the directory exists
  await fs.ensureDir(dirPath);
  
  // Write the file
  await fs.writeFile(fullPath, content);
}

/**
 * Asynchronously deletes a file in a project directory
 * 
 * @param projectDir - The absolute path to the project directory
 * @param relativePath - A path relative to the project directory
 * @returns Promise that resolves when the delete completes
 */
export async function deleteProjectFileAsync(projectDir: string, relativePath: string): Promise<void> {
  const fullPath = resolveProjectPath(projectDir, relativePath);
  if (await fs.pathExists(fullPath)) {
    await fs.unlink(fullPath);
  }
} 