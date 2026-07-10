import { PLANS, type PlanTier, type Provider } from './catalog'

export interface Credentials { apiKey: string; baseUrl?: string }

/** The seam where the real vendor token-issuance client (D-12) lands later. */
export interface TokenIssuer { getCredentials(provider: Provider): Credentials }

const ENV_KEYS: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY'
}
const BASE_URLS: Partial<Record<Provider, string>> = { deepseek: 'https://api.deepseek.com' }

export class DevTokenIssuer implements TokenIssuer {
  constructor(private env: Record<string, string | undefined>) {}
  getCredentials(provider: Provider): Credentials {
    const key = this.env[ENV_KEYS[provider]]
    if (!key) {
      const err = new Error(`no dev credential for ${provider} - set ${ENV_KEYS[provider]} in .env`)
      err.name = 'AuthCredentialsError'
      throw err
    }
    return { apiKey: key, baseUrl: BASE_URLS[provider] }
  }
}

/** Dev stub: everyone is Pro until the vendor service exists (D-10/D-12). */
export function getPlan(): { tier: PlanTier; label: string; monthlyTokens: number } {
  return { tier: 'pro', ...PLANS.pro }
}
