import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../scanner.js';
import { createMockFileSystem, mockFileSystemAccessSupport } from './test-utils/mocks.js';
import { collectScanResults } from './test-utils/helpers.js';

describe('FileScanner - Options', () => {
  beforeEach(() => {
    mockFileSystemAccessSupport(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should respect maxFileSize limit', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'small.txt': { name: 'small.txt', size: 100 },
      'medium.txt': { name: 'medium.txt', size: 1000 },
      'large.txt': { name: 'large.txt', size: 10000 },
    });

    const results = await collectScanResults(scanner, handle, { maxFileSize: 5000 });
    const files = results.filter((f) => f.type === 'file');

    expect(files.map((f) => f.name).sort()).toEqual(['medium.txt', 'small.txt']);
  });

  it('should include hidden files when enabled', async () => {
    const scanner = new FileScanner();
    const handle = createMockFileSystem({
      'visible.txt': { name: 'visible.txt', size: 100 },
      '.hidden': { name: '.hidden', size: 200 },
      '.env': { name: '.env', size: 300 },
    });

    const withHidden = await collectScanResults(scanner, handle, { includeHidden: true });
    const withoutHidden = await collectScanResults(scanner, handle, { includeHidden: false });

    expect(withHidden.filter((f) => f.type === 'file')).toHaveLength(3);
    expect(withoutHidden.filter((f) => f.type === 'file')).toHaveLength(1);
    expect(withoutHidden.filter((f) => f.type === 'file')[0].name).toBe('visible.txt');
  });
});
