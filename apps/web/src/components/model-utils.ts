export const MODELS = [
  {
    value: 'claude-haiku-4-5-20251001',
    label: 'Claude 4.5 Haiku',
    shortLabel: 'Haiku',
    description: 'Lightning fast responses for simple tasks',
    icon: null as unknown as React.ComponentType<{ className?: string }>,
    features: ['Fastest', 'Cost-effective'],
    color: 'from-blue-500/10 to-cyan-500/10',
    borderColor: 'border-blue-500/20',
    premium: false,
    requiresOwnKey: false,
  },
  {
    value: 'claude-sonnet-4-5-20250929',
    label: 'Claude 4.5 Sonnet',
    shortLabel: 'Sonnet',
    description: 'Best balance of speed and intelligence',
    icon: null as unknown as React.ComponentType<{ className?: string }>,
    features: ['Balanced', 'Powerful'],
    recommended: true,
    color: 'from-purple-500/10 to-pink-500/10',
    borderColor: 'border-purple-500/20',
    premium: false,
    requiresOwnKey: false,
  },
  {
    value: 'claude-sonnet-4-20250514',
    label: 'Claude 4 Sonnet',
    shortLabel: 'Sonnet',
    description: 'Previous generation balanced model',
    icon: null as unknown as React.ComponentType<{ className?: string }>,
    features: ['Balanced', 'Efficient'],
    color: 'from-green-500/10 to-emerald-500/10',
    borderColor: 'border-green-500/20',
    premium: false,
    requiresOwnKey: false,
  },
  {
    value: 'claude-opus-4-1-20250805',
    label: 'Claude 4.1 Opus',
    shortLabel: 'Opus',
    description: 'Most powerful for complex tasks',
    icon: null as unknown as React.ComponentType<{ className?: string }>,
    features: ['Most capable', 'Deep analysis'],
    premium: true,
    requiresOwnKey: true,
    color: 'from-amber-500/10 to-orange-500/10',
    borderColor: 'border-amber-500/20',
  },
];

export function getAvailableModels(hasApiKey: boolean, isUsingInternalKey: boolean) {
  const useOwnKey = hasApiKey;

  const models = isUsingInternalKey && !useOwnKey ? MODELS.filter((m) => !m.premium) : MODELS;

  return models.map((model) => ({
    ...model,
    disabled: model.requiresOwnKey ? !useOwnKey : model.premium && isUsingInternalKey && !useOwnKey,
  }));
}