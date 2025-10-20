import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  getStoredApiKey, 
  setStoredApiKey, 
  getStoredModel, 
  setStoredModel, 
  setTrialMode 
} from '../storage';

describe('localStorage utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('API key management', () => {
    it('should save and retrieve API key', () => {
      const testKey = 'sk-ant-api03-test-key';
      setStoredApiKey(testKey);
      expect(getStoredApiKey()).toBe(testKey);
    });

    it('should handle empty API key', () => {
      setStoredApiKey('');
      expect(getStoredApiKey()).toBe('');
    });

    it('should clear API key for trial mode', () => {
      setStoredApiKey('sk-ant-api03-test-key');
      setTrialMode();
      expect(getStoredApiKey()).toBeNull();
    });

    it('should return null when no API key is stored', () => {
      expect(getStoredApiKey()).toBeNull();
    });

    it('should overwrite existing API key', () => {
      setStoredApiKey('old-key');
      setStoredApiKey('new-key');
      expect(getStoredApiKey()).toBe('new-key');
    });
  });

  describe('Model selection persistence', () => {
    it('should save and retrieve selected model', () => {
      const model = 'claude-sonnet-4-5-20250929';
      setStoredModel(model);
      expect(getStoredModel()).toBe(model);
    });

    it('should return null when no model is stored', () => {
      expect(getStoredModel()).toBeNull();
    });

    it('should handle all available models', () => {
      const models = [
        'claude-haiku-4-5-20251001',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-20250514',
        'claude-opus-4-1-20250805',
      ];

      models.forEach((model) => {
        setStoredModel(model);
        expect(getStoredModel()).toBe(model);
      });
    });

    it('should overwrite existing model selection', () => {
      setStoredModel('claude-haiku-4-5-20251001');
      setStoredModel('claude-sonnet-4-5-20250929');
      expect(getStoredModel()).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('Combined operations', () => {
    it('should handle both API key and model independently', () => {
      setStoredApiKey('sk-ant-api03-test');
      setStoredModel('claude-sonnet-4-5-20250929');

      expect(getStoredApiKey()).toBe('sk-ant-api03-test');
      expect(getStoredModel()).toBe('claude-sonnet-4-5-20250929');
    });

    it('should preserve model when clearing API key for trial mode', () => {
      setStoredApiKey('sk-ant-api03-test');
      setStoredModel('claude-sonnet-4-5-20250929');

      setTrialMode();

      expect(getStoredApiKey()).toBeNull();
      expect(getStoredModel()).toBe('claude-sonnet-4-5-20250929');
    });

    it('should handle whitespace in API keys', () => {
      const keyWithSpaces = '  sk-ant-api03-test  ';
      setStoredApiKey(keyWithSpaces);
      expect(getStoredApiKey()).toBe(keyWithSpaces);
    });
  });
});
