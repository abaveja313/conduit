import { beforeAll, vi } from 'vitest';

// Mock Next.js specific features
beforeAll(() => {
  // Remove "use client" directives during test runs
  (global as unknown as { USE_CLIENT: string }).USE_CLIENT = '';
});

// Mock window.localStorage for tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock @conduit/fs module
vi.mock('@conduit/fs', () => ({
  FileService: vi.fn(),
}));

// Mock @conduit/shared module  
vi.mock('@conduit/shared', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => {
      return { type: 'div', props: { ...props, children } };
    },
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
}));
