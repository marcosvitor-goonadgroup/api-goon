import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../config/app-config.service';
import { ErrorCode } from '../../common/constants';
import { IntegrationException } from '../../common/exceptions/integration.exception';
import type {
  ConnectorContext,
  ConnectorQuery,
  DataConnector,
  NormalizedRecord,
} from '../../integrations/contracts/connector.contract';
import { ConnectorRegistryService } from '../../integrations/registry/connector-registry.service';
import { SortDirection } from '../../common/dto/pagination.dto';
import type { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

/** Conector controlavel, para exercitar cada caminho do fan-out. */
function makeConnector(
  key: string,
  behaviour: {
    records?: NormalizedRecord[];
    error?: Error;
    delayMs?: number;
    supports?: boolean;
  } = {},
): DataConnector {
  return {
    metadata: {
      key,
      label: key,
      description: '',
      capabilities: ['teste'],
      baseUrl: `https://${key}.example.com`,
      requiresCredentials: false,
    },
    isEnabled: () => true,
    supports: () => behaviour.supports ?? true,
    search: jest.fn(async () => {
      if (behaviour.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
      }
      if (behaviour.error) {
        throw behaviour.error;
      }
      return behaviour.records ?? [];
    }),
    health: jest.fn(),
  };
}

function makeRecord(source: string, title: string): NormalizedRecord {
  return {
    id: `${source}-${title}`,
    type: 'teste',
    title,
    source,
    attributes: {},
    retrievedAt: new Date().toISOString(),
  };
}

const query = (overrides: Partial<SearchQueryDto> = {}): SearchQueryDto =>
  ({
    q: 'termo',
    page: 1,
    limit: 20,
    sortOrder: SortDirection.ASC,
    ...overrides,
  }) as SearchQueryDto;

const context: ConnectorContext = { requestId: 'req-teste' };

describe('SearchService', () => {
  let service: SearchService;
  let registry: { resolveFor: jest.Mock; enabled: jest.Mock; get: jest.Mock };

  const buildService = async (searchTimeoutMs = 5_000) => {
    registry = {
      resolveFor: jest.fn(),
      enabled: jest.fn().mockReturnValue([]),
      get: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ConnectorRegistryService, useValue: registry },
        { provide: AppConfigService, useValue: { search: { timeoutMs: searchTimeoutMs } } },
      ],
    }).compile();

    service = moduleRef.get(SearchService);
  };

  beforeEach(() => buildService());

  describe('busca federada', () => {
    it('agrega os registros de todas as origens consultadas', async () => {
      registry.resolveFor.mockReturnValue([
        makeConnector('fonte-a', { records: [makeRecord('fonte-a', 'Alfa')] }),
        makeConnector('fonte-b', { records: [makeRecord('fonte-b', 'Beta')] }),
      ]);

      const result = await service.search(query(), context);

      expect(result.items).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.partial).toBe(false);
      expect(result.sources.map((s) => s.outcome)).toEqual(['ok', 'ok']);
    });

    it('mantem a resposta quando uma origem falha e sinaliza resultado parcial', async () => {
      registry.resolveFor.mockReturnValue([
        makeConnector('fonte-ok', { records: [makeRecord('fonte-ok', 'Alfa')] }),
        makeConnector('fonte-ruim', { error: new Error('conexao recusada') }),
      ]);

      const result = await service.search(query(), context);

      // O essencial: a falha de uma origem nao derruba a busca inteira.
      expect(result.items).toHaveLength(1);
      expect(result.partial).toBe(true);

      const falha = result.sources.find((s) => s.key === 'fonte-ruim');
      expect(falha?.outcome).toBe('error');
      expect(falha?.error).toContain('conexao recusada');
      expect(falha?.errorCode).toBe(ErrorCode.INTEGRATION_ERROR);
    });

    it('preserva o codigo de erro quando a falha ja vem classificada', async () => {
      registry.resolveFor.mockReturnValue([
        makeConnector('fonte-fora', {
          error: new IntegrationException({
            code: ErrorCode.INTEGRATION_UNAVAILABLE,
            message: 'circuito aberto',
            source: 'fonte-fora',
          }),
        }),
      ]);

      const result = await service.search(query(), context);

      expect(result.sources[0].errorCode).toBe(ErrorCode.INTEGRATION_UNAVAILABLE);
    });

    it('corta a origem que excede o tempo limite sem travar as demais', async () => {
      await buildService(50);

      registry.resolveFor.mockReturnValue([
        makeConnector('rapida', { records: [makeRecord('rapida', 'Alfa')] }),
        makeConnector('lenta', { delayMs: 500, records: [makeRecord('lenta', 'Beta')] }),
      ]);

      const result = await service.search(query(), context);

      expect(result.items).toHaveLength(1);
      expect(result.partial).toBe(true);
      expect(result.sources.find((s) => s.key === 'lenta')?.outcome).toBe('timeout');
      expect(result.sources.find((s) => s.key === 'lenta')?.errorCode).toBe(
        ErrorCode.INTEGRATION_TIMEOUT,
      );
    });

    it('marca como `empty` a origem que responde sem resultados', async () => {
      registry.resolveFor.mockReturnValue([makeConnector('vazia', { records: [] })]);

      const result = await service.search(query(), context);

      expect(result.sources[0].outcome).toBe('empty');
      expect(result.partial).toBe(false);
    });

    it('reporta como `skipped` as origens que nao atendem a consulta', async () => {
      registry.resolveFor.mockReturnValue([]);
      registry.enabled.mockReturnValue([makeConnector('fora-de-escopo')]);

      const result = await service.search(query(), context);

      expect(result.items).toHaveLength(0);
      expect(result.sources).toEqual([
        { key: 'fora-de-escopo', outcome: 'skipped', count: 0, tookMs: 0 },
      ]);
    });

    it('repassa termo, capability e filtros ao conector', async () => {
      const connector = makeConnector('fonte-a');
      registry.resolveFor.mockReturnValue([connector]);

      await service.search(
        query({ q: '  115912  ', capability: 'ad-campaign', filters: { uf: 'SP' } }),
        context,
      );

      expect(connector.search).toHaveBeenCalledWith(
        expect.objectContaining<Partial<ConnectorQuery>>({
          term: '115912',
          capability: 'ad-campaign',
          filters: { uf: 'SP' },
        }),
        context,
      );
    });

    it('pagina o resultado agregado', async () => {
      registry.resolveFor.mockReturnValue([
        makeConnector('fonte-a', {
          records: Array.from({ length: 5 }, (_, i) => makeRecord('fonte-a', `Item ${i}`)),
        }),
      ]);

      const result = await service.search(query({ page: 2, limit: 2 }), context);

      expect(result.items).toHaveLength(2);
      expect(result.pagination).toMatchObject({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('ordena pelo campo pedido', async () => {
      registry.resolveFor.mockReturnValue([
        makeConnector('fonte-a', {
          records: [
            makeRecord('fonte-a', 'Zulu'),
            makeRecord('fonte-a', 'Alfa'),
            makeRecord('fonte-a', 'Mike'),
          ],
        }),
      ]);

      const result = await service.search(
        query({ sortBy: 'title', sortOrder: SortDirection.DESC }),
        context,
      );

      expect(result.items.map((item) => item.title)).toEqual(['Zulu', 'Mike', 'Alfa']);
    });
  });

  describe('busca direcionada', () => {
    it('propaga o erro da origem escolhida explicitamente', async () => {
      const erro = new IntegrationException({
        code: ErrorCode.INTEGRATION_ERROR,
        message: 'origem fora do ar',
        source: 'fonte-a',
      });
      registry.get.mockReturnValue(makeConnector('fonte-a', { error: erro }));

      // Diferente do fan-out: aqui mascarar a falha como "sem resultados"
      // esconderia do cliente que a origem que ele pediu esta quebrada.
      await expect(service.searchOne('fonte-a', query(), context)).rejects.toThrow(erro);
    });

    it('devolve o resultado da unica origem consultada', async () => {
      registry.get.mockReturnValue(
        makeConnector('fonte-a', { records: [makeRecord('fonte-a', 'Alfa')] }),
      );

      const result = await service.searchOne('fonte-a', query(), context);

      expect(result.items).toHaveLength(1);
      expect(result.sources).toEqual([
        expect.objectContaining({ key: 'fonte-a', outcome: 'ok', count: 1 }),
      ]);
    });
  });

  describe('busca por identificador', () => {
    it('devolve 404 quando o registro nao existe na origem', async () => {
      registry.get.mockReturnValue({
        ...makeConnector('fonte-a'),
        findById: jest.fn().mockResolvedValue(null),
      });

      await expect(service.findById('fonte-a', 'inexistente', context)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('rejeita conectores que nao suportam busca por identificador', async () => {
      registry.get.mockReturnValue(makeConnector('fonte-a'));

      await expect(service.findById('fonte-a', '123', context)).rejects.toBeInstanceOf(
        IntegrationException,
      );
    });
  });
});
