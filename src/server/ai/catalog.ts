export type Provider = 'openai' | 'deepseek' | 'anthropic'
export type PlanTier = 'free' | 'pro'

export interface CatalogModel { id: string; label: string; tiers: PlanTier[] }

// Model ids are code constants on purpose - they churn; verify at the live
// smoke run and edit here only.
export const CATALOG: Record<Provider, CatalogModel[]> = {
  openai: [
    { id: 'gpt-5.1', label: 'GPT-5.1', tiers: ['pro'] },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', tiers: ['free', 'pro'] }
  ],
  deepseek: [{ id: 'deepseek-chat', label: 'DeepSeek Chat', tiers: ['free', 'pro'] }],
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', tiers: ['pro'] },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tiers: ['free', 'pro'] }
  ]
}

export const DEFAULT_SELECTION = { provider: 'openai' as Provider, model: 'gpt-5-mini' }

// Advisory dev-stub allowances (D-13); real numbers are vendor-service design items.
export const PLANS: Record<PlanTier, { label: string; monthlyTokens: number }> = {
  free: { label: 'Free', monthlyTokens: 200_000 },
  pro: { label: 'Jobpin Pro (dev)', monthlyTokens: 5_000_000 }
}

const JURISDICTION: Record<Provider, string> = {
  openai: 'OpenAI (United States)',
  deepseek: 'DeepSeek (People’s Republic of China)',
  anthropic: 'Anthropic (United States)'
}

/** D-11: shown at model selection, before confirming. */
export function disclosureFor(provider: Provider): string {
  return (
    `When you run an analysis, the necessary candidate content is sent to ${JURISDICTION[provider]} ` +
    `at call time and is not stored by Jobpin anywhere but this computer. Provider data-handling and ` +
    `jurisdiction are outside Jobpin's control - the choice of provider is yours. See the terms for ` +
    `the liability disclaimer.`
  )
}
