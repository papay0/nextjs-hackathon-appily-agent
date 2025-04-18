# Firebase/Firestore Migration Plan

## Overview

This document outlines the plan to migrate from the current Server-Sent Events (SSE) architecture to a Firebase/Firestore-based solution for real-time progress updates in the Appily Agent.

## Current Architecture

### SSE Implementation

- **StreamLogger**: Sends log messages back to the client via HTTP streaming.
- **Connection-Dependent**: Client must maintain an active HTTP connection to receive updates.
- **Issue**: Mobile clients that navigate away lose connection and progress updates.

### Cloud Run Behavior

- Processing continues even when clients disconnect
- Output after disconnection is lost to the client
- No built-in reconnection mechanism to retrieve missed updates
- Request timeout (typically 60 minutes)

## Proposed Firebase/Firestore Architecture

### High-Level Design

1. **Decoupled Processing**: Cloud Run service operates independently of client connections
2. **Persistent Data**: All logs and progress data stored in Firestore
3. **Real-Time Updates**: Clients subscribe to Firestore collections for updates
4. **Connection Resilience**: Clients can disconnect/reconnect without losing progress visibility

### Data Model

```
/projects/{projectId}/
  - metadata/
      - createdAt: timestamp
      - lastAccessedAt: timestamp
      - status: 'pending' | 'running' | 'complete' | 'error'
      - createdBy: userId
  - logs/
      - {logId}/
          - level: 'info' | 'success' | 'warning' | 'error' | 'debug'
          - message: string
          - timestamp: timestamp
          - data?: {
              progress?: { step: number, totalSteps: number }
              file?: { filePath: string, operation: 'create' | 'edit' | 'delete' }
              command?: { command: string, cwd?: string }
              buildError?: string
          }
  - result/
      - deployUrl?: string
      - projectDir?: string
      - generationSummary: {
          success: boolean
          attempts: number
          lintError: boolean
          buildError: boolean
          fileCount: number
          totalDurationMs: number
          inputTokens: number
          outputTokens: number
          inputCost: number
          outputCost: number
          totalCost: number
          modelKey: string
          hasActualLintErrors: boolean
          timings: Record<string, number>
          outputTokensPerSecond: number
      }
```

## Implementation Steps

### 1. Firebase Setup

1. **Create Firebase Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project or use existing
   - Enable Firestore database

2. **Install Firebase SDK**:
   ```bash
   npm install firebase firebase-admin
   ```

3. **Firebase Configuration**:
   - Create `.env` variables for Firebase credentials
   - Set up Firebase Admin SDK for server-side access

### 2. Create FirestoreLogger Implementation

```typescript
// src/utils/firestore-logger.ts

import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { LogLevel, LogData, LogMessage } from './stream-logger';

export class FirestoreLogger {
  private firestore: Firestore;
  private projectId: string;
  private consoleLogger: boolean;
  private logPrefix: string;

  constructor(
    firestore: Firestore,
    projectId: string,
    consoleLogger = true,
    logPrefix = ''
  ) {
    this.firestore = firestore;
    this.projectId = projectId;
    this.consoleLogger = consoleLogger;
    this.logPrefix = logPrefix ? `[${logPrefix}] ` : '';
    
    // Initialize project status
    this.updateProjectStatus('running');
  }

  private async log(level: LogLevel, message: string, data?: LogData): Promise<void> {
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(data !== undefined && { data })
    };

    // Console logging if enabled (same as StreamLogger)
    if (this.consoleLogger) {
      // Implement similar to StreamLogger
    }

    // Write to Firestore
    try {
      await this.firestore
        .collection(`projects/${this.projectId}/logs`)
        .add({
          ...logMessage,
          timestamp: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        });
    } catch (error) {
      console.error('Error writing log to Firestore:', error);
    }
  }

  // Implement all the same methods as StreamLogger
  info(message: string, data?: LogData): Promise<void> {
    return this.log('info', message, data);
  }

  success(message: string, data?: LogData): Promise<void> {
    return this.log('success', message, data);
  }

  // ... other methods similar to StreamLogger

  async end(message?: string): Promise<void> {
    if (message) {
      await this.success(message);
    }
    
    // Update project status to complete
    await this.updateProjectStatus('complete');
  }

  async error(message: string, data?: LogData): Promise<void> {
    await this.log('error', message, data);
    await this.updateProjectStatus('error');
  }

  private async updateProjectStatus(status: 'pending' | 'running' | 'complete' | 'error'): Promise<void> {
    try {
      await this.firestore
        .doc(`projects/${this.projectId}/metadata/status`)
        .set({ 
          status,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
      console.error('Error updating project status:', error);
    }
  }

  async saveResult(result: any): Promise<void> {
    try {
      await this.firestore
        .doc(`projects/${this.projectId}/result/data`)
        .set(result, { merge: true });
    } catch (error) {
      console.error('Error saving result to Firestore:', error);
    }
  }
}
```

