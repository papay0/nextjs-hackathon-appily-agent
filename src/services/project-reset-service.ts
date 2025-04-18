/**
 * Service for project reset operations
 */
import fs from 'fs-extra';
import path from 'path';
import { logInfo, logSuccess, logError } from '../utils/logging';
import { cleanProjectDirectory, createNextProject } from '../project-manager';
import chalk from 'chalk';

/**
 * Reset a project to a clean state while preserving src directory
 * @param projectPath Project directory path
 */
export async function resetProject(projectPath: string): Promise<void> {
  logInfo('Cleaning project directory for next attempt...');
  
  try {
    // Save current src directory contents if it exists
    const srcPath = path.join(projectPath, 'src');
    const tempSrcPath = path.join(projectPath, 'temp_src');
    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(tempSrcPath, { recursive: true });
      fs.cpSync(srcPath, tempSrcPath, { recursive: true });
      logInfo(chalk.cyan('Saved current src directory to temp...'));
    }

    // Clean the project directory
    logInfo(chalk.cyan('Cleaning project directory...'));
    await cleanProjectDirectory(projectPath);
    
    // Create a new Next.js project
    logInfo(chalk.cyan('Creating fresh Next.js project...'));
    await createNextProject(projectPath);
    
    // Restore src directory contents if they exist
    if (fs.existsSync(tempSrcPath)) {
      logInfo(chalk.cyan('Restoring src directory contents...'));
      fs.rmSync(srcPath, { recursive: true, force: true });
      fs.cpSync(tempSrcPath, srcPath, { recursive: true });
      fs.rmSync(tempSrcPath, { recursive: true, force: true });
    }
    
    logSuccess(chalk.green(`Project reset successfully`));
  } catch (error) {
    logError(chalk.red(`Failed to reset project`));
    logError('Error details:', error);
    throw error;
  }
} 