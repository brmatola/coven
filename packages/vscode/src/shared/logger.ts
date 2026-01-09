import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  setLevel(level: LogLevel): void;
}

class Logger implements ILogger {
  private outputChannel: vscode.OutputChannel;
  private level: LogLevel = LogLevel.INFO;

  constructor(name: string) {
    this.outputChannel = vscode.window.createOutputChannel(name);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      this.log('ERROR', message, args);
    }
  }

  private log(level: string, message: string, args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}${formattedArgs}`);
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}

// Singleton logger instance
let loggerInstance: Logger | null = null;

export function getLogger(): ILogger {
  if (!loggerInstance) {
    loggerInstance = new Logger('Coven');
  }
  return loggerInstance;
}

export function disposeLogger(): void {
  if (loggerInstance) {
    loggerInstance.dispose();
    loggerInstance = null;
  }
}
