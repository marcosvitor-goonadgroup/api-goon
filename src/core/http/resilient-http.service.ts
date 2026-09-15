import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { AxiosError, type AxiosRequestConfig, type AxiosResponse, type Method } from 'axios';
import { firstValueFrom } from 'rxjs';

import { AppConfigService } from '../../config/app-config.service';
import { ErrorCode } from '../../common/constants';
import {
  IntegrationException,
  IntegrationTimeoutException,
  IntegrationUnavailableException,
} from '../../common/exceptions/integration.exception';
import { CircuitBreaker, type CircuitSnapshot } from './circuit-breaker';

export interface ResilientRequestOptions<TBody = unknown> {
  /** Chave do conector: usada em logs, no circuito e no campo `source` do erro. */
  source: string;
  url: string;
  method?: Method;
  baseURL?: string;
  params?: Record<string, unknown>;
  data?: TBody;
  headers?: Record<string, string>;

  /** Sobrescreve `HTTP_TIMEOUT_MS` para esta chamada. */
  timeoutMs?: number;
  /** Sobrescreve `HTTP_MAX_RETRIES` para esta chamada. */
  retries?: number;

  /**
   * Habilita cache de resposta. Sem `cacheKey` a chamada nao e cacheada -
   * seja explicito para evitar guardar respostas personalizadas por engano.
   */
  cacheKey?: string;
  cacheTtlMs?: number;

  /**
   * Status que devem virar `null` em vez de excecao. Padrao: `[404]`.
   * Util porque "nao encontrado" costuma ser um resultado valido de busca.
   */
  treatAsEmpty?: number[];
}

/**
 * Cliente HTTP compartilhado por todos os conectores.
 *
 * Concentra as politicas que nao deveriam ser reimplementadas por integracao:
 * timeout, retry com backoff exponencial e jitter, circuit breaker, cache de
 * resposta e traducao de erro remoto para a excecao de dominio.
 */
@Injectable()
export class ResilientHttpService {
  private readonly logger = new Logger(ResilientHttpService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly http: HttpService,
    private readonly config: AppConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Executa a requisicao aplicando todas as politicas de resiliencia.
   *
   * @returns o corpo da resposta, ou `null` quando o status esta em `treatAsEmpty`.
   */
  async request<TResponse, TBody = unknown>(
    options: ResilientRequestOptions<TBody>,
  ): Promise<TResponse | null> {
    const {
      source,
      cacheKey,
      cacheTtlMs = this.config.cache.ttlMs,
      treatAsEmpty = [404],
    } = options;

    const cached = await this.readFromCache<TResponse>(cacheKey);
    if (cached !== undefined) {
      this.logger.debug(`[${source}] cache hit: ${cacheKey}`);
      return cached;
    }

    const breaker = this.getBreaker(source);
    if (!breaker.canAttempt()) {
      const snapshot = breaker.snapshot();
      throw new IntegrationUnavailableException(
        source,
        `circuito aberto apos ${snapshot.failures} falhas consecutivas`,
        snapshot,
      );
    }

    const result = await this.executeWithRetries<TResponse, TBody>(options, breaker, treatAsEmpty);

    if (cacheKey && this.config.cache.enabled) {
      await this.cache.set(cacheKey, result, cacheTtlMs);
    }

    return result;
  }

  /** Atalho para GET, que cobre a maior parte das buscas. */
  get<TResponse>(
    options: Omit<ResilientRequestOptions, 'method' | 'data'>,
  ): Promise<TResponse | null> {
    return this.request<TResponse>({ ...options, method: 'GET' });
  }

  /** Estado atual do disjuntor de cada conector - alimenta o health check. */
  getCircuitSnapshot(source: string): CircuitSnapshot {
    return this.getBreaker(source).snapshot();
  }

  private async executeWithRetries<TResponse, TBody>(
    options: ResilientRequestOptions<TBody>,
    breaker: CircuitBreaker,
    treatAsEmpty: number[],
  ): Promise<TResponse | null> {
    const { source } = options;
    const timeoutMs = options.timeoutMs ?? this.config.http.timeoutMs;
    const maxRetries = options.retries ?? this.config.http.maxRetries;

    const requestConfig: AxiosRequestConfig<TBody> = {
      url: options.url,
      method: options.method ?? 'GET',
      baseURL: options.baseURL,
      params: options.params,
      data: options.data,
      headers: options.headers,
      timeout: timeoutMs,
      // Nos mesmos decidimos o que e erro, para poder tratar 404 como vazio.
      validateStatus: () => true,
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.http.request<TResponse>(requestConfig as AxiosRequestConfig),
        );

        if (treatAsEmpty.includes(response.status)) {
          breaker.recordSuccess();
          return null;
        }

        if (response.status < 400) {
          breaker.recordSuccess();
          return response.data;
        }

        // 4xx e resposta definitiva do outro lado: nao adianta repetir e nao
        // e sinal de indisponibilidade, entao nao conta para o disjuntor.
        if (response.status < 500 && response.status !== 429) {
          throw this.toIntegrationException(source, response);
        }

        lastError = this.toIntegrationException(source, response);
      } catch (error) {
        if (error instanceof IntegrationException) {
          // Erro ja classificado como definitivo: propaga sem repetir.
          if (error.getStatus() < 500) {
            throw error;
          }
          lastError = error;
        } else {
          lastError = error;

          if (this.isTimeout(error)) {
            lastError = new IntegrationTimeoutException(source, timeoutMs);
          }
        }
      }

      breaker.recordFailure();

      if (attempt < maxRetries) {
        const delay = this.backoffDelay(attempt);
        this.logger.warn(
          `[${source}] tentativa ${attempt + 1}/${maxRetries + 1} falhou; nova tentativa em ${delay}ms`,
        );
        await this.sleep(delay);
      }
    }

