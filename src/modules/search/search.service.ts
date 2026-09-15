import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ErrorCode } from '../../common/constants';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { IntegrationException } from '../../common/exceptions/integration.exception';
import type {
  ConnectorContext,
  ConnectorQuery,
  DataConnector,
  NormalizedRecord,
} from '../../integrations/contracts/connector.contract';
import { ConnectorRegistryService } from '../../integrations/registry/connector-registry.service';
import { AppConfigService } from '../../config/app-config.service';
import type { SearchQueryDto } from './dto/search-query.dto';
import type { SearchResultDto, SourceOutcomeDto } from './dto/search-response.dto';

interface ConnectorRun {
  outcome: SourceOutcomeDto;
  records: NormalizedRecord[];
}

/** Campos textuais do registro normalizado que aceitam ordenacao. */
const SORTABLE_FIELDS = ['title', 'subtitle', 'type', 'source', 'id', 'retrievedAt'] as const;

type SortableField = (typeof SORTABLE_FIELDS)[number];

function isSortableField(field: string): field is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(field);
}

/**
 * Busca federada.
 *
 * Consulta em paralelo todas as origens compativeis com o termo, normaliza os
 * resultados num formato unico e devolve tambem o diagnostico de cada origem.
 *
 * Decisoes que valem destacar:
 * - **falha parcial nao derruba a resposta**: uma origem indisponivel vira um
 *   item com `outcome: error` em `sources`, e o cliente ainda recebe o que as
 *   demais retornaram;
 * - **teto de tempo global** (`SEARCH_TIMEOUT_MS`) alem do timeout por chamada,
 *   para a resposta nunca depender da origem mais lenta;
 * - **paginacao em memoria**, porque o total so e conhecido depois do fan-out.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly registry: ConnectorRegistryService,
    private readonly config: AppConfigService,
  ) {}

  async search(dto: SearchQueryDto, context: ConnectorContext): Promise<SearchResultDto> {
    const query: ConnectorQuery = {
      term: dto.q.trim(),
      capability: dto.capability,
      limit: dto.limit,
      filters: dto.filters,
    };

    const selected = this.registry.resolveFor(query, dto.sources);

    if (selected.length === 0) {
      return this.emptyResult(dto, query, this.skippedOutcomes(dto.sources));
    }

    this.logger.debug(
      `[${context.requestId}] busca "${query.term}" em ${selected.length} origem(ns): ${selected
        .map((connector) => connector.metadata.key)
        .join(', ')}`,
    );

    const runs = await Promise.all(
      selected.map((connector) => this.runConnector(connector, query, context)),
    );

    const records = runs.flatMap((run) => run.records);
    const sources = runs.map((run) => run.outcome);

    // Conectores nao selecionados aparecem como `skipped` para o cliente
    // entender por que uma origem que ele esperava nao trouxe nada.
    const skipped = this.skippedOutcomes(
      dto.sources,
      selected.map((connector) => connector.metadata.key),
    );

    const ordered = this.sort(records, dto.sortBy, dto.sortOrder);
    const start = (dto.page - 1) * dto.limit;

    return {
      items: ordered.slice(start, start + dto.limit),
      pagination: buildPaginationMeta(ordered.length, dto.page, dto.limit),
      sources: [...sources, ...skipped],
      query: query.term,
      ...(query.capability ? { capability: query.capability } : {}),
      partial: sources.some((source) => source.outcome === 'error' || source.outcome === 'timeout'),
    };
  }

  /**
   * Busca direcionada a uma unica origem.
   *
   * Diferente da federada, aqui o erro **propaga**: o cliente escolheu a
   * origem explicitamente, entao mascarar a falha como "nenhum resultado"
   * seria enganoso.
   */
  async searchOne(
    sourceKey: string,
    dto: SearchQueryDto,
    context: ConnectorContext,
  ): Promise<SearchResultDto> {
    const connector = this.registry.get(sourceKey);
    const query: ConnectorQuery = {
      term: dto.q.trim(),
      capability: dto.capability,
      limit: dto.limit,
      filters: dto.filters,
    };

    const startedAt = Date.now();
    const records = await connector.search(query, context);
    const ordered = this.sort(records, dto.sortBy, dto.sortOrder);
    const start = (dto.page - 1) * dto.limit;

    return {
      items: ordered.slice(start, start + dto.limit),
      pagination: buildPaginationMeta(ordered.length, dto.page, dto.limit),
      sources: [
        {
          key: sourceKey,
          outcome: records.length > 0 ? 'ok' : 'empty',
          count: records.length,
          tookMs: Date.now() - startedAt,
        },
      ],
      query: query.term,
      ...(query.capability ? { capability: query.capability } : {}),
      partial: false,
    };
  }

  /** Recupera um registro pelo identificador dentro de uma origem. */
  async findById(
    sourceKey: string,
    id: string,
    context: ConnectorContext,
  ): Promise<NormalizedRecord> {
    const connector = this.registry.get(sourceKey);

    if (!connector.findById) {
      throw new IntegrationException({
        code: ErrorCode.INTEGRATION_ERROR,
        message: `O conector "${sourceKey}" nao suporta busca por identificador.`,
        source: sourceKey,
        status: 501,
      });
    }

    const record = await connector.findById(id, context);

    if (!record) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: `Nenhum registro "${id}" encontrado em "${sourceKey}".`,
      });
    }

    return record;
  }

  /**
   * Executa um conector isolando a falha: qualquer erro vira diagnostico, nunca
   * excecao propagada. O timeout aqui e um teto adicional ao do cliente HTTP.
   */
  private async runConnector(
    connector: DataConnector,
    query: ConnectorQuery,
    context: ConnectorContext,
  ): Promise<ConnectorRun> {
    const key = connector.metadata.key;
    const startedAt = Date.now();

    try {
      const records = await this.withTimeout(
        connector.search(query, context),
        this.config.search.timeoutMs,
        key,
      );

      return {
        records,
        outcome: {
          key,
          outcome: records.length > 0 ? 'ok' : 'empty',
          count: records.length,
          tookMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      const isTimeout = error instanceof SearchTimeoutError;
      const tookMs = Date.now() - startedAt;

      this.logger.warn(
        `[${context.requestId}] origem "${key}" falhou em ${tookMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        records: [],
        outcome: {
          key,
          outcome: isTimeout ? 'timeout' : 'error',
          count: 0,
          tookMs,
          error: error instanceof Error ? error.message : String(error),
          errorCode:
            error instanceof IntegrationException
              ? error.code
              : isTimeout
                ? ErrorCode.INTEGRATION_TIMEOUT
                : ErrorCode.INTEGRATION_ERROR,
        },
      };
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, key: string): Promise<T> {
    let timer: NodeJS.Timeout;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SearchTimeoutError(key, ms)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * Ordena pelo campo pedido, restrito aos campos textuais do registro.
   *
   * A lista fechada nao e so validacao de entrada: ela garante que o valor
   * comparado e sempre texto. Ordenar por `attributes` compararia objetos e
   * produziria uma ordem sem sentido.
   */
  private sort(
    records: NormalizedRecord[],
    sortBy: string | undefined,
    direction: string,
  ): NormalizedRecord[] {
    if (!sortBy || !isSortableField(sortBy)) {
      return records;
    }

    const factor = direction === 'desc' ? -1 : 1;

    return [...records].sort(
      (a, b) => (a[sortBy] ?? '').localeCompare(b[sortBy] ?? '', 'pt-BR') * factor,
    );
  }

  private skippedOutcomes(requested?: string[], used: string[] = []): SourceOutcomeDto[] {
    const pool = requested?.length ? requested : this.registry.enabled().map((c) => c.metadata.key);

    return pool
      .filter((key) => !used.includes(key))
      .map((key) => ({ key, outcome: 'skipped' as const, count: 0, tookMs: 0 }));
  }

  private emptyResult(
    dto: SearchQueryDto,
    query: ConnectorQuery,
    sources: SourceOutcomeDto[],
  ): SearchResultDto {
    return {
      items: [],
      pagination: buildPaginationMeta(0, dto.page, dto.limit),
      sources,
      query: query.term,
      ...(query.capability ? { capability: query.capability } : {}),
      partial: false,
    };
  }
}

/** Erro interno do teto de tempo do fan-out; nunca chega ao cliente. */
class SearchTimeoutError extends Error {
  constructor(key: string, ms: number) {
    super(`A origem "${key}" excedeu o tempo limite de ${ms}ms na busca federada.`);
    this.name = 'SearchTimeoutError';
  }
}
