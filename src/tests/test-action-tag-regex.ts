/**
 * Tests for action tag replacement regex
 * 
 * This file tests both the old and new regex patterns used for replacing action tags
 * to determine which one correctly handles complex action content.
 */

import { logSuccess, logError, logInfo, createHeader } from '../utils/logging';

/**
 * Original regex pattern from Claude client
 * 
 * @param content Text with action tags
 * @returns Filtered text with action tags replaced by placeholders
 */
function filterWithOriginalRegex(content: string): string {
  return content.replace(
    /<action type="(CREATE|EDIT|DELETE)"([^>]*)>[\s\S]*?<\/action>/g,
    (match, actionType, attributes) => {
      // Extract the path if it exists
      const pathMatch = attributes.match(/path="([^"]+)"/);
      const path = pathMatch ? pathMatch[1] : '[unknown path]';
      
      return `<action_placeholder type="${actionType}" path="${path}">[Code content omitted to optimize token usage]</action_placeholder>`;
    }
  );
}

/**
 * Modified regex pattern with explicit capture group
 * 
 * @param content Text with action tags
 * @returns Filtered text with action tags replaced by placeholders
 */
function filterWithModifiedRegex(content: string): string {
  return content.replace(
    /<action type="(CREATE|EDIT|DELETE)"([^>]*)>([\s\S]*?)<\/action>/g,
    (match, actionType, attributes) => {
      // Extract the path if it exists
      const pathMatch = attributes.match(/path="([^"]+)"/);
      const path = pathMatch ? pathMatch[1] : '[unknown path]';
      
      return `<action_placeholder type="${actionType}" path="${path}">[Code content omitted to optimize token usage]</action_placeholder>`;
    }
  );
}

/**
 * Test case definition
 */
interface TestCase {
  name: string;
  input: string;
  expectedTagCount: number;
}

/**
 * Run a test case with both regex patterns
 * 
 * @param testCase The test case to run
 * @returns Whether both regex patterns passed
 */
function runTestCase(testCase: TestCase): { originalPassed: boolean; modifiedPassed: boolean } {
  logInfo(`Running test: ${testCase.name}`);
  
  // Test original regex
  const originalResult = filterWithOriginalRegex(testCase.input);
  const originalTagCount = (originalResult.match(/<action_placeholder/g) || []).length;
  const originalPassed = originalTagCount === testCase.expectedTagCount;
  
  // Test modified regex
  const modifiedResult = filterWithModifiedRegex(testCase.input);
  const modifiedTagCount = (modifiedResult.match(/<action_placeholder/g) || []).length;
  const modifiedPassed = modifiedTagCount === testCase.expectedTagCount;
  
  // Log results
  logInfo(`  Original regex: ${originalPassed ? 'PASSED' : 'FAILED'} (found ${originalTagCount} tags, expected ${testCase.expectedTagCount})`);
  logInfo(`  Modified regex: ${modifiedPassed ? 'PASSED' : 'FAILED'} (found ${modifiedTagCount} tags, expected ${testCase.expectedTagCount})`);
  
  return { originalPassed, modifiedPassed };
}

/**
 * Test action tag regex replacement
 * 
 * @returns Test result statistics
 */
