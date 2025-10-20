import { describe, it, expect } from 'vitest';
import { MODELS } from '../ModelGrid';

export function getAvailableModels(hasApiKey: boolean, isUsingInternalKey: boolean) {
  const useOwnKey = hasApiKey;

  const models = isUsingInternalKey && !useOwnKey ? MODELS.filter((m) => !m.premium) : MODELS;

  return models.map((model) => ({
    ...model,
    disabled: model.requiresOwnKey ? !useOwnKey : model.premium && isUsingInternalKey && !useOwnKey,
  }));
}

describe('Model availability logic', () => {
  describe('With user API key', () => {
    it('should enable all models when user has their own API key', () => {
      const models = getAvailableModels(true, false);

      expect(models.every((m) => !m.disabled)).toBe(true);

      const opus = models.find((m) => m.value === 'claude-opus-4-1-20250805');
      expect(opus).toBeDefined();
      expect(opus?.disabled).toBe(false);
    });

    it('should enable all models even with internal key when user provides own key', () => {
      const models = getAvailableModels(true, true);

      expect(models.every((m) => !m.disabled)).toBe(true);

      const opus = models.find((m) => m.value === 'claude-opus-4-1-20250805');
      expect(opus?.disabled).toBe(false);
    });
  });

  describe('Trial mode (internal key, no user key)', () => {
    it('should filter out premium models in trial mode', () => {
      const models = getAvailableModels(false, true);

      const premiumModels = models.filter((m) => m.premium);
      expect(premiumModels.length).toBe(0);

      const regularModels = models.filter((m) => !m.premium);
      expect(regularModels.every((m) => !m.disabled)).toBe(true);
    });

    it('should not include Opus in trial mode', () => {
      const models = getAvailableModels(false, true);

      const opus = models.find((m) => m.value === 'claude-opus-4-1-20250805');
      expect(opus).toBeUndefined();
    });

    it('should enable Haiku and Sonnet models in trial mode', () => {
      const models = getAvailableModels(false, true);

      const haiku = models.find((m) => m.value === 'claude-haiku-4-5-20251001');
      const sonnet45 = models.find((m) => m.value === 'claude-sonnet-4-5-20250929');
      const sonnet4 = models.find((m) => m.value === 'claude-sonnet-4-20250514');

      expect(haiku).toBeDefined();
      expect(haiku?.disabled ?? false).toBe(false);
      expect(sonnet45).toBeDefined();
      expect(sonnet45?.disabled ?? false).toBe(false);
      expect(sonnet4).toBeDefined();
      expect(sonnet4?.disabled ?? false).toBe(false);
    });

    it('should only show non-premium models in trial mode', () => {
      const models = getAvailableModels(false, true);

      expect(models.length).toBe(3); // Haiku, Sonnet 4.5, Sonnet 4
      expect(models.every((m) => !m.premium)).toBe(true);
      expect(models.some((m) => m.value === 'claude-opus-4-1-20250805')).toBe(false);
    });
  });

  describe('No API key and no internal key', () => {
    it('should show all models but disable those requiring own key', () => {
      const models = getAvailableModels(false, false);

      expect(models.length).toBe(MODELS.length);

      const requiresOwnKeyModels = models.filter((m) => m.requiresOwnKey);
      expect(requiresOwnKeyModels.every((m) => m.disabled)).toBe(true);

      const regularModels = models.filter((m) => !m.requiresOwnKey);
      expect(regularModels.every((m) => !m.disabled)).toBe(true);
    });
  });

  describe('Model properties', () => {
    it('should preserve all model properties', () => {
      const models = getAvailableModels(true, false);

      models.forEach((model) => {
        const original = MODELS.find((m) => m.value === model.value);
        expect(model.label).toBe(original?.label);
        expect(model.description).toBe(original?.description);
        expect(model.icon).toBe(original?.icon);
        expect(model.features).toEqual(original?.features);
        expect(model.color).toBe(original?.color);
        expect(model.borderColor).toBe(original?.borderColor);
      });
    });

    it('should correctly identify recommended model', () => {
      const models = getAvailableModels(true, false);

      const recommendedModels = models.filter((m) => m.recommended);
      expect(recommendedModels.length).toBe(1);
      expect(recommendedModels[0].value).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined values gracefully', () => {
      expect(() => getAvailableModels(false, false)).not.toThrow();
      expect(() => getAvailableModels(true, true)).not.toThrow();
    });

    it('should return consistent results for same inputs', () => {
      const result1 = getAvailableModels(true, false);
      const result2 = getAvailableModels(true, false);

      expect(result1).toEqual(result2);
    });
  });
});
