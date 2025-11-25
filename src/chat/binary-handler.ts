import * as vscode from 'vscode';


export async function processBinaryFile(uri: vscode.Uri): Promise<string | null> {
    const fileExtension = uri.path.split('.').pop()?.toLowerCase();
    try {
        // 1. Read Raw Data (Uint8Array)
        const fileData = await vscode.workspace.fs.readFile(uri);
        
        // 2. Convert to Buffer (Required by most Node parsing libs)
        const buffer = Buffer.from(fileData);
        // 3. Switch based on type
        if (fileExtension === 'pdf') {
            // "Fakes" the browser API so pdf-parse doesn't crash
            // @ts-ignore
            if (typeof global.DOMMatrix === 'undefined') {
                 // @ts-ignore
                global.DOMMatrix = class DOMMatrix {};
            }
            // Bypass 'index.js' and require the internal lib directly
            // The main 'pdf-parse' entry point has the bug. 
            // 'pdf-parse/lib/pdf-parse.js' contains the actual logic without the bug.
            const pdfParse = require('pdf-parse/lib/pdf-parse.js');
            const data = await pdfParse(buffer);

            // TODO: Handle large PDFs better (e.g., summarize, extract key points, etc.)
            if (data.text && data.text.length > 20000) {
                return data.text.substring(0, 20000) + "\n...[Content Truncated]";
            }

            return data.text; // Returns the raw text content of the PDF
        }
        
        // (Future: Add support for .docx using 'mammoth' or similar libs)
        
        return null; // Not supported
    } catch (error) {
        console.error(`Error parsing binary file ${uri.fsPath}:`, error);
        throw new Error("Failed to extract text from binary file.");
    }
}

/**
 * Reads an image and returns a Base64 Data URL
 * Used for attaching images to the chat
 */
export async function getImageDataUrl(uri: vscode.Uri): Promise<string | null> {
    try {
        const fileData = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(fileData);
        const mimeType = getMimeType(uri.fsPath);
        
        if (!mimeType) return null;

        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error(`Error reading image ${uri.fsPath}:`, error);
        return null;
    }
}

function getMimeType(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        default: return null;
    }
}