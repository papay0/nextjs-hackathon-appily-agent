/**
 * Project formatter service for preparing project files for Claude
 */
import fs from 'fs-extra';
import path from 'path';
import { readProjectFileAsync } from '../utils/path-utils';

/**
 * Determines if a file or directory should be skipped during project scanning
 * @param fullPath - Full path to the file or directory
 * @param fileName - Name of the file or directory
 * @returns True if the path should be skipped, false otherwise
 */
function shouldSkipPath(fullPath: string, fileName: string): boolean {
  return (
    fullPath.includes('node_modules/') || 
    // Match dist as a directory, not words containing 'dist'
    (fullPath.includes('dist/') && !!fullPath.match(/[/\\](dist)[/\\]/)) || 
    fullPath.includes('.git/') || 
    // Match only the output directory at root level, not /app/out/ etc.
    (fullPath.includes('/out/') && !!fullPath.match(/[/\\](out)[/\\]/)) || 
    fullPath.includes('.next/') || 
    // Match build as a directory, not words containing 'build'
    (fullPath.includes('build/') && !!fullPath.match(/[/\\](build)[/\\]/)) || 
    fullPath.includes('public/assets/') || 
    // Match coverage as a directory, not words containing 'coverage'
    (fullPath.includes('coverage/') && !!fullPath.match(/[/\\](coverage)[/\\]/)) || 
    fullPath.includes('storybook-static/') || 
    // Match debug as a directory, not source files with 'debug' in the name
    (fullPath.includes('debug/') && !!fullPath.match(/[/\\](debug)[/\\]/)) || 
    fileName.startsWith('.') || 
    fileName === 'package-lock.json' ||
    fileName === 'pnpm-lock.yaml' ||
    fileName === 'yarn.lock' ||
    fileName === 'favicon.ico' ||
    fileName === 'tsconfig.node.tsbuildinfo' ||
    fileName.endsWith('.log') ||
    fileName.endsWith('.tmp') ||
    fileName.endsWith('.map') ||
    fileName.endsWith('.min.js') ||
    fileName.endsWith('.min.css') ||
    fileName.endsWith('.svg') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.gif') ||
    fileName.endsWith('.ico') ||
    fileName.endsWith('.woff') ||
    fileName.endsWith('.woff2') ||
    fileName.endsWith('.ttf') ||
    fileName.endsWith('.eot')
  );
}

/**
 * Format project files for Claude to understand
 * @param projectDir - Project directory
 * @returns Formatted project structure
 */
export async function formatProjectForClaude(projectDir: string): Promise<string> {
  const projectFiles: Record<string, string> = {};
  
  const collectFiles = async (currentDir: string, baseDir: string = projectDir) => {
    const entries = await fs.readdir(currentDir);
    
    for (const file of entries) {
      const fullPath = path.join(currentDir, file);
      const relativePath = path.relative(baseDir, fullPath);
      
      // Skip files and directories that should be excluded
      if (shouldSkipPath(fullPath, file)) {
        continue;
      }
      
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await collectFiles(fullPath, baseDir);
      } else {
        projectFiles[relativePath] = await readProjectFileAsync(projectDir, relativePath);
      }
    }
  };
  
  await collectFiles(projectDir);
  
  // Create a formatted structure for Claude
  let formattedProject = "# Current Project Structure\n\n";
  
  // Add all files
  for (const [filePath, content] of Object.entries(projectFiles)) {
    formattedProject += `## ${filePath}\n\`\`\`\n${content}\n\`\`\`\n\n`;
  }
  
  return formattedProject;
}

/**
 * Collect project files, skipping node_modules, dist, etc.
 * @param dir - Directory to collect files from
 * @returns Record of file paths to file contents
 */
export async function collectProjectFiles(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  
  const collect = async (currentDir: string, baseDir: string = dir) => {
    const entries = await fs.readdir(currentDir);
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const relativePath = path.relative(baseDir, fullPath);
      
      // Skip files and directories that should be excluded
      if (shouldSkipPath(fullPath, entry)) {
        continue;
      }
      
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await collect(fullPath, baseDir);
      } else {
        files[relativePath] = await readProjectFileAsync(dir, relativePath);
      }
    }
  };
  
  await collect(dir);
  return files;
} 