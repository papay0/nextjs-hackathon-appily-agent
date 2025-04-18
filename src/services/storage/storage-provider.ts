/* eslint-disable no-unused-vars */
/**
 * Storage provider interfaces and implementations
 * 
 * This file defines the interfaces and implementations for project metadata storage.
 * All providers are designed to be instantiated PER REQUEST, with no shared state between
 * different requests to support high concurrency.
 */
import path from 'path';
import fs from 'fs-extra';
import * as admin from 'firebase-admin';
import { ProjectEntry, ProjectStatus } from '../../types/api';
import { logError, logInfo, logWarning } from '../../utils/logging';
import { isFirebaseEnabled, isLocalStorageEnabled, getLocalStoragePath } from '../../config/environment';

/**
 * Storage provider interface for different backend implementations
 * All implementations should be stateless or handle their own concurrency control
 */
export interface StorageProvider {
  /** Save a project entry */
  saveProject(project: ProjectEntry): Promise<void>;
  
  /** Get a project entry by ID */
  getProject(projectId: string): Promise<ProjectEntry | null>;
  
  /** Get all project entries */
  getAllProjects(): Promise<ProjectEntry[]>;
  
  /** Delete a project by ID */
  deleteProject(projectId: string): Promise<boolean>;
}

/**
 * File-based storage provider implementation
 * Each instance works with a fresh filesystem connection
 */
export class FileStorageProvider implements StorageProvider {
  private readonly storageFile: string;
  
  constructor() {
    const storageDirectory = path.join(process.cwd(), getLocalStoragePath());
    this.storageFile = path.join(storageDirectory, 'projects.json');
    fs.ensureDirSync(storageDirectory);
  }
  
  async saveProject(project: ProjectEntry): Promise<void> {
    // Use file locking to prevent race conditions
    // This can be optimized with a distributed lock if needed
    const lockFile = `${this.storageFile}.lock`;
    try {
      // Create a lock file to ensure atomic operations
      await fs.writeFile(lockFile, Date.now().toString());
      
      // Load existing projects
      const projects = await this.getAllProjects();
      
      // Find and update or add the project
      const index = projects.findIndex(p => p.id === project.id);
      if (index >= 0) {
        projects[index] = project;
      } else {
        projects.push(project);
      }
      
      // Save back to file
      await fs.writeJSON(this.storageFile, projects, { spaces: 2 });
    } catch (error) {
      logError(`Error saving project ${project.id} to local storage:`, error);
      throw error;
    } finally {
      // Remove lock
      try {
        await fs.remove(lockFile);
      } catch (error) {
        logWarning(`Failed to remove lock file: ${lockFile}`, error);
      }
    }
  }
  
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    try {
      const projects = await this.getAllProjects();
      const project = projects.find(p => p.id === projectId);
      return project || null;
    } catch (error) {
      logError(`Error getting project ${projectId} from local storage:`, error);
      return null;
    }
  }
  
  async getAllProjects(): Promise<ProjectEntry[]> {
    try {
      if (await fs.pathExists(this.storageFile)) {
        const data = await fs.readJSON(this.storageFile) as Partial<ProjectEntry>[];
        
        return data.map(entry => ({
          ...entry,
          id: entry.id as string,
          directory: entry.directory,
          createdAt: new Date(entry.createdAt as Date),
          lastAccessedAt: new Date(entry.lastAccessedAt as Date),
          conversationHistory: (entry.conversationHistory || []).map(msg => ({
            ...msg,
            timestamp: new Date(msg.timestamp as Date)
          })),
          ownerId: entry.ownerId,
          status: entry.status as ProjectStatus
        }));
      }
      return [];
    } catch (error) {
      logError('Error reading projects from local storage:', error);
      return [];
    }
  }
  
  async deleteProject(projectId: string): Promise<boolean> {
    try {
      const projects = await this.getAllProjects();
      const filteredProjects = projects.filter(p => p.id !== projectId);
      
      // If no change in count, the project wasn't found
      if (filteredProjects.length === projects.length) {
        return false;
      }
      
      await fs.writeJSON(this.storageFile, filteredProjects, { spaces: 2 });
      return true;
    } catch (error) {
      logError(`Error deleting project ${projectId} from local storage:`, error);
      return false;
    }
  }
}

/**
 * Firebase-based storage provider implementation 
 * Each instance creates a new Firebase connection
 */
export class FirebaseStorageProvider implements StorageProvider {
  private readonly collectionName = 'projects';
  
  constructor() {
    // No initialization needed here - we'll get a fresh Firestore instance on each method call
  }
  
