/**
 * Service for cleaning and resetting project directories
 */
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { logError, logInfo, logSuccess } from '../utils/logging';

/**
 * Clean the project directory while preserving node_modules
 * @param projectDir - Project directory to clean
 */
export async function cleanProjectDirectory(projectDir: string): Promise<void> {
  logInfo('Cleaning project directory...');
  
  try {
    // Ensure directory exists
    await fs.ensureDir(projectDir);
    
    // Get list of all items in directory
    const items = await fs.readdir(projectDir);
    
    // Remove everything except node_modules
    for (const item of items) {
      if (item !== 'node_modules') {
        await fs.remove(path.join(projectDir, item));
      }
    }
    
    logSuccess(chalk.green(`Project directory cleaned successfully`));
  } catch (error) {
    logError(chalk.red(`Error cleaning project directory`));
    logError('Error details:', error);
    throw new Error(`Failed to clean project directory: ${error instanceof Error ? error.message : String(error)}`);
  }
} 