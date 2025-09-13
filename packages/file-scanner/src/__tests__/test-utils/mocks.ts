/**
 * Mock implementations of the FileSystem Access API for testing
 */

export interface MockFileData {
  name: string;
  size?: number;
  type?: string;
  lastModified?: number;
  error?: Error;
}

export interface MockDirectoryStructure {
  [name: string]: MockFileData | MockDirectoryStructure;
}

export class MockFile implements File {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly lastModified: number;

  constructor(data: MockFileData) {
    this.name = data.name;
    this.size = data.size ?? 0;
    this.type = data.type ?? '';
    this.lastModified = data.lastModified ?? Date.now();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new ArrayBuffer(this.size);
  }

  async text(): Promise<string> {
    return '';
  }

  slice(): Blob {
    return new Blob();
  }

  stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return new ReadableStream();
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(new ArrayBuffer(this.size));
  }

  get webkitRelativePath(): string {
    return '';
  }
}

export class MockFileSystemFileHandle implements FileSystemFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;
  private fileData: MockFileData;

  constructor(name: string, fileData: MockFileData) {
    this.name = name;
    this.fileData = fileData;
  }

  async getFile(): Promise<File> {
    if (this.fileData.error) {
      throw this.fileData.error;
    }
    return new MockFile(this.fileData);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    throw new Error('Not implemented in mock');
  }

  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    throw new Error('Not implemented in mock');
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return this === other;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }
}

export class MockFileSystemDirectoryHandle implements FileSystemDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;
  private _entries: Map<string, FileSystemHandle> = new Map();
  private _error?: Error;

  constructor(name: string, structure?: MockDirectoryStructure) {
    this.name = name;
    if (structure) {
      this.populateFromStructure(structure);
    }
  }

  private populateFromStructure(structure: MockDirectoryStructure): void {
    for (const [name, value] of Object.entries(structure)) {
      if ('size' in value || 'error' in value) {
        // It's a file
        this._entries.set(name, new MockFileSystemFileHandle(name, value as MockFileData));
      } else {
        // It's a directory
        const subDir = new MockFileSystemDirectoryHandle(name, value as MockDirectoryStructure);
        this._entries.set(name, subDir);
      }
    }
  }

  setError(error: Error): void {
    this._error = error;
  }

  addFile(name: string, data: Partial<MockFileData> = {}): MockFileSystemFileHandle {
    const fileData: MockFileData = { name, ...data };
    const handle = new MockFileSystemFileHandle(name, fileData);
    this._entries.set(name, handle);
    return handle;
  }

  addDirectory(name: string): MockFileSystemDirectoryHandle {
    const handle = new MockFileSystemDirectoryHandle(name);
    this._entries.set(name, handle);
    return handle;
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    if (this._error) {
      throw this._error;
    }
    for (const [name, handle] of this._entries) {
      yield [name, handle];
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this._entries.keys()) {
      yield name;
    }
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for (const handle of this._entries.values()) {
      yield handle;
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> {
    return this.entries();
  }

  async getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle> {
    const handle = this._entries.get(name);
    if (handle && handle.kind === 'directory') {
      return handle as FileSystemDirectoryHandle;
    }
    throw new DOMException('Not found', 'NotFoundError');
  }

  async getFileHandle(name: string): Promise<FileSystemFileHandle> {
    const handle = this._entries.get(name);
    if (handle && handle.kind === 'file') {
      return handle as FileSystemFileHandle;
    }
    throw new DOMException('Not found', 'NotFoundError');
  }

  async removeEntry(name: string): Promise<void> {
    this._entries.delete(name);
  }

  async resolve(_possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    return null;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return this === other;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }
}

/**
 * Factory function to create mock file system structures
 */
export function createMockFileSystem(
  structure?: MockDirectoryStructure,
): MockFileSystemDirectoryHandle {
  return new MockFileSystemDirectoryHandle('root', structure);
}

/**
 * Create a mock file that throws an error when accessed
 */
export function createErrorFile(
  name: string,
  error: Error = new Error('Access denied'),
): MockFileData {
  return {
    name,
    error,
  };
}

/**
 * Create a large directory with many files for performance testing
 */
export function createLargeDirectory(fileCount: number, prefix = 'file'): MockDirectoryStructure {
  const structure: MockDirectoryStructure = {};
  for (let i = 0; i < fileCount; i++) {
    structure[`${prefix}${i}.txt`] = {
      name: `${prefix}${i}.txt`,
      size: Math.floor(Math.random() * 10000),
      type: 'text/plain',
    };
  }
  return structure;
}

/**
 * Mock FileSystem Access API support
 */
export function mockFileSystemAccessSupport(supported = true): void {
  if (supported) {
    (globalThis as any).FileSystemFileHandle = MockFileSystemFileHandle;
    (globalThis as any).FileSystemDirectoryHandle = MockFileSystemDirectoryHandle;
    (globalThis as any).showDirectoryPicker = async () => createMockFileSystem();
  } else {
    delete (globalThis as any).FileSystemFileHandle;
    delete (globalThis as any).FileSystemDirectoryHandle;
    delete (globalThis as any).showDirectoryPicker;
  }
}
