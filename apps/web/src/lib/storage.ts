export const getStoredApiKey = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('anthropicApiKey');
};

export const setStoredApiKey = (key: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('anthropicApiKey', key);
  }
};

export const clearStoredApiKey = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('anthropicApiKey');
  }
};

export const getStoredModel = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('selectedModel');
};

export const setStoredModel = (model: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('selectedModel', model);
  }
};

export const setTrialMode = (): void => {
  clearStoredApiKey();
};