async function testActionTagRegex(): Promise<{ passed: number; failed: number }> {
  logInfo(createHeader('ACTION TAG REGEX TESTS'));
  
  // Test counters
  let passedOriginal = 0;
  let failedOriginal = 0;
  let passedModified = 0;
  let failedModified = 0;
  
  // Define test cases
  const testCases: TestCase[] = [
    {
      name: 'Simple action tags',
      input: '<action type="CREATE" path="file1.ts">Some code</action><action type="EDIT" path="file2.ts">More code</action>',
      expectedTagCount: 2
    },
    {
      name: 'Action tags with text between',
      input: '<action type="CREATE" path="file1.ts">Some code</action>Text in between<action type="EDIT" path="file2.ts">More code</action>',
      expectedTagCount: 2
    },
    {
      name: 'Nested action tags',
      input: '<action type="CREATE" path="outer.ts">Outer <action type="EDIT" path="inner.ts">Inner</action> Rest</action>',
      expectedTagCount: 1 // Original regex won't handle nested tags correctly
    },
    {
      name: 'Very large action content',
      input: `<action type="CREATE" path="large.ts">${'A'.repeat(10000)}</action>`,
      expectedTagCount: 1
    },
    {
      name: 'Action with special characters in content',
      input: '<action type="CREATE" path="special.ts">function() { return "</action>"; }</action>',
      expectedTagCount: 1
    },
    {
      name: 'Multiple action types',
      input: `
        <action type="TEXT">Some text</action>
        <action type="CREATE" path="file1.ts">Code here</action>
        <action type="COMMAND">npm install</action>
        <action type="EDIT" path="file2.ts">More code</action>
      `,
      expectedTagCount: 2 // Only CREATE and EDIT should be replaced
    },
    {
      name: 'Real-world complex example',
      input: `<action type="TEXT">
I'll create a mobile-first, responsive To-Do app that feels like a native mobile application.
</action>

<action type="COMMAND">
npx shadcn@latest add --yes --overwrite button card checkbox dialog
</action>

<action type="CREATE" path="components/ui/task-card.tsx">
'use client';

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface TaskCardProps {
  id: string;
  title: string;
  description?: string;
  dueDate?: Date;
  priority: 'low' | 'medium' | 'high';
  category: string;
  completed: boolean;
  onStatusChange: (id: string, completed: boolean) => void;
  onClick: () => void;
}

export function TaskCard({ 
  id, 
  title, 
  description, 
  dueDate, 
  priority, 
  category,
  completed,
  onStatusChange,
  onClick
}: TaskCardProps) {
  const [isChecked, setIsChecked] = useState(completed);
  
  const priorityColors = {
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
  };

  const handleCheckboxChange = (checked: boolean) => {
    setIsChecked(checked);
    onStatusChange(id, checked);
  };

  return (
    <Card 
      className={\`w-full transition-all duration-200 \${isChecked ? 'opacity-60' : 'opacity-100'} hover:shadow-md active:scale-98\`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div className="flex items-start gap-2">
            <Checkbox 
              id={\`task-\${id}\`} 
              checked={isChecked}
              onCheckedChange={handleCheckboxChange}
              onClick={(e) => e.stopPropagation()}
              className="mt-1"
            />
            <div>
              <CardTitle className={\`text-lg \${isChecked ? 'line-through text-muted-foreground' : ''}\`}>
                {title}
              </CardTitle>
              {description && (
                <CardDescription className="mt-1 line-clamp-2">
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardFooter className="pt-2 flex justify-between items-center">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{category}</Badge>
          <Badge className={priorityColors[priority]}>
            {priority.charAt(0).toUpperCase() + priority.slice(1)}
          </Badge>
        </div>
        {dueDate && (
          <span className="text-xs text-muted-foreground">
            {formatDate(dueDate)}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
</action>

<action type="EDIT" path="app/page.tsx">
'use client';

import { useState, useEffect } from "react";
import { TaskList } from "@/components/task-list";
import { MobileNav } from "@/components/mobile-nav";
import { Task, Category } from "@/types";
import { loadTasks, saveTasks, loadCategories, saveCategories } from "@/lib/data";
import { useSearchParams } from "next/navigation";

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const searchParams = useSearchParams();
  const categoryFilter = searchParams?.get('category');

  // Load tasks and categories from localStorage on component mount
  useEffect(() => {
    const savedTasks = loadTasks();
    const savedCategories = loadCategories();
    
    setTasks(savedTasks);
    setCategories(savedCategories);

    // Initialize theme based on user preference or system setting
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      
      if (savedTheme === 'dark' || 
          (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, []);
  
  // Filter tasks by category if categoryFilter is set
  const filteredTasks = categoryFilter 
    ? tasks.filter(task => task.category === categoryFilter)
    : tasks;

  // Add a new category
  const handleAddCategory = (category: Category) => {
    const updatedCategories = [...categories, category];
    setCategories(updatedCategories);
    saveCategories(updatedCategories);
  };

  return (
    <div className="min-h-screen pb-16">
      <TaskList 
        initialTasks={filteredTasks} 
        categories={categories} 
      />
      
      <MobileNav 
        categories={categories}
        onAddCategory={handleAddCategory}
      />
    </div>
  );
}
</action>`,
      expectedTagCount: 2
    }
  ];
  
  // Run all test cases
  for (const testCase of testCases) {
    const { originalPassed, modifiedPassed } = runTestCase(testCase);
    
    if (originalPassed) {
      passedOriginal++;
    } else {
      failedOriginal++;
    }
    
    if (modifiedPassed) {
      passedModified++;
    } else {
      failedModified++;
    }
  }
  
  // Log summary
  logInfo(createHeader('ACTION TAG REGEX TEST SUMMARY'));
  logInfo(`Original regex: ${passedOriginal} passed, ${failedOriginal} failed`);
  logInfo(`Modified regex: ${passedModified} passed, ${failedModified} failed`);
  
  if (failedOriginal === 0) {
    logSuccess('Original regex passed all tests!');
  } else {
    logError(`Original regex failed ${failedOriginal} tests`);
  }
  
  if (failedModified === 0) {
    logSuccess('Modified regex passed all tests!');
  } else {
    logError(`Modified regex failed ${failedModified} tests`);
  }
  
  // Return overall test results
  return {
    passed: Math.min(passedOriginal, passedModified),
    failed: Math.max(failedOriginal, failedModified)
  };
}

/**
 * Run action tag regex tests
 * This function is called by the test runner
 */
export async function runTests(): Promise<void> {
  const result = await testActionTagRegex();
  
  if (result.failed === 0) {
    logSuccess('All action tag regex tests passed!');
  } else {
    logError(`${result.failed} action tag regex tests failed!`);
  }
}
