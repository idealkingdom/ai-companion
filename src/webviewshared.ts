// get the webview content from the chatbox files
import * as fs from 'fs';
import * as path from 'path';
import { Webview } from 'vscode';
import { ExtensionContext } from 'vscode';
import { Uri } from 'vscode';
const WEBVIEW_FOLDER = 'webview';
/**
 * Generates the HTML content for a webview based on the provided view type.
 * It reads the HTML file, replaces placeholders with actual script and style paths,
 * and returns the final HTML content.
 *
 * @param webview - The webview instance to generate content for.
 * @param context - The extension context to access resources.
 * @param viewType - The type of view (e.g., 'chatbox').
 * @returns The HTML content as a string.
 */
export function getHTMLBase(webview: Webview, context: ExtensionContext, viewType: string, htmlName: string, ): string {
        
       const htmlPath = path.join(context.extensionPath, WEBVIEW_FOLDER, viewType, htmlName);

       return fs.readFileSync(htmlPath, 'utf8');
}

export function fetchFilesWebView(webview: Webview,
                                 context: ExtensionContext, 
                                viewType: string,
                                htmlBase: string, 
                                placeholder: string , 
                                libraryName: string): string
                                 {

                let htmlContent = htmlBase;
                // replace the placeholder with the library name
                const libraryPath = Uri.joinPath(context.extensionUri, WEBVIEW_FOLDER, viewType, libraryName);
                htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), webview.asWebviewUri(libraryPath).toString());

                return htmlContent;
}