### 3. Update Firebase Project Storage Service

```typescript
// src/services/firebase-project-storage.ts

import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { ConversationMessage } from '../types/api';
import { ProjectEntry, StorageProvider } from './project-storage-service';

export class FirestoreStorageProvider implements StorageProvider {
  private firestore: Firestore;
  
  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }
  
  async saveProject(project: ProjectEntry): Promise<void> {
    const projectRef = this.firestore.doc(`projects/${project.id}`);
    
    await projectRef.set({
      id: project.id,
      directory: project.directory,
      createdAt: project.createdAt,
      lastAccessedAt: new Date(),
      // Don't store conversation history at root level
    });
    
    // Store conversation history in subcollection
    if (project.conversationHistory?.length) {
      const batch = this.firestore.batch();
      
      // Delete existing conversation history
      const existingConversations = await projectRef.collection('conversations').get();
      existingConversations.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Add new conversation history
      project.conversationHistory.forEach((message, index) => {
        const docRef = projectRef.collection('conversations').doc(`msg_${index}`);
        batch.set(docRef, {
          ...message,
          timestamp: message.timestamp
        });
      });
      
      await batch.commit();
    }
  }
  
  // Implement other StorageProvider methods
  async getProject(projectId: string): Promise<ProjectEntry | null> {
    const projectDoc = await this.firestore.doc(`projects/${projectId}`).get();
    
    if (!projectDoc.exists) return null;
    
    const project = projectDoc.data() as Partial<ProjectEntry>;
    
    // Get conversation history from subcollection
    const conversationsSnapshot = await projectDoc.ref.collection('conversations')
      .orderBy('timestamp')
      .get();
      
    const conversationHistory: ConversationMessage[] = conversationsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        role: data.role,
        content: data.content,
        timestamp: data.timestamp.toDate(),
        isFollowUp: data.isFollowUp
      };
    });
    
    return {
      ...project,
      createdAt: project.createdAt instanceof Date ? project.createdAt : new Date(project.createdAt as any),
      lastAccessedAt: project.lastAccessedAt instanceof Date ? project.lastAccessedAt : new Date(project.lastAccessedAt as any),
      conversationHistory,
    } as ProjectEntry;
  }
  
  // Implement getAllProjects and deleteProject methods
}
```

### 4. Modify Express Endpoint

```typescript
// In src/index.ts - main /generate endpoint

app.post('/generate', async (req: express.Request, res: express.Response) => {
  // Extract request data
  const { prompt: newPrompt, projectId, ...otherParams } = req.body;
  
  // Create a new project ID if not provided
  const responseProjectId = projectId || uuidv4();
  
  // Initialize Firestore logger
  const firestoreLogger = new FirestoreLogger(
    firestoreDb,
    responseProjectId,
    true,
    'Generate'
  );
  
  try {
    await firestoreLogger.info('Starting new code generation request');
    
    // Run the generation process using the Firestore logger
    const result = await generateProjectCode(
      newPrompt,
      projectDir,
      firestoreLogger,
      // Other parameters
    );
    
    // Save the final result
    await firestoreLogger.saveResult(result);
    
    // Mark as complete
    await firestoreLogger.end('Code generation completed successfully');
    
    // Return just the project ID to the client
    return res.status(200).json({ 
      projectId: responseProjectId,
      status: 'processing'
    });
  } catch (error) {
    await firestoreLogger.error('Error in code generation', { 
      errorMessage: error instanceof Error ? error.message : String(error) 
    });
    
    return res.status(500).json({ 
      projectId: responseProjectId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
```

### 5. Create Client-Side Implementation

#### Firebase Client Setup

```typescript
// client/src/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
```

#### Project Logs Hook

```typescript
// client/src/hooks/useProjectLogs.ts
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

export type LogMessage = {
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  message: string;
  timestamp: Date;
  data?: any;
};

export type ProjectStatus = 'pending' | 'running' | 'complete' | 'error';

export function useProjectLogs(projectId: string) {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [status, setStatus] = useState<ProjectStatus>('pending');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    setLoading(true);
    
    // Subscribe to status updates
    const statusUnsubscribe = onSnapshot(
      doc(db, `projects/${projectId}/metadata/status`),
      (snapshot) => {
        if (snapshot.exists()) {
          setStatus(snapshot.data().status);
        }
      },
      (err) => {
        setError(`Error fetching status: ${err.message}`);
      }
    );
    
    // Subscribe to logs collection
    const logsQuery = query(
      collection(db, `projects/${projectId}/logs`),
      orderBy('timestamp', 'asc')
    );
    
    const logsUnsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const newLogs: LogMessage[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            level: data.level,
            message: data.message,
            timestamp: data.timestamp?.toDate() || new Date(),
            data: data.data
          };
        });
        
        setLogs(newLogs);
        setLoading(false);
      },
      (err) => {
        setError(`Error fetching logs: ${err.message}`);
        setLoading(false);
      }
    );
    
    // Subscribe to result
    const resultUnsubscribe = onSnapshot(
      doc(db, `projects/${projectId}/result/data`),
      (snapshot) => {
        if (snapshot.exists()) {
          setResult(snapshot.data());
        }
      },
      (err) => {
        setError(`Error fetching result: ${err.message}`);
      }
    );
    
    // Cleanup subscriptions
    return () => {
      statusUnsubscribe();
      logsUnsubscribe();
      resultUnsubscribe();
    };
  }, [projectId]);

  return { logs, status, result, loading, error };
}
```