    throw this.wrapUnknownError(source, lastError);
  }

  /** Backoff exponencial com jitter, para nao sincronizar retentativas. */
  private backoffDelay(attempt: number): number {
    const base = this.config.http.retryBaseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.config.http.retryBaseDelayMs;
    return Math.round(base + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getBreaker(source: string): CircuitBreaker {
    let breaker = this.breakers.get(source);

    if (!breaker) {
      const { threshold, resetMs } = this.config.http.circuitBreaker;
      breaker = new CircuitBreaker(source, threshold, resetMs);
      this.breakers.set(source, breaker);
    }

    return breaker;
  }

  private async readFromCache<T>(cacheKey?: string): Promise<T | undefined> {
    if (!cacheKey || !this.config.cache.enabled) {
      return undefined;
    }

    try {
      return await this.cache.get<T>(cacheKey);
    } catch (error) {
      // Cache indisponivel nunca deve derrubar a requisicao.
      this.logger.warn(`Falha ao ler o cache (${cacheKey}): ${this.describe(error)}`);
      return undefined;
    }
  }

  private toIntegrationException(source: string, response: AxiosResponse): IntegrationException {
    return new IntegrationException({
      code: ErrorCode.INTEGRATION_ERROR,
      message: `A integracao "${source}" respondeu com status ${response.status}.`,
      source,
      status: response.status >= 500 ? 502 : 400,
      details: {
        upstreamStatus: response.status,
        upstreamBody: this.truncate(response.data),
      },
    });
  }

  private wrapUnknownError(source: string, error: unknown): IntegrationException {
    if (error instanceof IntegrationException) {
      return error;
    }

    return new IntegrationException({
      code: ErrorCode.INTEGRATION_ERROR,
      message: `Falha ao consultar a integracao "${source}".`,
      source,
      status: 502,
      details: { reason: this.describe(error) },
    });
  }

  private isTimeout(error: unknown): boolean {
    return (
      error instanceof AxiosError && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
    );
  }

  private describe(error: unknown): string {
    if (error instanceof AxiosError) {
      return `${error.code ?? 'ERR'}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  /** Evita despejar payloads gigantes de terceiros dentro do nosso erro/log. */
  private truncate(value: unknown, limit = 500): unknown {
    if (typeof value !== 'string') {
      const serialized = JSON.stringify(value);
      if (!serialized || serialized.length <= limit) {
        return value;
      }
      return `${serialized.slice(0, limit)}...`;
    }

    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }
}
