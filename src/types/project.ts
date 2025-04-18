/**
 * Type definitions for project management operations
 */

export interface ProjectConfig {
  skipInstall?: boolean;
}

export interface DependencyOptions {
  dev?: boolean;
  skipFailure?: boolean;
} 