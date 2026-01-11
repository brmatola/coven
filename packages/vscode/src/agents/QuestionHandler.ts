import * as vscode from 'vscode';
import { DaemonClient } from '../daemon/client';
import { SSEClient } from '@coven/client-ts';
import type { SSEEvent, Question } from '@coven/client-ts';

/**
 * SSE event data for questions asked
 */
interface QuestionsAskedData {
  question_id: string;
  task_id: string;
  agent_id: string;
  question: string;
  options?: string[];
}

/**
 * SSE event data for questions answered
 */
interface QuestionsAnsweredData {
  question_id: string;
}

/**
 * Callback for badge updates
 */
export type BadgeUpdateCallback = (count: number) => void;

/**
 * Handles agent questions by presenting UI for user response.
 * Receives questions via SSE events and submits answers via daemon API.
 */
export class QuestionHandler {
  private pendingQuestions: Map<string, Question> = new Map();
  private eventHandler: ((event: SSEEvent) => void) | null = null;
  private onBadgeUpdate: BadgeUpdateCallback | null = null;

  constructor(
    private client: DaemonClient,
    private sseClient: SSEClient
  ) {}

  /**
   * Initialize the question handler.
   * Subscribes to SSE events.
   */
  initialize(): void {
    this.subscribeToEvents();
  }

  /**
   * Set the callback for badge count updates.
   */
  setBadgeUpdateCallback(callback: BadgeUpdateCallback): void {
    this.onBadgeUpdate = callback;
  }

  /**
   * Get all pending questions.
   */
  getPendingQuestions(): Question[] {
    return Array.from(this.pendingQuestions.values());
  }

  /**
   * Get the count of pending questions.
   */
  getPendingCount(): number {
    return this.pendingQuestions.size;
  }

  /**
   * Check if there's a pending question for a task.
   */
  hasQuestion(taskId: string): boolean {
    for (const question of this.pendingQuestions.values()) {
      if (question.task_id === taskId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get a pending question by ID.
   */
  getQuestion(questionId: string): Question | undefined {
    return this.pendingQuestions.get(questionId);
  }

  /**
   * Get a pending question by task ID.
   */
  getQuestionByTaskId(taskId: string): Question | undefined {
    for (const question of this.pendingQuestions.values()) {
      if (question.task_id === taskId) {
        return question;
      }
    }
    return undefined;
  }

  /**
   * Show the answer dialog for a question.
   */
  async showAnswerDialog(questionId: string): Promise<boolean> {
    const question = this.pendingQuestions.get(questionId);
    if (!question) {
      await vscode.window.showWarningMessage('Question not found or already answered');
      return false;
    }

    const answer = await this.promptForAnswer(question);
    if (answer === undefined) {
      // User cancelled
      return false;
    }

    return this.submitAnswer(questionId, answer);
  }

  /**
   * Show the answer dialog for a question by task ID.
   */
  async showAnswerDialogByTaskId(taskId: string): Promise<boolean> {
    const question = this.getQuestionByTaskId(taskId);
    if (!question) {
      await vscode.window.showWarningMessage('No pending question for this task');
      return false;
    }

    return this.showAnswerDialog(question.id);
  }

  /**
   * Submit an answer for a question.
   */
  async submitAnswer(questionId: string, answer: string): Promise<boolean> {
    try {
      await this.client.answerQuestion(questionId, answer);
      this.pendingQuestions.delete(questionId);
      this.updateBadge();
      return true;
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to send answer: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    if (this.eventHandler) {
      this.sseClient.off('event', this.eventHandler);
      this.eventHandler = null;
    }
    this.pendingQuestions.clear();
    this.onBadgeUpdate = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private subscribeToEvents(): void {
    this.eventHandler = (event: SSEEvent): void => {
      switch (event.type) {
        case 'questions.asked':
          void this.handleQuestionAsked(event.data as QuestionsAskedData);
          break;
        case 'questions.answered':
          this.handleQuestionAnswered(event.data as QuestionsAnsweredData);
          break;
      }
    };

    this.sseClient.on('event', this.eventHandler);
  }

  private async handleQuestionAsked(data: QuestionsAskedData): Promise<void> {
    const question: Question = {
      id: data.question_id,
      task_id: data.task_id,
      agent_id: data.agent_id,
      text: data.question,
      type: 'text', // Default type
      options: data.options,
      asked_at: new Date().toISOString(),
    };

    this.pendingQuestions.set(question.id, question);
    this.updateBadge();

    // Show notification with question preview
    const preview =
      question.text.length > 50 ? question.text.slice(0, 50) + '...' : question.text;

    const action = await vscode.window.showInformationMessage(
      `Agent question: ${preview}`,
      'Answer'
    );

    if (action === 'Answer') {
      await this.showAnswerDialog(question.id);
    }
  }

  private handleQuestionAnswered(data: QuestionsAnsweredData): void {
    this.pendingQuestions.delete(data.question_id);
    this.updateBadge();
  }

  private updateBadge(): void {
    if (this.onBadgeUpdate) {
      this.onBadgeUpdate(this.pendingQuestions.size);
    }
  }

  private async promptForAnswer(question: Question): Promise<string | undefined> {
    // If question has options, show quick pick
    if (question.options && question.options.length > 0) {
      return this.showQuickPickAnswer(question);
    }

    // Otherwise, show input box for free-form answer
    return this.showInputAnswer(question);
  }

  private async showQuickPickAnswer(question: Question): Promise<string | undefined> {
    const items: vscode.QuickPickItem[] = (question.options || []).map((option) => ({
      label: option,
      description: '',
    }));

    // Add custom input option
    items.push({
      label: '$(edit) Custom response...',
      description: 'Type a custom response',
      alwaysShow: true,
    });

    const result = await vscode.window.showQuickPick(items, {
      title: 'Agent Question',
      placeHolder: question.text,
      ignoreFocusOut: true,
    });

    if (!result) {
      return undefined;
    }

    // If custom response selected, show input box
    if (result.label === '$(edit) Custom response...') {
      return this.showInputAnswer(question);
    }

    return result.label;
  }

  private async showInputAnswer(question: Question): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: 'Agent Question',
      prompt: question.text,
      placeHolder: 'Type your response...',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'Response cannot be empty';
        }
        return undefined;
      },
    });
  }
}
