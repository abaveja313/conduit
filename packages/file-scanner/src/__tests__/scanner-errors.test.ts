import { describe, it, expect, beforeEach } from 'vitest';
import { FileScanner } from '../scanner.js';
import { isConduitError } from '@conduit/shared';

describe('FileScanner Error Handling', () => {
    let scanner: FileScanner;

    beforeEach(() => {
        scanner = new FileScanner();
    });

    it('should handle unsupported API gracefully', async () => {
        // Mock unsupported File System Access API
        const originalCheck = FileScanner.isSupported;
        FileScanner.isSupported = () => false;

        try {
            // Create a minimal mock that will trigger the unsupported check
            const mockFS = {} as FileSystemDirectoryHandle;
            
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _file of scanner.scan(mockFS)) {
                // Should not reach here
            }
            expect.fail('Should have thrown');
        } catch (error) {
            // This should remain a regular Error for API compatibility issues
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain('not supported');
            expect(isConduitError(error)).toBe(false);
        } finally {
            FileScanner.isSupported = originalCheck;
        }
    });

    it('should validate FileScanner class exists and is instantiable', () => {
        expect(scanner).toBeInstanceOf(FileScanner);
        expect(FileScanner.isSupported).toBeDefined();
        expect(typeof FileScanner.isSupported()).toBe('boolean');
    });

    it('should have proper event subscription methods', () => {
        expect(scanner.on).toBeDefined();
        expect(typeof scanner.on).toBe('function');
        
        // Test that event subscription returns an unsubscribe function
        const unsubscribe = scanner.on('error', () => {});
        expect(typeof unsubscribe).toBe('function');
        
        // Should not throw when unsubscribing
        expect(() => unsubscribe()).not.toThrow();
    });
});