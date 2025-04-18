/**
 * Service for managing project dependencies
 */
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { logError, logWarning, logInfo, logSuccess } from '../utils/logging';
import { DependencyOptions } from '../types/project';

/**
 * Install package dependencies in a project
 * @param projectDir - Project directory
 * @param packages - Array of packages to install
 * @param options - Installation options
 */
export function installDependencies(
  projectDir: string, 
  packages: string[], 
  options: DependencyOptions = {}
): boolean {
  if (packages.length === 0) return true;
  
  const { dev = false, skipFailure = false } = options;
  const packageList = packages.join(' ');
  const command = `npm install ${dev ? '--save-dev' : '--save'} ${packageList}`;

  logInfo(`Installing ${dev ? 'dev ' : ''}dependencies: ${packageList}`);

  try {
    execSync(command, { cwd: projectDir, stdio: 'pipe' });
    logSuccess(chalk.green(`Dependencies installed successfully`));
    return true;
  } catch (error) {
    logError(chalk.red(`Failed to install dependencies`));
    logError('Installation error:', error);
    
    if (!skipFailure) {
      throw new Error(`Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    logWarning('Continuing despite installation failure (skipFailure=true)');
    return false;
  }
}

/**
 * Check if a dependency is installed in the project
 * @param projectDir - Project directory
 * @param packageName - Package to check
 */
export function isDependencyInstalled(projectDir: string, packageName: string): boolean {
  try {
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }

    const packageJson = fs.readJsonSync(packageJsonPath);
    return (
      (packageJson.dependencies && packageName in packageJson.dependencies) ||
      (packageJson.devDependencies && packageName in packageJson.devDependencies)
    );
  } catch (error) {
    logError(`Error checking if ${packageName} is installed:`, error);
    return false;
  }
}

/**
 * Get a list of installed dependencies
 * @param projectDir - Project directory
 */
export function getInstalledDependencies(projectDir: string): { dependencies: string[], devDependencies: string[] } {
  try {
    const packageJsonPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return { dependencies: [], devDependencies: [] };
    }

    const packageJson = fs.readJsonSync(packageJsonPath);
    const dependencies = packageJson.dependencies ? Object.keys(packageJson.dependencies) : [];
    const devDependencies = packageJson.devDependencies ? Object.keys(packageJson.devDependencies) : [];
    
    return { dependencies, devDependencies };
  } catch (error) {
    logError('Error getting installed dependencies:', error);
    return { dependencies: [], devDependencies: [] };
  }
} 