# Real-Time Code Streaming Implementation Guide

## Firebase Data Structure

Each code file is stored as a separate document in a subcollection:

```
projects/{projectId}/codefiles/{fileId}
```

Document structure:
```typescript
{
  path: string;           // File path (e.g. "app/home/page.tsx")
  content: string;        // File content that updates in real-time
  language: string;       // Language for syntax highlighting (e.g. "tsx", "css")
  status: "streaming" | "complete"; // Indicates if still receiving updates
  operation: "create" | "edit"; // Whether creating new or editing existing
  timestamp: string;      // ISO timestamp
  createdAt: Timestamp;   // Firebase server timestamp
  updatedAt: Timestamp;   // Firebase server timestamp (updates with each change)
}
```

## Backend Implementation

The system tracks code files through three phases:

1. **Initialization**: When the LLM starts generating a file
   ```typescript
   // In ResponseProcessor when <action type="CREATE" path="..."> or <action type="EDIT" path="..."> is detected
   firestoreLogger.startCodeTracking(path, 'create'); // or 'edit'
   ```

2. **Streaming Updates**: As code chunks arrive from the LLM
   ```typescript
   // For each chunk received from Claude
   firestoreLogger.updateCodeContent(path, updatedContent);
   ```

3. **Completion**: When the file generation is finished
   ```typescript
   // When </action> tag is detected
   firestoreLogger.completeCodeTracking(path, finalContent);
   ```

## Next.js Client Implementation

### 1. Set Up Firebase Client

```typescript
// firebase/clientApp.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  // Your Firebase config
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
```

### 2. Create a Code Streaming Hook

```typescript
// hooks/useCodeFiles.ts
import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../firebase/clientApp';

interface CodeFile {
  id: string;
  path: string;
  content: string;
  language: string;
  status: 'streaming' | 'complete';
  operation: 'create' | 'edit';
  timestamp: string;
}

export function useCodeFiles(projectId: string) {
  const [codeFiles, setCodeFiles] = useState<CodeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!projectId) return;

    setLoading(true);
    
    // Create query for the codefiles subcollection
    const codeFilesRef = collection(db, `projects/${projectId}/codefiles`);
    const codeFilesQuery = query(codeFilesRef, orderBy('timestamp', 'desc'));
    
    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(
      codeFilesQuery,
      (snapshot) => {
        const files: CodeFile[] = [];
        
        snapshot.forEach((doc) => {
          files.push({
            id: doc.id,
            ...doc.data(),
          } as CodeFile);
        });
        
        setCodeFiles(files);
        setLoading(false);
      },
      (err) => {
        console.error('Error getting code files:', err);
        setError(err);
        setLoading(false);
      }
    );
    
    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [projectId]);

  return { codeFiles, loading, error };
}
```

### 3. Add Syntax Highlighting Component

```typescript
// components/CodeEditor.tsx
import React, { useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
// Import other language components as needed

interface CodeEditorProps {
  code: string;
  language: string;
  status: 'streaming' | 'complete';
}

export default function CodeEditor({ code, language, status }: CodeEditorProps) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Highlight the code whenever it changes
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code]);

  // Map our language names to Prism's language classes
  const getPrismLanguage = (lang: string) => {
    const languageMap: Record<string, string> = {
      'tsx': 'tsx',
      'jsx': 'jsx',
      'typescript': 'typescript',
      'javascript': 'javascript',
      'css': 'css',
      'json': 'json',
      // Add other mappings as needed
    };
    
    return languageMap[lang] || 'javascript'; // Default to JavaScript
  };

  return (
    <div className="code-editor">
      <div className="code-header">
        <span className="file-name">{path}</span>
        {status === 'streaming' && <span className="streaming-badge">Streaming</span>}
      </div>
      <pre className={`language-${getPrismLanguage(language)}`}>
        <code ref={codeRef} className={`language-${getPrismLanguage(language)}`}>
          {code || '// Loading...'}
        </code>
      </pre>
    </div>
  );
}
```

### 4. Create a File Explorer Component

```typescript
// components/FileExplorer.tsx
import React, { useState } from 'react';
import { useCodeFiles } from '../hooks/useCodeFiles';

interface FileExplorerProps {
  projectId: string;
  onSelectFile: (file: any) => void;
}

export default function FileExplorer({ projectId, onSelectFile }: FileExplorerProps) {
  const { codeFiles, loading, error } = useCodeFiles(projectId);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleFileClick = (file: any) => {
    setSelectedFile(file.id);
    onSelectFile(file);
  };

  if (loading) return <div>Loading files...</div>;
  if (error) return <div>Error loading files: {error.message}</div>;

  // Group files by directories for a tree-like structure
  const filesByDirectory: Record<string, any[]> = {};
  codeFiles.forEach(file => {
    const dirPath = file.path.split('/').slice(0, -1).join('/');
    if (!filesByDirectory[dirPath]) {
      filesByDirectory[dirPath] = [];
    }
    filesByDirectory[dirPath].push(file);
  });

  return (
    <div className="file-explorer">
      <h3>Files</h3>
      <div className="file-list">
        {Object.entries(filesByDirectory).map(([dir, files]) => (
          <div key={dir} className="directory">
            <div className="directory-name">{dir || 'Root'}</div>
            <div className="directory-files">
              {files.map(file => (
                <div 
                  key={file.id}
                  className={`file-item ${selectedFile === file.id ? 'selected' : ''} ${file.status === 'streaming' ? 'streaming' : ''}`}
                  onClick={() => handleFileClick(file)}
                >
                  <span className="file-name">
                    {file.path.split('/').pop()}
                  </span>
                  {file.status === 'streaming' && <span className="streaming-indicator" />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 5. Assemble the Page Component

```typescript
// pages/project/[id].tsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import FileExplorer from '../../components/FileExplorer';
import CodeEditor from '../../components/CodeEditor';

