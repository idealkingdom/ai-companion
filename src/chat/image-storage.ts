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
     * Deletes an image file from disk to free up space.
     */
    public async deleteImage(fileName: string): Promise<void> {
        try {
            const fileUri = vscode.Uri.joinPath(this.storageUri, fileName);
            // useTrash: false means permanent delete (it's just a temp cache anyway)
            await vscode.workspace.fs.delete(fileUri, { useTrash: false });
            console.log(`🗑️ Deleted image: ${fileName}`);
        } catch (e) {
            // If file doesn't exist (already deleted), just ignore it
            console.warn(`Could not delete ${fileName}, it might not exist.`);
        }
    }


    /**
     * Converts a stored filename into a VS Code Webview URI 
     * (Required to display the image in the chat window later)
     */
    public getWebviewUri(fileName: string, webview: vscode.Webview): string {
        const diskPath = vscode.Uri.joinPath(this.storageUri, fileName);
        return webview.asWebviewUri(diskPath).toString();
    }

    /**
     * Get the absolute path URI of an image file
     */
    public getImagePath(fileName: string): vscode.Uri {
        return vscode.Uri.joinPath(this.storageUri, fileName);
    }
}