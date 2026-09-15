import { Logger } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import type { ResilientHttpService } from '../../core/http/resilient-http.service';
import type {
  ConnectorContext,
  ConnectorHealth,
  ConnectorMetadata,
  ConnectorQuery,
  DataConnector,
  NormalizedRecord,
} from '../contracts/connector.contract';

/**
 * Base para integracoes sobre HTTP/REST.
 *
 * Implementa o que toda integracao repete - chamada resiliente, montagem de
 * chave de cache, health check, normalizacao do envelope de registro - e deixa
 * para a subclasse apenas o que e realmente especifico: `metadata`, `supports`
 * e `search`.
 */
export abstract class BaseHttpConnector implements DataConnector {
  protected readonly logger: Logger;

  constructor(
    protected readonly http: ResilientHttpService,
    protected readonly config: AppConfigService,
  ) {
    this.logger = new Logger(new.target.name);
  }

  abstract readonly metadata: ConnectorMetadata;

  abstract isEnabled(): boolean;

  abstract supports(query: ConnectorQuery): boolean;

  abstract search(query: ConnectorQuery, context: ConnectorContext): Promise<NormalizedRecord[]>;

  /**
   * Endpoint leve usado no health check. Sobrescreva com uma rota barata da
   * origem (idealmente um recurso pequeno e estavel).
   */
  protected abstract healthProbePath(): string;

  /**
   * Credenciais enviadas em toda chamada a origem. O padrao e vazio - apenas
   * conectores autenticados sobrescrevem.
   *
   * Fica num hook (e nao no `fetch` de cada conector) porque o **health check
   * tambem precisa delas**: sem isso, uma origem autenticada responderia 401
   * ao probe e o conector apareceria como `down` mesmo funcionando.
   *
   * Credencial vai somente no header: a `cacheKey` deriva de path e params,
   * entao nunca carrega segredo.
   */
  protected authHeaders(): Record<string, string> {
    return {};
  }

  /**
   * GET resiliente na origem, com cache derivado do caminho e dos parametros.
   */
  protected async fetch<T>(
    path: string,
    options: {
      params?: Record<string, unknown>;
      headers?: Record<string, string>;
      cacheTtlMs?: number;
      /** Desliga o cache para consultas que nao devem ser reaproveitadas. */
      noCache?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<T | null> {
    return this.http.get<T>({
      source: this.metadata.key,
      baseURL: this.metadata.baseUrl,
      url: path,
      params: options.params,
      headers: { ...this.authHeaders(), ...options.headers },
      timeoutMs: options.timeoutMs,
      cacheTtlMs: options.cacheTtlMs,
      cacheKey: options.noCache ? undefined : this.cacheKey(path, options.params),
    });
  }

  /** Chave estavel: mesma consulta -> mesma chave, independente da ordem dos params. */
  protected cacheKey(path: string, params?: Record<string, unknown>): string {
    const normalizedParams = params
      ? Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${String(value)}`)
          .join('&')
      : '';

    return `${this.metadata.key}:${path}${normalizedParams ? `?${normalizedParams}` : ''}`;
  }

  /** Monta um registro normalizado preenchendo origem e timestamp. */
  protected toRecord<T>(input: {
    id: string;
    type: string;
    title: string;
    subtitle?: string;
    attributes: T;
    raw?: unknown;
    context?: ConnectorContext;
  }): NormalizedRecord<T> {
    return {
      id: input.id,
      type: input.type,
      title: input.title,
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
      source: this.metadata.key,
      attributes: input.attributes,
      ...(input.context?.includeRaw ? { raw: input.raw } : {}),
      retrievedAt: new Date().toISOString(),
    };
  }

  async health(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    const circuit = this.http.getCircuitSnapshot(this.metadata.key);

    if (!this.isEnabled()) {
      return {
        key: this.metadata.key,
        status: 'disabled',
        circuit,
        checkedAt,
        message: 'Conector desabilitado por configuracao.',
      };
    }

    if (circuit.state === 'open') {
      return {
        key: this.metadata.key,
        status: 'down',
        circuit,
        checkedAt,
        message: `Circuito aberto apos ${circuit.failures} falhas consecutivas.`,
      };
    }

    const startedAt = Date.now();

    try {
      // Timeout curto e sem retry: o health check nao pode ser mais caro que a
      // propria consulta, nem mascarar lentidao com retentativas.
      await this.http.get({
        source: this.metadata.key,
        baseURL: this.metadata.baseUrl,
        url: this.healthProbePath(),
        headers: this.authHeaders(),
        timeoutMs: Math.min(3_000, this.config.http.timeoutMs),
        retries: 0,
      });

      const latencyMs = Date.now() - startedAt;

      return {
        key: this.metadata.key,
        status: latencyMs > 2_000 ? 'degraded' : 'up',
        circuit: this.http.getCircuitSnapshot(this.metadata.key),
        latencyMs,
        checkedAt,
        ...(latencyMs > 2_000 ? { message: 'Origem respondendo lentamente.' } : {}),
      };
    } catch (error) {
      return {
        key: this.metadata.key,
        status: 'down',
        circuit: this.http.getCircuitSnapshot(this.metadata.key),
        latencyMs: Date.now() - startedAt,
        checkedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Mantem apenas digitos - util para CNPJ, CPF, CEP, DDD. */
  protected onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  /**
   * Normaliza texto para comparacao: minusculas, sem acentos, sem espacos
   * duplicados.
   *
   * Indispensavel em busca textual em portugues - sem isso, "itau" nao
   * encontra "ITAU UNIBANCO" grafado com acento, e o usuario conclui que o
   * dado nao existe.
   */
  protected normalizeText(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
}
