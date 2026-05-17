import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CommandAuditEntry {
    timestamp: string;
    command: string;
    cwd: string;
    risk: 'safe' | 'moderate' | 'dangerous';
    approved: boolean;          // Was confirmation shown & approved?
    autoApproved: boolean;      // Was it auto-approved by risk tier?
    exitCode: number;
    blocked: boolean;           // Was it hard-blocked?
    blockReason?: string;
    chatId?: string;
}

export class CommandAuditService {
    private static instance: CommandAuditService;
    private logFile: string;
    private maxEntries = 1000;

    private constructor() {
        const dir = path.join(os.homedir(), '.kdaina');
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        }
        this.logFile = path.join(dir, 'command-audit.jsonl');
    }

    public static getInstance(): CommandAuditService {
        if (!CommandAuditService.instance) {
            CommandAuditService.instance = new CommandAuditService();
        }
        return CommandAuditService.instance;
    }

    public log(entry: CommandAuditEntry) {
        try {
            const line = JSON.stringify(entry) + '\n';
            fs.appendFileSync(this.logFile, line);
            this.rotateIfNeeded();
        } catch (e) {
            console.error('[CommandAuditService] Failed to log command:', e);
        }
    }

    private rotateIfNeeded() {
        try {
            if (!fs.existsSync(this.logFile)) return;
            
            // Basic rotation: if file > 1MB, read last maxEntries and overwrite
            const stats = fs.statSync(this.logFile);
            if (stats.size > 1024 * 1024) { // 1MB
                const content = fs.readFileSync(this.logFile, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim() !== '');
                if (lines.length > this.maxEntries) {
                    const keep = lines.slice(-this.maxEntries);
                    fs.writeFileSync(this.logFile, keep.join('\n') + '\n');
                }
            }
        } catch (e) {
            console.error('[CommandAuditService] Failed to rotate log:', e);
        }
    }
}
