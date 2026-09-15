import { parseEnv, type Env } from './env.schema';

export interface ConnectorConfig {
  enabled: boolean;
  baseUrl: string;
}

/** Conector que exige credencial. O conector se desabilita sozinho sem ela. */
export interface AuthenticatedConnectorConfig extends ConnectorConfig {
  apiKey: string;
  /** TTL proprio, para origens cujo dado envelhece diferente do padrao. */
  cacheTtlMs: number;
}

/**
 * Configuracao da aplicacao ja normalizada em secoes. Os services consomem
 * esta forma (e nao `process.env`), o que mantem o codigo testavel e evita
 * strings magicas espalhadas.
 */
export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  isDevelopment: boolean;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  logLevel: Env['LOG_LEVEL'];

  swagger: {
    enabled: boolean;
    path: string;
  };

  security: {
    corsOrigins: string[];
    apiKeys: string[];
    apiKeyHeader: string;
  };

  rateLimit: {
    enabled: boolean;
    windowMs: number;
    max: number;
  };

  http: {
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    circuitBreaker: {
      threshold: number;
      resetMs: number;
    };
  };

  cache: {
    enabled: boolean;
    ttlMs: number;
    maxItems: number;
  };

  search: {
    timeoutMs: number;
  };

  connectors: {
    uolAds: AuthenticatedConnectorConfig;
  };
}

export const CONFIG_NAMESPACE = 'app';

export function buildAppConfig(env: Env): AppConfig {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    port: env.PORT,
    apiPrefix: env.API_PREFIX.replace(/^\/+|\/+$/g, ''),
    apiVersion: env.API_VERSION,
    logLevel: env.LOG_LEVEL,

    swagger: {
      enabled: env.SWAGGER_ENABLED,
      path: env.SWAGGER_PATH.replace(/^\/+|\/+$/g, ''),
    },

    security: {
      corsOrigins: env.CORS_ORIGINS,
      apiKeys: env.API_KEYS,
      apiKeyHeader: env.API_KEY_HEADER.toLowerCase(),
    },

    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
    },

    http: {
      timeoutMs: env.HTTP_TIMEOUT_MS,
      maxRetries: env.HTTP_MAX_RETRIES,
      retryBaseDelayMs: env.HTTP_RETRY_BASE_DELAY_MS,
      circuitBreaker: {
        threshold: env.CIRCUIT_BREAKER_THRESHOLD,
        resetMs: env.CIRCUIT_BREAKER_RESET_MS,
      },
    },

    cache: {
      enabled: env.CACHE_ENABLED,
      ttlMs: env.CACHE_TTL_MS,
      maxItems: env.CACHE_MAX_ITEMS,
    },

    search: {
      timeoutMs: env.SEARCH_TIMEOUT_MS,
    },

    connectors: {
      uolAds: {
        enabled: env.UOL_ADS_ENABLED,
        baseUrl: env.UOL_ADS_BASE_URL,
        apiKey: env.UOL_ADS_KEY,
        cacheTtlMs: env.UOL_ADS_CACHE_TTL_MS,
      },
    },
  };
}

/** Loader consumido pelo `ConfigModule.forRoot({ load: [configuration] })`. */
export const configuration = (): { [CONFIG_NAMESPACE]: AppConfig } => ({
  [CONFIG_NAMESPACE]: buildAppConfig(parseEnv()),
});
