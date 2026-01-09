import * as vscode from 'vscode';
import { FamiliarManager } from './FamiliarManager';
import { AgentOrchestrator } from './AgentOrchestrator';
import { PendingQuestion } from '../shared/types';

/**
 * Handles agent questions by presenting UI for user response.
 * Supports suggested responses via quick pick and custom text input.
 */
export class QuestionHandler {
  constructor(
    private familiarManager: FamiliarManager,
    private orchestrator: AgentOrchestrator
  ) {}

  /**
   * Show a response UI for a pending question and send the response to the agent.
   */
  async handleQuestion(question: PendingQuestion): Promise<boolean> {
    const response = await this.promptForResponse(question);

    if (response === undefined) {
      // User cancelled
      return false;
    }

    // Send response to agent via orchestrator
    try {
      await this.orchestrator.respondToQuestion(question.taskId, response);
      // Mark question as answered in familiar manager
      this.familiarManager.answerQuestion(question.familiarId);
      return true;
    } catch (error) {
      await vscode.window.showErrorMessage(
        `Failed to send response: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Show a response UI for a question by task ID.
   */
  async handleQuestionByTaskId(taskId: string): Promise<boolean> {
    const question = this.familiarManager.getQuestion(taskId);
    if (!question) {
      await vscode.window.showWarningMessage('No pending question for this task');
      return false;
    }
    return this.handleQuestion(question);
  }

  /**
   * Prompt user for a response using quick pick or input box.
   */
  private async promptForResponse(question: PendingQuestion): Promise<string | undefined> {
    // If question has suggested options, show quick pick
    if (question.options && question.options.length > 0) {
      return this.showQuickPickResponse(question);
    }

    // Otherwise, show input box for free-form response
    return this.showInputResponse(question);
  }

  /**
   * Show quick pick with suggested responses plus custom input option.
   */
  private async showQuickPickResponse(question: PendingQuestion): Promise<string | undefined> {
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
      placeHolder: question.question,
      ignoreFocusOut: true,
    });

    if (!result) {
      return undefined;
    }

    // If custom response selected, show input box
    if (result.label === '$(edit) Custom response...') {
      return this.showInputResponse(question);
    }

    return result.label;
  }

  /**
   * Show input box for free-form response.
   */
  private async showInputResponse(question: PendingQuestion): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: 'Agent Question',
      prompt: question.question,
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
