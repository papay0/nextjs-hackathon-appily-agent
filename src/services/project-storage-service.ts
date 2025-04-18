/* eslint-disable no-unused-vars */
/**
 * Service for storing and retrieving project directories by ID
 */
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import * as admin from 'firebase-admin';
import { ConversationMessage, ProjectStatus } from '../types/api';
import { logError, logInfo } from '../utils/logging';
import { isFirebaseEnabled } from '../config/firebase-admin-config';
import { FirebaseFileStorage } from './firebase-file-storage';

/**
 * Interface for a project entry in storage
 */
export interface ProjectEntry {
  /** Unique identifier for the project */
  id: string;
  /** Path to the project directory (local) */
  directory?: string;
  /** When the project was created */
  createdAt: Date;
  /** When the project was last accessed */
  lastAccessedAt: Date;
  /** Complete conversation history for the project */
  conversationHistory: ConversationMessage[];
  /** The user ID of the project owner */
  ownerId?: string;
  /** The current status of the project */
  status?: ProjectStatus;
}

/**
 * Storage provider interface for different backend implementations
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

// File locking mechanism
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  // Get or create lock for this project
  let lock = locks.get(projectId);
  if (!lock) {
    lock = Promise.resolve();
    locks.set(projectId, lock);
  }

  // Create new lock
  const newLock = lock.then(async () => {
    try {
      return await operation();
    } finally {
      // Remove lock when done
      if (locks.get(projectId) === lock) {
        locks.delete(projectId);
      }
    }
  });

  // Update lock
  locks.set(projectId, newLock);

  return newLock;
}

/**
 * File-based storage provider implementation
 */
export class FileStorageProvider implements StorageProvider {
  private storageFile: string;
  
  constructor(storageDirectory: string) {
    this.storageFile = path.join(storageDirectory, 'projects.json');
    fs.ensureDirSync(storageDirectory);
  }
  
