/**
 * Utility for cleaning up old projects
 */
import { projectStorage } from '../services/project-storage-service';
import fs from 'fs-extra';
import { logInfo, logWarning, logSuccess } from './logging';

const MAX_AGE_DAYS = 7; // Projects older than this will be removed

/**
 * Check if a project is older than the maximum age
 */
function isProjectTooOld(lastAccessedDate: Date): boolean {
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const now = new Date();
  return now.getTime() - lastAccessedDate.getTime() > maxAgeMs;
}

/**
 * Clean up old projects
 */
export async function cleanupOldProjects(): Promise<void> {
  logInfo('Cleaning up old projects...');
  
  // Get all projects
  const projects = await projectStorage.getAllProjects();
  let removedCount = 0;
  let errorCount = 0;
  
  for (const project of projects) {
    if (isProjectTooOld(project.lastAccessedAt)) {
      logInfo(`Removing old project: ${project.id}`);
      
      // Delete project directory
      try {
        // Check if project directory exists before removing
        if (project.directory) {
          await fs.remove(project.directory);
        }
        
        // Remove from storage
        await projectStorage.removeProject(project.id);
        removedCount++;
      } catch (error) {
        logWarning(`Error removing project directory ${project.directory}: ${error}`);
        errorCount++;
      }
    }
  }
  
  logSuccess(`Project cleanup complete: ${removedCount} projects removed, ${errorCount} errors`);
} 