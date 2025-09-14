import { ErrorCodes, ConduitError } from './types';

export class WASMManager {
    private modules = new Map<string, WebAssembly.Instance>();

    async getModule(name: string): Promise<WebAssembly.Instance> {
        if (this.modules.has(name)) {
            return this.modules.get(name)!;
        }

        const instance = await this.loadModule(name);
        this.modules.set(name, instance);
        return instance;
    }

    private validateModuleName(name: string): void {
        // Only allow safe characters
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            throw new ConduitError(
                `Invalid module name: ${name}`,
                ErrorCodes.WASM_LOAD_ERROR
            );
        }

        // Prevent path traversal
        if (name.includes('..') || name.includes('/') || name.includes('\\')) {
            throw new ConduitError(
                `Module name cannot contain path characters: ${name}`,
                ErrorCodes.WASM_LOAD_ERROR
            );
        }
    }

    private async loadModule(name: string): Promise<WebAssembly.Instance> {
        this.validateModuleName(name);

        try {
            const response = await fetch(`/wasm/${name}.wasm`, {
                cache: 'force-cache'
            });

            if (!response.ok) {
                throw new ConduitError(
                    `Failed to load WASM module ${name}: ${response.statusText}`,
                    ErrorCodes.WASM_LOAD_ERROR
                );
            }

            const bytes = await response.arrayBuffer();
            const { instance } = await WebAssembly.instantiate(bytes);
            return instance;

        } catch (error) {
            if (error instanceof ConduitError) throw error;

            throw new ConduitError(
                `Failed to load WASM module ${name}: ${error instanceof Error ? error.message : String(error)}`,
                ErrorCodes.WASM_LOAD_ERROR
            );
        }
    }

    dispose(): void {
        this.modules.clear();
    }
}