export default function ProjectPage() {
  const router = useRouter();
  const { id: projectId } = router.query;
  const [selectedFile, setSelectedFile] = useState(null);

  if (!projectId) return <div>Loading project...</div>;

  return (
    <div className="project-container">
      <div className="sidebar">
        <FileExplorer
          projectId={projectId as string}
          onSelectFile={setSelectedFile}
        />
      </div>
      <div className="main-content">
        {selectedFile ? (
          <CodeEditor
            code={selectedFile.content}
            language={selectedFile.language}
            status={selectedFile.status}
          />
        ) : (
          <div className="no-file-selected">
            Select a file to view its content
          </div>
        )}
      </div>
    </div>
  );
}
```

## Advanced Features

### 1. Real-time Typing Animation

To create a "typing" effect as code streams in:

```typescript
// components/StreamingCodeEditor.tsx
import React, { useEffect, useRef, useState } from 'react';
import Prism from 'prismjs';

export default function StreamingCodeEditor({ file }) {
  const codeRef = useRef<HTMLElement>(null);
  const [visibleContent, setVisibleContent] = useState('');
  const previousContentRef = useRef('');

  useEffect(() => {
    if (file.status === 'streaming' && file.content !== previousContentRef.current) {
      // Calculate new content since last update
      const newContent = file.content.substring(previousContentRef.current.length);
      previousContentRef.current = file.content;
      
      // Add new content character by character with a slight delay
      let i = 0;
      const interval = setInterval(() => {
        if (i < newContent.length) {
          setVisibleContent(prev => prev + newContent[i]);
          i++;
        } else {
          clearInterval(interval);
        }
      }, 5); // Adjust timing for desired speed
    } else if (file.status === 'complete') {
      // Show all content when complete
      setVisibleContent(file.content);
      previousContentRef.current = file.content;
    }
  }, [file.content, file.status]);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [visibleContent]);

  return (
    <pre className={`language-${file.language}`}>
      <code ref={codeRef} className={`language-${file.language}`}>
        {visibleContent}
      </code>
    </pre>
  );
}
```

### 2. Adding Line Numbers and Highlighting Current Line

```css
/* styles/CodeEditor.css */
.code-container {
  position: relative;
}

.line-numbers {
  position: absolute;
  left: 0;
  top: 0;
  padding: 1rem 0.5rem;
  background: #2d2d2d;
  color: #888;
  text-align: right;
  user-select: none;
}

.code-with-line-numbers {
  margin-left: 3rem;
  overflow-x: auto;
}

.highlight-line {
  background-color: rgba(255, 255, 0, 0.1);
  display: block;
  width: 100%;
}
```

### 3. File-Specific CSS by Language

For more tailored styling based on language:

```typescript
// utils/fileUtils.ts
export function getFileIconByLanguage(language: string): string {
  const iconMap: Record<string, string> = {
    'typescript': 'ts-icon.svg',
    'javascript': 'js-icon.svg',
    'css': 'css-icon.svg',
    'jsx': 'react-icon.svg',
    'tsx': 'react-ts-icon.svg',
    // Add more mappings
  };
  
  return iconMap[language] || 'default-file-icon.svg';
}

export function getThemeByLanguage(language: string): string {
  // You could have different Prism themes for different languages
  const themeMap: Record<string, string> = {
    'typescript': 'prism-vscode-dark',
    'javascript': 'prism-vscode-dark',
    'css': 'prism-css-theme',
    // Add more mappings
  };
  
  return themeMap[language] || 'prism-tomorrow';
}
```

## Performance Optimizations

### 1. Virtualized List for Many Files

Use react-window or react-virtualized for large file lists:

```typescript
import { FixedSizeList } from 'react-window';

// Inside your FileExplorer component
const FileList = ({ files }) => {
  const Row = ({ index, style }) => (
    <div style={style} onClick={() => handleFileClick(files[index])}>
      {files[index].path}
    </div>
  );

  return (
    <FixedSizeList
      height={400}
      width={300}
      itemCount={files.length}
      itemSize={35}
    >
      {Row}
    </FixedSizeList>
  );
};
```

### 2. Memoize Components to Reduce Re-renders

```typescript
import React, { memo } from 'react';

const FileItem = memo(({ file, isSelected, onClick }) => {
  return (
    <div 
      className={`file-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {file.path}
    </div>
  );
});

// Then in your file explorer
{files.map(file => (
  <FileItem 
    key={file.id}
    file={file}
    isSelected={selectedFile === file.id}
    onClick={() => handleFileClick(file)}
  />
))}
```

### 3. Throttle Firebase Updates for Very Large Files

```typescript
import { useThrottledEffect } from 'use-throttled-effect';

function CodeFileViewer({ projectId, fileId }) {
  const [localContent, setLocalContent] = useState('');
  // Get file data from Firebase
  
  // Throttle updates to reduce render frequency for large files
  useThrottledEffect(() => {
    if (file && file.content !== localContent) {
      setLocalContent(file.content);
    }
  }, [file?.content], 100); // Update at most every 100ms
  
  return <CodeEditor code={localContent} language={file?.language} />;
}
``` 