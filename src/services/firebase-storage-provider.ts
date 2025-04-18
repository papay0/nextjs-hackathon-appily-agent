/**
 * Firebase implementation of the StorageProvider interface
 * 
 * This file handles storing and retrieving project metadata from Firestore
 */
import * as admin from 'firebase-admin';
import { logError, logInfo } from '../utils/logging';
import { ProjectEntry, StorageProvider } from './project-storage-service';
import { getFirestore } from '../config/firebase-admin-config';

// Firestore collection name for projects
const PROJECTS_COLLECTION = 'projects';

/**
 * Convert Firestore timestamp to JavaScript Date
 */
function convertTimestampToDate(timestamp: admin.firestore.Timestamp): Date {
  return timestamp.toDate();
}

/**
 * Convert JavaScript Date to Firestore timestamp
 */
function convertDateToTimestamp(date: Date): admin.firestore.Timestamp {
  return admin.firestore.Timestamp.fromDate(date);
}

/**
 * Convert a Firestore document to a ProjectEntry
 */
function convertDocToProjectEntry(doc: admin.firestore.DocumentSnapshot): ProjectEntry | null {
  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  if (!data) {
    return null;
  }

  // Convert Firestore timestamps to JavaScript Dates
  return {
    id: doc.id,
    directory: data.directory,
    createdAt: data.createdAt ? convertTimestampToDate(data.createdAt) : new Date(),
    lastAccessedAt: data.lastAccessedAt ? convertTimestampToDate(data.lastAccessedAt) : new Date(),
    conversationHistory: (data.conversationHistory || []).map((msg: {role: string; content: string; timestamp: admin.firestore.Timestamp; isFollowUp?: boolean}) => ({
      ...msg,
      timestamp: msg.timestamp ? convertTimestampToDate(msg.timestamp) : new Date()
    })),
    ownerId: data.ownerId || null,
    status: data.status || null
  };
}

/**
 * Firebase implementation of the StorageProvider interface
 */
export class FirebaseStorageProvider implements StorageProvider {
  /**
   * Save a project entry to Firestore
   */
  async saveProject(project: ProjectEntry): Promise<void> {
    try {
      const db = await getFirestore();
      if (!db) {
        logError('Firebase is not initialized');
        throw new Error('Firebase is not initialized');
      }

      // Convert dates to Firestore timestamps
      const firestoreProject = {
        ...project,
        createdAt: convertDateToTimestamp(project.createdAt),
        lastAccessedAt: convertDateToTimestamp(project.lastAccessedAt),
        conversationHistory: project.conversationHistory.map(msg => ({
          ...msg,
          timestamp: convertDateToTimestamp(msg.timestamp)
        }))
      };

      // Save to Firestore
      await db.collection(PROJECTS_COLLECTION).doc(project.id).set(firestoreProject);
      logInfo(`Project ${project.id} saved to Firestore`);
    } catch (error) {
      logError('Error saving project to Firestore:', error);
      throw error;
    }
  }

  /**
   * Get a project entry by ID from Firestore
   */
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    try {
      const db = await getFirestore();
      if (!db) {
        logError('Firebase is not initialized');
        return null;
      }

      const doc = await db.collection(PROJECTS_COLLECTION).doc(projectId).get();
      return convertDocToProjectEntry(doc);
    } catch (error) {
      logError(`Error getting project ${projectId} from Firestore:`, error);
      return null;
    }
  }

  /**
   * Get all project entries from Firestore
   */
  async getAllProjects(): Promise<ProjectEntry[]> {
    try {
      const db = await getFirestore();
      if (!db) {
        logError('Firebase is not initialized');
        return [];
      }

      const snapshot = await db.collection(PROJECTS_COLLECTION).get();
      return snapshot.docs
        .map(convertDocToProjectEntry)
        .filter((project): project is ProjectEntry => project !== null);
    } catch (error) {
      logError('Error getting all projects from Firestore:', error);
      return [];
    }
  }

  /**
   * Delete a project by ID from Firestore
   */
  async deleteProject(projectId: string): Promise<boolean> {
    try {
      const db = await getFirestore();
      if (!db) {
        logError('Firebase is not initialized');
        return false;
      }

      await db.collection(PROJECTS_COLLECTION).doc(projectId).delete();
      logInfo(`Project ${projectId} deleted from Firestore`);
      return true;
    } catch (error) {
      logError(`Error deleting project ${projectId} from Firestore:`, error);
      return false;
    }
  }
}
