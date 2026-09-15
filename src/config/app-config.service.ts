import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CONFIG_NAMESPACE, type AppConfig } from './configuration';

/**
 * Fachada tipada sobre o `ConfigService`. Injete este service (e nao o
 * `ConfigService` cru) para ter autocomplete e evitar chaves em string.
 */
@Injectable()
export class AppConfigService {
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    // O loader garante a presenca do namespace; o `!` documenta essa invariante.
    this.config = configService.get<AppConfig>(CONFIG_NAMESPACE)!;
  }

  get all(): AppConfig {
    return this.config;
  }

  get env(): AppConfig['env'] {
    return this.config.env;
  }

  get isProduction(): boolean {
    return this.config.isProduction;
  }

  get isDevelopment(): boolean {
    return this.config.isDevelopment;
  }

  get port(): number {
    return this.config.port;
  }

  get apiPrefix(): string {
    return this.config.apiPrefix;
  }

  get apiVersion(): string {
    return this.config.apiVersion;
  }

  get logLevel(): AppConfig['logLevel'] {
    return this.config.logLevel;
  }

  get swagger(): AppConfig['swagger'] {
    return this.config.swagger;
  }

  get security(): AppConfig['security'] {
    return this.config.security;
  }

  get rateLimit(): AppConfig['rateLimit'] {
    return this.config.rateLimit;
  }

  get http(): AppConfig['http'] {
    return this.config.http;
  }

  get cache(): AppConfig['cache'] {
    return this.config.cache;
  }

  get search(): AppConfig['search'] {
    return this.config.search;
  }

  get connectors(): AppConfig['connectors'] {
    return this.config.connectors;
  }
}