  async saveProject(project: ProjectEntry): Promise<void> {
    return withLock(project.id, async () => {
      // Load existing projects
      const projects = await this.getAllProjects();
      
      // Find and update or add the project
      const index = projects.findIndex(p => p.id === project.id);
      if (index >= 0) {
        projects[index] = project;
      } else {
        projects.push(project);
      }
      
      // Save back to file with retry logic
      let retries = 3;
      while (retries > 0) {
        try {
          await fs.writeJSON(this.storageFile, projects, { spaces: 2 });
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    });
  }
  
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    return withLock(projectId, async () => {
      const projects = await this.getAllProjects();
      return projects.find(p => p.id === projectId) || null;
    });
  }
  
  async getAllProjects(): Promise<ProjectEntry[]> {
    try {
      if (await fs.pathExists(this.storageFile)) {
        const data = await fs.readJSON(this.storageFile) as Partial<ProjectEntry>[];
        return data.map(entry => ({
          ...entry,
          id: entry.id as string, // ID is required
          directory: entry.directory, // Now optional
          createdAt: new Date(entry.createdAt as Date),
          lastAccessedAt: new Date(entry.lastAccessedAt as Date),
          conversationHistory: (entry.conversationHistory || []).map((msg: Partial<ConversationMessage>) => ({
            ...msg,
            role: msg.role as 'user' | 'assistant',
            content: msg.content as string,
            timestamp: new Date(msg.timestamp as Date)
          })) as ConversationMessage[],
          ownerId: entry.ownerId, // Optional ownerId
          status: entry.status // Optional status
        })) as ProjectEntry[];
      }
    } catch (error) {
      logError('Error loading projects:', error);
    }
    return [];
  }
  
  async deleteProject(projectId: string): Promise<boolean> {
    return withLock(projectId, async () => {
      const projects = await this.getAllProjects();
      const initialLength = projects.length;
      const filtered = projects.filter(p => p.id !== projectId);
      
      if (filtered.length !== initialLength) {
        // Save with retry logic
        let retries = 3;
        while (retries > 0) {
          try {
            await fs.writeJSON(this.storageFile, filtered, { spaces: 2 });
            break;
          } catch (error) {
            retries--;
            if (retries === 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        return true;
      }
      
      return false;
    });
  }
}

/**
 * Main service for managing project storage
 */
export class ProjectStorageService {
  private projects: Map<string, ProjectEntry> = new Map();
  private storageProvider: StorageProvider;
  private initialized: boolean = false;
  
  constructor(storageProvider: StorageProvider) {
    this.storageProvider = storageProvider;
  }
  
  /**
   * Initialize the service by loading projects from storage
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const projects = await this.storageProvider.getAllProjects();
    this.projects = new Map(projects.map(entry => [entry.id, entry]));
    this.initialized = true;
  }
  
  /**
   * Register a new project and get its ID
   */
  async registerProject(directory: string): Promise<string> {
    await this.initialize();
    
    const id = uuidv4();
    const entry: ProjectEntry = {
      id,
      directory,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      conversationHistory: []
    };
    
    this.projects.set(id, entry);
    await this.storageProvider.saveProject(entry);
    return id;
  }
  
  /**
   * Get project directory by ID
   */
  async getProjectDirectory(id: string): Promise<string | null> {
    await this.initialize();
    
    const entry = this.projects.get(id);
    if (!entry) return null;
    
    // Update last accessed time
    entry.lastAccessedAt = new Date();
    await this.storageProvider.saveProject(entry);
    
    return entry.directory || null;
  }
  
  /**
   * Get full project entry by ID
   */
  async getProject(id: string): Promise<ProjectEntry | null> {
    await this.initialize();
    
    const entry = this.projects.get(id);
    if (!entry) return null;
    
    // Update last accessed time
    entry.lastAccessedAt = new Date();
    await this.storageProvider.saveProject(entry);
    
    return entry;
  }
  
  /**
   * Add a conversation message to a project
   */
  async addConversationMessage(
    projectId: string, 
    role: 'user' | 'assistant', 
    content: string, 
    isFollowUp?: boolean
  ): Promise<void> {
    await this.initialize();
    
    const entry = this.projects.get(projectId);
    if (!entry) {
      throw new Error(`Project with ID ${projectId} not found`);
    }
    
    const message: ConversationMessage = {
      role,
      content,
      timestamp: new Date(),
      isFollowUp
    };
    
    entry.conversationHistory.push(message);
    await this.storageProvider.saveProject(entry);
  }
  
  /**
   * Get conversation history for a project
   */
  async getConversationHistory(projectId: string): Promise<ConversationMessage[]> {
    await this.initialize();
    
    const entry = this.projects.get(projectId);
    if (!entry) {
      throw new Error(`Project with ID ${projectId} not found`);
    }
    
    return [...entry.conversationHistory];
  }
  
  /**
   * Get all projects
   */
  async getAllProjects(): Promise<ProjectEntry[]> {
    await this.initialize();
    
    return Array.from(this.projects.values());
  }
  
  /**
   * Remove a project by ID
   */
  async removeProject(id: string): Promise<boolean> {
    await this.initialize();
    
    const result = this.projects.delete(id);
    if (result) {
      await this.storageProvider.deleteProject(id);
    }
    return result;
  }
}

/**
 * Firebase storage provider implementation
 * Uses Firestore for storing project metadata
 */
export class FirebaseStorageProvider implements StorageProvider {
  private readonly collectionName = 'projects';
  private fileStorage: FirebaseFileStorage;

  constructor() {
    this.fileStorage = new FirebaseFileStorage();
  }

  async saveProject(project: ProjectEntry): Promise<void> {
    try {
      // Import here to avoid circular dependencies
      const { getFirestore } = require('../config/firebase-admin-config');
      const db = await getFirestore();
      if (!db) {
        throw new Error('Firebase is not initialized');
      }
      
      // Convert dates to Firestore timestamps for proper storage
      const firestoreProject = {
        ...project,
        createdAt: project.createdAt, // Firestore handles Date objects
        lastAccessedAt: project.lastAccessedAt,
        conversationHistory: project.conversationHistory.map(msg => ({
          ...msg,
          timestamp: msg.timestamp // Firestore handles Date objects
        }))
      };
      
      // Save to Firestore
      await db.collection(this.collectionName).doc(project.id).set(firestoreProject);
      logInfo(`Project ${project.id} saved to Firebase Firestore`);
    } catch (error) {
      logError(`Error saving project ${project.id} to Firebase:`, error);
      throw error;
    }
  }

  async getProject(projectId: string): Promise<ProjectEntry | null> {
    try {
      const { getFirestore } = require('../config/firebase-admin-config');
      const db = await getFirestore();
      if (!db) {
        throw new Error('Firebase is not initialized');
      }
      
      const doc = await db.collection(this.collectionName).doc(projectId).get();
      
      if (!doc.exists) {
        return null;
      }
      
      const data = doc.data();
      if (!data) {
        return null;
      }
      
      // Convert Firestore data to ProjectEntry
      return {
        id: doc.id,
        directory: data.directory,
        createdAt: data.createdAt.toDate(), // Convert Firestore timestamp to Date
        lastAccessedAt: data.lastAccessedAt.toDate(),
        conversationHistory: (data.conversationHistory || []).map((msg: {role: string; content: string; timestamp: admin.firestore.Timestamp; isFollowUp?: boolean}) => ({
          ...msg,
          timestamp: msg.timestamp.toDate()
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
      const { getFirestore } = require('../config/firebase-admin-config');
      const db = await getFirestore();
      if (!db) {
        throw new Error('Firebase is not initialized');
      }
      
      const snapshot = await db.collection(this.collectionName).get();
      
      return snapshot.docs
        .map((doc: admin.firestore.QueryDocumentSnapshot) => {
          const data = doc.data();
          
          if (!data) return null;
          
          return {
            id: doc.id,
            directory: data.directory,
            createdAt: data.createdAt.toDate(),
            lastAccessedAt: data.lastAccessedAt.toDate(),
            conversationHistory: (data.conversationHistory || []).map((msg: {role: string; content: string; timestamp: admin.firestore.Timestamp; isFollowUp?: boolean}) => ({
              ...msg,
              timestamp: msg.timestamp.toDate()
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
      const { getFirestore } = require('../config/firebase-admin-config');
      const db = await getFirestore();
      if (!db) {
        throw new Error('Firebase is not initialized');
      }
      
      // Delete project metadata from Firestore
      await db.collection(this.collectionName).doc(projectId).delete();
      
      // Also delete all project files from Firebase Storage
      await this.fileStorage.deleteProjectFiles(projectId);
      
      logInfo(`Project ${projectId} deleted from Firebase`);
      return true;
    } catch (error) {
      logError(`Error deleting project ${projectId} from Firebase:`, error);
      return false;
    }
  }
}

// Create and export the appropriate storage implementation based on configuration
const storageDir = path.join(__dirname, '..', '..', 'data');
fs.ensureDirSync(storageDir);

// Determine which storage provider to use
let storageProvider: StorageProvider;
if (isFirebaseEnabled()) {
  logInfo('Using Firebase storage provider');
  storageProvider = new FirebaseStorageProvider();
} else {
  logInfo('Using file-based storage provider');
  storageProvider = new FileStorageProvider(storageDir);
}

// Create the storage service with the selected provider
export const projectStorage = new ProjectStorageService(storageProvider);