  async saveProject(project: ProjectEntry): Promise<void> {
    try {
      logInfo(`[FirebaseStorageProvider] Saving project ${project.id} to Firestore`);
      
      // Import the Firebase admin config
      const { getFirestore, isFirebaseEnabled } = require('../../config/firebase-admin-config');
      
      // Check if Firebase is enabled
      if (!isFirebaseEnabled()) {
        logWarning(`[FirebaseStorageProvider] Firebase is not enabled - skipping save operation`);
        return;
      }
      
      logInfo(`[FirebaseStorageProvider] Getting Firestore instance`);
      const db = await getFirestore();
      if (!db) {
        logError('[FirebaseStorageProvider] Firestore is not initialized - Firebase Admin SDK may not be properly configured');
        throw new Error('Firebase is not initialized');
      }
      
      logInfo(`[FirebaseStorageProvider] Successfully got Firestore instance`);
      
      // Convert JavaScript dates to Firestore timestamps
      const firestoreProject = {
        ...project,
        createdAt: admin.firestore.Timestamp.fromDate(project.createdAt),
        lastAccessedAt: admin.firestore.Timestamp.fromDate(project.lastAccessedAt),
        conversationHistory: project.conversationHistory.map(msg => ({
          ...msg,
          timestamp: admin.firestore.Timestamp.fromDate(msg.timestamp)
        }))
      };
      
      // Save to Firestore
      logInfo(`[FirebaseStorageProvider] Saving project ${project.id} to collection ${this.collectionName}`);
      await db.collection(this.collectionName).doc(project.id).set(firestoreProject, { merge: true });
      logInfo(`[FirebaseStorageProvider] Project ${project.id} saved to Firebase Firestore`);
    } catch (error) {
      logError(`Error saving project ${project.id} to Firebase:`, error);
      throw error;
    }
  }
  
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    try {
      logInfo(`[FirebaseStorageProvider] Getting project ${projectId} from Firestore`);
      
      // Import the Firebase admin config
      const { getFirestore, isFirebaseEnabled } = require('../../config/firebase-admin-config');
      
      // Check if Firebase is enabled
      if (!isFirebaseEnabled()) {
        logWarning(`[FirebaseStorageProvider] Firebase is not enabled - skipping get operation`);
        return null;
      }
      
      logInfo(`[FirebaseStorageProvider] Getting Firestore instance for project ${projectId}`);
      const db = await getFirestore();
      if (!db) {
        logError('[FirebaseStorageProvider] Firestore is not initialized - Firebase Admin SDK may not be properly configured');
        throw new Error('Firebase is not initialized');
      }
      
      logInfo(`[FirebaseStorageProvider] Fetching document ${projectId} from collection ${this.collectionName}`);
      const doc = await db.collection(this.collectionName).doc(projectId).get();
      
      if (!doc.exists) {
        logWarning(`[FirebaseStorageProvider] Project ${projectId} not found in Firestore`);
        return null;
      }
      
      logInfo(`[FirebaseStorageProvider] Successfully retrieved project ${projectId} from Firestore`);
      
      const data = doc.data();
      if (!data) {
        return null;
      }
      
      // Convert Firestore data to ProjectEntry
      const createdAt = data.createdAt instanceof admin.firestore.Timestamp 
                      ? data.createdAt.toDate() 
                      : new Date(); // Fallback to current date
      const lastAccessedAt = data.lastAccessedAt instanceof admin.firestore.Timestamp 
                           ? data.lastAccessedAt.toDate() 
                           : createdAt; // Fallback to creation date or current date
      
      return {
        id: doc.id,
        directory: data.directory,
        createdAt: createdAt,
        lastAccessedAt: lastAccessedAt,
        conversationHistory: (data.conversationHistory || []).map((msg: {role: string; content: string; timestamp: admin.firestore.Timestamp; isFollowUp?: boolean}) => ({
          role: msg.role,
          content: msg.content,
          // Also make conversation timestamp conversion safe
          timestamp: msg.timestamp instanceof admin.firestore.Timestamp 
                     ? msg.timestamp.toDate() 
                     : new Date(), 
          isFollowUp: msg.isFollowUp
        })),
        ownerId: data.ownerId,
        status: data.status
      };
    } catch (error) {
      logError(`Error getting project ${projectId} from Firebase:`, error);
      return null;
    }
  }
  
  async getAllProjects(): Promise<ProjectEntry[]> {
    try {
      const { getFirestore } = require('../../config/firebase-admin-config');
      const db = await getFirestore();
      if (!db) {
        throw new Error('Firebase is not initialized');
      }
      
      const snapshot = await db.collection(this.collectionName).get();
      
      return snapshot.docs
        .map((doc: admin.firestore.QueryDocumentSnapshot) => {
          const data = doc.data();
          
          if (!data) return null;
          
          // Make timestamp conversion safe here too
          const createdAtAll = data.createdAt instanceof admin.firestore.Timestamp 
                           ? data.createdAt.toDate() 
                           : new Date(); 
          const lastAccessedAtAll = data.lastAccessedAt instanceof admin.firestore.Timestamp 
                                ? data.lastAccessedAt.toDate() 
                                : createdAtAll;
          
          return {
            id: doc.id,
            directory: data.directory,
            createdAt: createdAtAll,
            lastAccessedAt: lastAccessedAtAll,
            conversationHistory: (data.conversationHistory || []).map((msg: {role: string; content: string; timestamp: admin.firestore.Timestamp; isFollowUp?: boolean}) => ({
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp instanceof admin.firestore.Timestamp 
                         ? msg.timestamp.toDate() 
                         : new Date(),
              isFollowUp: msg.isFollowUp
            })),
            ownerId: data.ownerId,
            status: data.status
          };
        })
        .filter((project: ProjectEntry | null): project is ProjectEntry => project !== null);
    } catch (error) {
      logError('Error getting all projects from Firebase:', error);
      return [];
    }
  }
  
  async deleteProject(projectId: string): Promise<boolean> {
    try {
      const { getFirestore } = require('../../config/firebase-admin-config');
      const db = await getFirestore();
      if (!db) {
        throw new Error('Firebase is not initialized');
      }
      
      // Delete project metadata from Firestore
      await db.collection(this.collectionName).doc(projectId).delete();
      logInfo(`Project ${projectId} deleted from Firebase Firestore`);
      return true;
    } catch (error) {
      logError(`Error deleting project ${projectId} from Firebase:`, error);
      return false;
    }
  }
}

