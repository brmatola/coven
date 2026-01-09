import { Task } from '../shared/types';

/**
 * Context about the codebase and conventions.
 */
export interface CodebaseContext {
  /** Project name */
  projectName?: string;
  /** Key directories */
  directories?: string[];
  /** File conventions */
  conventions?: string[];
  /** Testing framework info */
  testingInfo?: string;
}

/**
 * Options for generating task prompts.
 */
export interface TaskPromptOptions {
  /** The task to work on */
  task: Task;
  /** Feature branch context */
  featureBranch: string;
  /** Codebase context */
  codebase?: CodebaseContext;
  /** Whether to allow asking questions */
  allowQuestions?: boolean;
  /** Maximum files to change (soft limit) */
  maxFilesHint?: number;
}

/**
 * Generate the base task execution prompt.
 */
export function generateTaskPrompt(options: TaskPromptOptions): string {
  const { task, featureBranch, codebase, allowQuestions = true } = options;

  const sections: string[] = [];

  // Task header
  sections.push(`# Task: ${task.title}`);
  sections.push('');

  // Description
  sections.push('## Description');
  sections.push(task.description || 'No description provided.');
  sections.push('');

  // Acceptance criteria from tags if present
  const acceptanceTags = (task.tags ?? []).filter((t) => t.startsWith('ac:'));
  if (acceptanceTags.length > 0) {
    sections.push('## Acceptance Criteria');
    for (const tag of acceptanceTags) {
      sections.push(`- ${tag.substring(3)}`);
    }
    sections.push('');
  }

  // Context
  if (codebase) {
    sections.push('## Codebase Context');
    if (codebase.projectName) {
      sections.push(`Project: ${codebase.projectName}`);
    }
    if (codebase.directories && codebase.directories.length > 0) {
      sections.push(`Key directories: ${codebase.directories.join(', ')}`);
    }
    if (codebase.conventions && codebase.conventions.length > 0) {
      sections.push('Conventions:');
      for (const conv of codebase.conventions) {
        sections.push(`- ${conv}`);
      }
    }
    if (codebase.testingInfo) {
      sections.push(`Testing: ${codebase.testingInfo}`);
    }
    sections.push('');
  }

  // Branch context
  sections.push('## Branch Context');
  sections.push(`Working on feature branch: ${featureBranch}`);
  sections.push('Make atomic commits with clear messages.');
  sections.push('');

  // Instructions
  sections.push('## Instructions');
  sections.push('1. Understand the task requirements fully before starting');
  sections.push('2. Make focused changes that address the task');
  sections.push('3. Include appropriate tests for new functionality');
  sections.push('4. Ensure all existing tests pass');
  sections.push('5. Keep changes minimal and avoid scope creep');
  sections.push('');

  // Question policy
  if (allowQuestions) {
    sections.push('## Questions');
    sections.push(
      'If you need clarification or encounter blockers, ask questions. ' +
        'Prefer to ask rather than make assumptions about unclear requirements.'
    );
    sections.push('');
  }

  // Completion
  sections.push('## Completion');
  sections.push(
    'When the task is complete, provide a summary of changes made ' +
      'and confirm all acceptance criteria are met.'
  );

  return sections.join('\n');
}

/**
 * Generate a minimal prompt for simple tasks (e2e testing, etc).
 */
export function generateSimpleTaskPrompt(
  title: string,
  description: string,
  workingDir: string
): string {
  return [
    `# Task: ${title}`,
    '',
    description,
    '',
    `Working directory: ${workingDir}`,
    '',
    'Complete this task and confirm when done.',
  ].join('\n');
}

/**
 * Generate a conflict resolution prompt.
 */
export function generateConflictResolutionPrompt(
  conflictFiles: string[],
  taskBranch: string,
  featureBranch: string
): string {
  return [
    '# Merge Conflict Resolution',
    '',
    `Merging ${taskBranch} into ${featureBranch} has conflicts.`,
    '',
    '## Conflicting Files',
    ...conflictFiles.map((f) => `- ${f}`),
    '',
    '## Instructions',
    '1. Review each conflict carefully',
    '2. Preserve functionality from both branches where possible',
    '3. Prefer the task branch changes for new features',
    '4. Ensure tests pass after resolution',
    '',
    'Resolve all conflicts and confirm when complete.',
  ].join('\n');
}

/**
 * Generate a prompt for the auto-accept flow (no questions allowed).
 * Used for automated testing where we want the agent to proceed without interaction.
 */
export function generateAutoAcceptPrompt(
  title: string,
  description: string,
  workingDir: string
): string {
  return [
    `# Task: ${title}`,
    '',
    description,
    '',
    `Working directory: ${workingDir}`,
    '',
    '## Auto-Accept Mode',
    'This task is running in auto-accept mode. Do not ask questions.',
    'Make reasonable decisions and proceed with the implementation.',
    'If something is truly unclear, document your assumptions in comments.',
    '',
    'Complete this task without user interaction.',
  ].join('\n');
}
