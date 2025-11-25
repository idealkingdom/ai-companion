import * as vscode from 'vscode';

export class ImageStorageService {
    private storageUri: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        // Use the specific storage folder for this extension
        this.storageUri = context.globalStorageUri; 
        this.init();
    }

    private async init() {
        // Create the directory if it doesn't exist
        try {
            await vscode.workspace.fs.createDirectory(this.storageUri);
            console.log("📂 Image Storage Path:", this.storageUri.fsPath);
        } catch (e) {
            // Ignore error if folder already exists
        }
    }

    /**
     * Saves a Base64 image string to disk and returns the filename
     */
    public async saveImage(base64Data: string): Promise<string> {
        // 1. Parse the header (e.g., "data:image/png;base64,")
        const matches = base64Data.match(/^data:image\/([a-z]+);base64,(.+)$/);
        
        const ext = matches ? matches[1] : 'png'; 
        const rawData = matches ? matches[2] : base64Data;

        // 2. Generate unique filename
        const fileName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const fileUri = vscode.Uri.joinPath(this.storageUri, fileName);

        // 3. Write to disk
        const buffer = Buffer.from(rawData, 'base64');
        await vscode.workspace.fs.writeFile(fileUri, buffer);

        return fileName; // We only store "img_123.png" in the database
    }

    /**
     * Converts a stored filename into a VS Code Webview URI 
     * (Required to display the image in the chat window later)
     */
    public getWebviewUri(fileName: string, webview: vscode.Webview): string {
        const diskPath = vscode.Uri.joinPath(this.storageUri, fileName);
        return webview.asWebviewUri(diskPath).toString();
    }
}