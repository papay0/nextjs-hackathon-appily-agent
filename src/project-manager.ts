/**
 * Project Management Module
 * 
 * This module handles the creation and management of Next.js TypeScript projects.
 * It provides:
 * 
 * 1. Project Creation:
 *    - Initializes new Next.js projects
 *    - Sets up React and TypeScript
 *    - Configures development environment
 * 
 * 2. Dependency Management:
 *    - Installs required dependencies
 *    - Manages package.json
 *    - Handles npm/yarn operations
 * 
 * 3. Configuration Setup:
 *    - Configures ESLint
 *    - Sets up TypeScript
 *    - Manages project scripts
 * 
 * 4. Project Maintenance:
 *    - Cleans project directories
 *    - Preserves node_modules
 *    - Handles project resets
 * 
 * The module ensures consistent project setup and provides
 * robust error handling for all operations.
 */

import { logSuccess, logError, logInfo } from './utils/logging';
import { cleanProjectDirectory } from './services/project-cleanup-service';
import { installDependencies, isDependencyInstalled } from './services/dependency-service';
import { createNextProject } from './services/next-project-service';

// Export the services for external use
export {
  createNextProject, // Add the Next.js project service
  cleanProjectDirectory,
  installDependencies,
  isDependencyInstalled
};

/**
 * Reset project to a clean state while preserving node_modules
 * @param projectDir - Project directory to reset
 */
export async function resetProject(projectDir: string): Promise<boolean> {
  try {
    logInfo('Resetting project to clean state...');
    
    // Clean the directory
    await cleanProjectDirectory(projectDir);
    
    // Re-initialize the project with Next.js
    await createNextProject(projectDir);
    const success = true;
    
    if (success) {
      logSuccess('Project reset completed successfully');
    } else {
      logError('Project reset failed');
    }
    
    return success;
  } catch (error) {
    logError('Failed to reset project', error);
    throw new Error(`Project reset failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}