#### ProjectLogs Component

```tsx
// client/src/components/ProjectLogs.tsx
import React from 'react';
import { useProjectLogs } from '../hooks/useProjectLogs';

interface ProjectLogsProps {
  projectId: string;
}

export function ProjectLogs({ projectId }: ProjectLogsProps) {
  const { logs, status, result, loading, error } = useProjectLogs(projectId);

  if (loading) return <div>Loading logs...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="project-logs">
      <div className="status">
        Status: <span className={`status-${status}`}>{status}</span>
      </div>
      
      <div className="logs">
        {logs.map((log, index) => (
          <div key={index} className={`log-entry log-${log.level}`}>
            <span className="timestamp">
              {log.timestamp.toLocaleTimeString()}
            </span>
            <span className="level">{log.level}</span>
            <span className="message">{log.message}</span>
            {log.data?.progress && (
              <div className="progress">
                {log.data.progress.step} of {log.data.progress.totalSteps}
              </div>
            )}
          </div>
        ))}
      </div>
      
      {status === 'complete' && result && (
        <div className="result">
          <h3>Generation Complete</h3>
          {result.deployUrl && (
            <a href={result.deployUrl} target="_blank" rel="noopener noreferrer">
              View Deployed Site
            </a>
          )}
          <pre>{JSON.stringify(result.generationSummary, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

## Migration Strategy

### Phase 1: Dual Implementation

1. Implement FirestoreLogger alongside StreamLogger
2. Add feature flag to enable Firestore logging
3. Test with both methods running simultaneously

### Phase 2: Client Migration

1. Update client applications to use Firestore listeners
2. Monitor for issues and performance
3. Keep SSE implementation as fallback

### Phase 3: Complete Transition

1. Remove SSE implementation once Firestore solution is proven
2. Finalize documentation and standards

## Technical Considerations

### Authentication and Security

- **Firebase Authentication**: Integrate for user authentication
- **Security Rules**: Implement Firestore security rules
  ```
  service cloud.firestore {
    match /databases/{database}/documents {
      match /projects/{projectId} {
        // Only authenticated users can access
        allow read: if request.auth != null;
        
        // Only the creator can modify
        allow write: if request.auth != null && 
                        (resource == null || resource.data.createdBy == request.auth.uid);
        
        // Allow read access to logs subcollection
        match /logs/{logId} {
          allow read: if request.auth != null;
        }
        
        // Allow read access to result data
        match /result/{docId} {
          allow read: if request.auth != null;
        }
      }
    }
  }
  ```

### Performance Optimization

1. **Pagination**: Implement cursor-based pagination for logs
2. **Compound Indexes**: Create indexes for frequent queries
3. **Batched Writes**: Use batched operations for multiple writes

### Cost Management

1. **Document Structure**: Optimize for fewer reads
2. **Query Patterns**: Design to minimize billable operations
3. **Caching**: Implement client-side caching where appropriate

## Testing Plan

1. **Unit Tests**:
   - Test FirestoreLogger class
   - Test Firebase storage provider

2. **Integration Tests**:
   - Test generation process with Firebase
   - Validate data consistency

3. **User Acceptance Testing**:
   - Test disconnect/reconnect scenarios
   - Validate multi-device access

## Rollback Plan

1. Keep SSE implementation untouched initially
2. Create feature flag to switch between implementations
3. Maintain compatibility with both approaches during transition

## Timeline

1. **Week 1**: Firebase project setup and core implementation
2. **Week 2**: Client-side integration and testing
3. **Week 3**: Finalize migration and documentation

## Success Criteria

1. Mobile clients can disconnect and reconnect without losing progress
2. Multiple devices can view the same generation process concurrently
3. Performance metrics (latency, reliability) match or exceed SSE implementation
4. User experience is seamless during and after migration

## Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Data Modeling Guide](https://firebase.google.com/docs/firestore/manage-data/structure-data)
- [Firebase Security Rules](https://firebase.google.com/docs/rules)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
