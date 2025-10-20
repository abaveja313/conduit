import { MODELS } from './ModelGrid';

export function getAvailableModels(hasApiKey: boolean, isUsingInternalKey: boolean) {
  const useOwnKey = hasApiKey;

  const models = isUsingInternalKey && !useOwnKey ? MODELS.filter((m) => !m.premium) : MODELS;

  return models.map((model) => ({
    ...model,
    disabled: model.requiresOwnKey ? !useOwnKey : model.premium && isUsingInternalKey && !useOwnKey,
  }));
}
