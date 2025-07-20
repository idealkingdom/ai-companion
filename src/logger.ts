import * as vscode from 'vscode';
import { EXTENSION_NAME } from './constants';


const outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);


// MODIFIED THE output channel to accept multiple arguments, too lazy to append informations.


// Save the original appendLine method
const originalAppendLine = outputChannel.appendLine.bind(outputChannel);

// Extend the OutputChannel type to support variadic arguments
interface ExtendedOutputChannel extends vscode.OutputChannel {
  appendLine(...args: any[]): void;
}

// Override appendLine for console.log-like behavior
const extendedOutputChannel: ExtendedOutputChannel = {
  ...outputChannel,
  appendLine: (...args: any[]) => {
    const message = args.map(String).join(' ');
    originalAppendLine(message);
  },
};

// Export the extended output channel
export { extendedOutputChannel as outputChannel };