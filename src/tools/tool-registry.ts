import { WorkspaceIndexService } from '../services/workspace-index';
import { createFileTools } from './file-tools';
import { createSysTools } from './sys-tools';

/**
 * Central tool registry. Creates all tools and returns them as a flat object
 * ready to be injected into the Vercel AI SDK's `tools` parameter.
 */
export function createToolRegistry(workspaceIndex: WorkspaceIndexService) {
    const fileTools = createFileTools(workspaceIndex);
    const sysTools = createSysTools();

    return {
        ...fileTools,
        ...sysTools
    };
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>;
