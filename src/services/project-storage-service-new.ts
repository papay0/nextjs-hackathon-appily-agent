/**
 * Project storage service
 * 
 * This service provides an interface for storing and retrieving project data.
 * It is designed to be instantiated FRESH FOR EACH REQUEST to support high concurrency,
 * with no shared state between different requests.
 */

import { ConversationMessage, ProjectEntry, ProjectStatus } from '../types/api';
import { DualStorageProvider } from './storage/storage-provider';
import { DualFileStorage } from './storage/file-storage';
import { FirestoreLogger } from '../utils/firestore-logger';
import { logInfo, logError, logWarning } from '../utils/logging';

/**
 * Service for managing project storage
 * Creates fresh provider instances for each method call to ensure request isolation
 */
export class ProjectStorageService {
  /**
   * Create a new project entry
   * @param projectId - Client-provided project ID
   * @param directory - Local project directory path
   * @param ownerId - User ID of project owner 
   * @param projectSummary - Optional summary of the project
   * @returns The saved project entry
   */
  async createProject(
    projectId: string,
    directory: string,
    ownerId: string,
    projectSummary?: string
  ): Promise<ProjectEntry> {
    logInfo(`Creating new project ${projectId} for user ${ownerId} in directory ${directory}`);
    const storageProvider = new DualStorageProvider();
    
    // Create new project entry
    const project: ProjectEntry = {
      id: projectId,
      directory,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      conversationHistory: [],
      ownerId,
      status: ProjectStatus.GENERATING,
      projectSummary
    };
    
    // Save to storage
    try {
      logInfo(`Saving new project ${projectId} to storage`);
      await storageProvider.saveProject(project);
      logInfo(`Successfully saved new project ${projectId} to storage`);
    } catch (error) {
      logError(`Failed to save new project ${projectId} to storage:`, error);
      throw error;
    }
    
    return project;
  }
  
  /**
   * Get a project by ID
   * @param projectId - Project ID
   * @returns The project entry or null if not found
   */
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    logInfo(`Getting project ${projectId} from storage`);
    const storageProvider = new DualStorageProvider();
    
    try {
      const project = await storageProvider.getProject(projectId);
      if (project) {
        logInfo(`Found project ${projectId} in storage`);
      } else {
        logWarning(`Project ${projectId} not found in storage`);
      }
      return project;
    } catch (error) {
      logError(`Error getting project ${projectId} from storage:`, error);
      return null;
    }
  }
  
  /**
   * Save an existing project
   * @param project - Project entry to save
   */
  async saveProject(project: ProjectEntry): Promise<void> {
    logInfo(`Saving project ${project.id} to storage providers`);
    const storageProvider = new DualStorageProvider();
    
    try {
      await storageProvider.saveProject(project);
      logInfo(`Successfully saved project ${project.id} to storage providers`);
    } catch (error) {
      logError(`Failed to save project ${project.id} to storage:`, error);
      throw error;
    }
  }
  
  /**
   * Get project directory by ID
   * @param id - Project ID
   * @returns Local directory path or null if not found
   */
  async getProjectDirectory(id: string): Promise<string | null> {
    const project = await this.getProject(id);
    return project?.directory || null;
  }
  
  /**
   * Add a conversation message to a project
   * @param projectId - Project ID
   * @param role - Message role (user or assistant)
   * @param content - Message content
   * @param isFollowUp - Whether this is a follow-up message
   */
  async addConversationMessage(
    projectId: string,
    role: 'user' | 'assistant',
    content: string,
    isFollowUp = false
  ): Promise<void> {
    logInfo(`Adding conversation message to project ${projectId} (role: ${role}, isFollowUp: ${isFollowUp})`);
    const storageProvider = new DualStorageProvider();
    
    // Get existing project
    logInfo(`Retrieving project ${projectId} for adding message`);
    const project = await storageProvider.getProject(projectId);
    
    if (!project) {
      logError(`Project not found: ${projectId} - Cannot add conversation message`);
      throw new Error(`Project not found: ${projectId}`);
    }
    
    logInfo(`Found project ${projectId}, adding message to conversation history`);
    
    // Add message to conversation history
    const message: ConversationMessage = {
      role,
      content,
      timestamp: new Date(),
      isFollowUp
    };
    
    project.conversationHistory.push(message);
    project.lastAccessedAt = new Date();
    
    // Save updated project
    try {
      logInfo(`Saving updated project ${projectId} with new conversation message`);
      await storageProvider.saveProject(project);
      logInfo(`Successfully saved project ${projectId} with new message`);
    } catch (error) {
      logError(`Failed to save project ${projectId} with new message:`, error);
      throw error;
    }
  }
  
  /**
   * Get conversation history for a project
   * @param projectId - Project ID
   * @returns Array of conversation messages
   */
  async getConversationHistory(projectId: string): Promise<ConversationMessage[]> {
    const project = await this.getProject(projectId);
    return project?.conversationHistory || [];
  }
  
  /**
   * Upload project files to storage
   * @param projectId - Project ID
   * @param directory - Source directory
   * @param logger - Optional logger for progress information
   */
  async uploadProjectFiles(
    projectId: string,
    directory: string,
    logger?: FirestoreLogger
  ): Promise<void> {
    const fileStorage = new DualFileStorage();
    await fileStorage.uploadProjectFiles(projectId, directory, logger);
    
    // Update project status to completed
    const project = await this.getProject(projectId);
    if (project) {
      project.status = ProjectStatus.COMPLETED;
      await this.saveProject(project);
    }
  }
  
  /**
   * Download project files from storage
   * @param projectId - Project ID
   * @param targetDirectory - Target directory
   */
  async downloadProjectFiles(
    projectId: string,
    targetDirectory: string
  ): Promise<void> {
    const fileStorage = new DualFileStorage();
    await fileStorage.downloadProjectFiles(projectId, targetDirectory);
    
    // Update last accessed timestamp
    const project = await this.getProject(projectId);
    if (project) {
      project.lastAccessedAt = new Date();
      await this.saveProject(project);
    }
  }
  
  /**
   * Delete a project and all its files
   * @param projectId - Project ID
   * @returns true if project was deleted, false otherwise
   */
  async deleteProject(projectId: string): Promise<boolean> {
    const storageProvider = new DualStorageProvider();
    const fileStorage = new DualFileStorage();
    
    // Delete files first
    await fileStorage.deleteProjectFiles(projectId);
    
    // Then delete project metadata
    return storageProvider.deleteProject(projectId);
  }
  
  /**
   * Update project status
   * @param projectId - Project ID
   * @param status - New status
   */
  async updateProjectStatus(
    projectId: string,
    status: ProjectStatus
  ): Promise<void> {
    const project = await this.getProject(projectId);
    if (project) {
      project.status = status;
      await this.saveProject(project);
    }
  }
}