/**
 * Combined storage provider that can write to both local and Firebase storage.
 * Each instance is constructed fresh per request.
 */
export class DualStorageProvider implements StorageProvider {
  private readonly localProvider: FileStorageProvider;
  private readonly firebaseProvider: FirebaseStorageProvider | null;
  private readonly useLocalStorage: boolean;
  private readonly useFirebase: boolean;
  
  constructor() {
    this.useLocalStorage = isLocalStorageEnabled();
    this.useFirebase = isFirebaseEnabled();
    
    this.localProvider = new FileStorageProvider();
    this.firebaseProvider = this.useFirebase ? new FirebaseStorageProvider() : null;
  }
  
  async saveProject(project: ProjectEntry): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.useLocalStorage) {
      promises.push(this.localProvider.saveProject(project));
    }
    
    if (this.useFirebase && this.firebaseProvider) {
      promises.push(this.firebaseProvider.saveProject(project));
    }
    
    if (promises.length === 0) {
      throw new Error('No storage providers enabled');
    }
    
    await Promise.all(promises);
  }
  
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    // Try Firebase first if enabled (typically more up-to-date in production)
    if (this.useFirebase && this.firebaseProvider) {
      try {
        const project = await this.firebaseProvider.getProject(projectId);
        if (project) return project;
      } catch (error) {
        logWarning(`Error getting project ${projectId} from Firebase, falling back to local storage`, error);
      }
    }
    
    // Fall back to local storage if Firebase failed or is disabled
    if (this.useLocalStorage) {
      return this.localProvider.getProject(projectId);
    }
    
    return null;
  }
  
  async getAllProjects(): Promise<ProjectEntry[]> {
    // Try Firebase first if enabled
    if (this.useFirebase && this.firebaseProvider) {
      try {
        return await this.firebaseProvider.getAllProjects();
      } catch (error) {
        logWarning('Error getting all projects from Firebase, falling back to local storage', error);
      }
    }
    
    // Fall back to local storage
    if (this.useLocalStorage) {
      return this.localProvider.getAllProjects();
    }
    
    return [];
  }
  
  async deleteProject(projectId: string): Promise<boolean> {
    const promises: Promise<boolean>[] = [];
    
    if (this.useLocalStorage) {
      promises.push(this.localProvider.deleteProject(projectId));
    }
    
    if (this.useFirebase && this.firebaseProvider) {
      promises.push(this.firebaseProvider.deleteProject(projectId));
    }
    
    if (promises.length === 0) {
      return false;
    }
    
    const results = await Promise.all(promises);
    return results.some(result => result);
  }
}
