/**
 * Service for Next.js project creation using a git template
 */
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { logInfo, logError, logSuccess } from '../utils/logging';

// Template repository URL
const gitRepoUrl = 'https://github.com/papay0/appily-template-next-js.git';

/**
 * Execute a command in the specified directory
 */
function executeCommand(command: string, cwd: string, operation: string): string {
  try {
    logInfo(`Executing: ${command}`);
    const output = execSync(command, { 
      stdio: 'pipe',
      encoding: 'utf8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000 // 30-second timeout to prevent hanging
    });
    return output;
  } catch (error) {
    logError(`Failed to ${operation}`, error);
    throw error;
  }
}

/**
 * Check if git is installed on the system
 */
function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new Next.js project by cloning the template repository
 * @param projectDir The directory to create the project in
 * @param projectId The unique ID for the project, used for asset prefix configuration
 */
export async function createNextProject(projectDir: string, projectId?: string): Promise<void> {
  logInfo('Creating Next.js project from template...');
  
  try {
    // Create directory
    await fs.ensureDir(projectDir);
    
    // Check if this is a retry
    const isRetry = fs.existsSync(path.join(projectDir, 'package.json'));
    
    if (!isRetry) {
      // Check if git is installed
      if (!commandExists('git')) {
        logError('Git is not installed. Please install Git and try again.');
        throw new Error('Git is not installed');
      }
      
      // Clone the template repository
      logInfo(`Cloning Next.js template from ${gitRepoUrl}...`);
      executeCommand(`git clone ${gitRepoUrl} .`, projectDir, 'Clone template');
      
      // Remove .git directory to start fresh
      const gitDir = path.join(projectDir, '.git');
      if (fs.existsSync(gitDir)) {
        fs.removeSync(gitDir);
        logInfo('Removed .git directory for a fresh start');
      }
    } else {
      logInfo('Found existing project, skipping initialization');
    }
    
    // Install dependencies
    logInfo('Installing dependencies...');
    executeCommand('npm install', projectDir, 'NPM install');
    
    // If we have a projectId, update next.config.ts with the correct asset prefix
    if (projectId) {
      const projectFolderName = path.basename(projectDir);
      await updateNextConfig(projectDir, projectFolderName);
    }
    
    logSuccess('Next.js project ready');
  } catch (error) {
    logError('Next.js project creation failed', error);
    throw error;
  }
}

/**
 * Update the next.config.ts file with the correct asset prefix for R2 deployment
 * @param projectDir The directory containing the Next.js project
 * @param projectFolder The project folder name used as the asset prefix
 */
async function updateNextConfig(projectDir: string, projectFolder: string): Promise<void> {
  try {
    const configPath = path.join(projectDir, 'next.config.ts');
    
    if (await fs.pathExists(configPath)) {
      logInfo(`Updating Next.js config with assetPrefix: /${projectFolder}/`);
      
      // Replace or add assetPrefix in the Next.js config
      const newConfig = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/${projectFolder}',
  assetPrefix: '/${projectFolder}/',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;`;
      
      await fs.writeFile(configPath, newConfig, 'utf8');
      logSuccess('Updated next.config.ts with correct assetPrefix');
    } else {
      logError('next.config.ts not found');
    }
  } catch (error) {
    logError('Failed to update Next.js config', error);
  }
}
