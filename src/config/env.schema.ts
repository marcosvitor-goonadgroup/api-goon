import { z } from 'zod';

/**
 * Converte "a, b ,c" em ['a','b','c'], descartando entradas vazias.
 */
const csvToArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/** Aceita "true"/"1"/"yes" (e variacoes de caixa) como verdadeiro. */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
    });

const csvField = () => z.string().optional().transform(csvToArray);

/**
 * Contrato unico de entrada do ambiente. Tudo que a aplicacao le de
 * `process.env` passa por aqui - se faltar algo obrigatorio ou vier um valor
 * invalido, o processo falha no boot em vez de quebrar em runtime.
 */
export const envSchema = z.object({
  // Aplicacao
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('1'),

  // Documentacao
  SWAGGER_ENABLED: booleanFromEnv(true),
  SWAGGER_PATH: z.string().default('docs'),

  // Seguranca
  CORS_ORIGINS: csvField(),
  API_KEYS: csvField(),
  API_KEY_HEADER: z.string().default('x-api-key'),

  // Rate limit
  RATE_LIMIT_ENABLED: booleanFromEnv(true),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // HTTP / resiliencia
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  HTTP_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(250),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_BREAKER_RESET_MS: z.coerce.number().int().positive().default(30_000),

  // Cache
  CACHE_ENABLED: booleanFromEnv(true),
  CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
  CACHE_MAX_ITEMS: z.coerce.number().int().positive().default(500),

  // Busca federada
  SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Logs
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Conectores
  // UOL Ads - exige credencial. Sem `UOL_ADS_KEY` o conector se desabilita,
  // em vez de disparar uma sequencia de 401 contra a origem.
  UOL_ADS_ENABLED: booleanFromEnv(true),
  UOL_ADS_BASE_URL: z.string().url().default('https://api.ads.uol.com.br'),
  UOL_ADS_KEY: z.string().default(''),
  UOL_ADS_CACHE_TTL_MS: z.coerce.number().int().min(0).default(300_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida o ambiente e agrega **todos** os erros numa unica mensagem legivel,
 * em vez de estourar no primeiro campo invalido.
 */
export function parseEnv(source: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracao de ambiente invalida:\n${details}`);
  }

  return result.data;
}
