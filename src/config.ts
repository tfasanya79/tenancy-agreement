/**
 * Application configuration, read once from the environment.
 *
 * Everything the app needs to run lives in one object so it is easy to see,
 * log (with the key redacted) and override in tests.
 */

export type AppConfig = {
  deepseekApiKey: string;
  deepseekModel: string;
  deepseekBaseUrl: string;
  port: number;
  host: string;
  dataDir: string;
  templatesDir: string;
  publicDir: string;
  agency: {
    name: string;
    email: string;
    phone: string;
    address: string;
    clientMoneyScheme: string;
    redressScheme: string;
  };
  offlineMode: boolean;
};

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config: AppConfig = {
    deepseekApiKey: env('DEEPSEEK_API_KEY'),
    deepseekModel: env('DEEPSEEK_MODEL', 'deepseek-chat'),
    deepseekBaseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    port: envInt('PORT', 3000),
    host: env('HOST', '0.0.0.0'),
    dataDir: env('DATA_DIR', './data'),
    templatesDir: env('TEMPLATES_DIR', './templates'),
    publicDir: env('PUBLIC_DIR', './public'),
    agency: {
      name: env('AGENCY_NAME'),
      email: env('AGENCY_EMAIL'),
      phone: env('AGENCY_PHONE'),
      address: env('AGENCY_ADDRESS'),
      clientMoneyScheme: env('AGENCY_CLIENT_MONEY_SCHEME'),
      redressScheme: env('AGENCY_REDRESS_SCHEME'),
    },
    offlineMode: envBool('OFFLINE_MODE', false),
    ...overrides,
  };
  return config;
}

/** The key never appears in logs; only whether it looks present. */
export function describeConfig(config: AppConfig) {
  return {
    model: config.deepseekModel,
    baseUrl: config.deepseekBaseUrl,
    apiKeyPresent: config.deepseekApiKey.length > 0,
    offlineMode: config.offlineMode,
    port: config.port,
    dataDir: config.dataDir,
  };
}
