import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/app.setup';
import { ResilientHttpService } from '../src/core/http/resilient-http.service';

/**
 * Testes de ponta a ponta.
 *
 * O `ResilientHttpService` e substituido por um dublê: os testes exercitam a
 * API inteira (rotas, validacao, guards, envelope, tratamento de erro) sem
 * depender de rede nem da disponibilidade de terceiros - o que manteria a
 * suite lenta e intermitente.
 */
describe('api-goon (e2e)', () => {
  let app: INestApplication;
  let http: { get: jest.Mock; request: jest.Mock; getCircuitSnapshot: jest.Mock };

  beforeAll(async () => {
    // Ambiente determinístico, independente do .env da maquina.
    process.env.NODE_ENV = 'test';
    process.env.API_KEYS = '';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.LOG_LEVEL = 'fatal';
    process.env.RATE_LIMIT_MAX = '1000';
    // Credencial de teste: sem ela o conector do UOL se desabilita e as rotas
    // de midia responderiam 404.
    process.env.UOL_ADS_KEY = 'chave-e2e';

    http = {
      get: jest.fn(),
      request: jest.fn(),
      getCircuitSnapshot: jest.fn().mockReturnValue({
        state: 'closed',
        failures: 0,
        lastFailureAt: null,
        retryAt: null,
      }),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ResilientHttpService)
      .useValue(http)
      .compile();

    // `logger: false`: os testes de erro exercitam o caminho de 5xx de
    // proposito, e o stack correspondente so poluiria a saida da suite.
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('rotas de sistema', () => {
    it('GET / apresenta a API e as integracoes ativas', async () => {
      const { body } = await request(app.getHttpServer()).get('/').expect(200);

      expect(body).toMatchObject({
        success: true,
        data: {
          name: 'api-goon',
          basePath: '/api/v1',
          integrations: ['uol-ads'],
        },
      });
      expect(body.meta.requestId).toEqual(expect.any(String));
    });

    it('GET /health/live responde sem consultar integracoes', async () => {
      const { body } = await request(app.getHttpServer()).get('/health/live').expect(200);

      // Formato do Terminus, sem o envelope padrao.
      expect(body.status).toBe('ok');
      expect(body.details.memory_heap.status).toBe('up');
      expect(body).not.toHaveProperty('success');
    });

    it('devolve o x-request-id recebido, para correlacao ponta a ponta', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .set('x-request-id', 'meu-id-externo')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('meu-id-externo');
      expect(response.body.meta.requestId).toBe('meu-id-externo');
    });

    it('devolve 404 no envelope padrao para rota inexistente', async () => {
      const { body } = await request(app.getHttpServer()).get('/api/v1/nao-existe').expect(404);

      expect(body).toMatchObject({ success: false, statusCode: 404 });
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('catalogo de integracoes', () => {
    it('GET /integrations lista os conectores registrados', async () => {
      const { body } = await request(app.getHttpServer()).get('/api/v1/integrations').expect(200);

      const chaves = body.data.map((item: { key: string }) => item.key);
      expect(chaves).toEqual(['uol-ads']);
    });

    it('GET /integrations/capabilities agrega as capabilities sem repetir', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/integrations/capabilities')
        .expect(200);

      expect(body.data).toEqual(['ad-campaign']);
      expect(new Set(body.data).size).toBe(body.data.length);
    });

    it('GET /integrations/{key} detalha um conector', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/integrations/uol-ads')
        .expect(200);

      expect(body.data).toMatchObject({ key: 'uol-ads', enabled: true, requiresCredentials: true });
    });

    it('devolve 404 com as opcoes validas quando o conector nao existe', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/integrations/inexistente')
        .expect(404);

      expect(body.error.code).toBe('INTEGRATION_NOT_FOUND');
      expect(body.error.details.available).toEqual(['uol-ads']);
    });
  });

  describe('busca federada', () => {
    const CAMPANHAS_BUSCA = [
      { id: 115912, name: 'jul_radiola_cra-rj', status: 'FINALIZADO', detailedStatus: 'Concluido' },
      { id: 116001, name: 'jul_radiola_rio', status: 'PAUSADO', detailedStatus: 'Pausado' },
    ];

    it('consulta a origem compativel e normaliza os resultados', async () => {
      http.get.mockResolvedValue(CAMPANHAS_BUSCA);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'radiola' })
        .expect(200);

      expect(body.data.items).toHaveLength(2);
      expect(body.data.items.map((i: { source: string }) => i.source)).toEqual([
        'uol-ads',
        'uol-ads',
      ]);
      // Envelope uniforme, independente do formato que a origem devolve.
      body.data.items.forEach((item: Record<string, unknown>) => {
        expect(item).toMatchObject({ type: 'ad-campaign' });
        expect(item.id).toEqual(expect.any(String));
      });
      expect(body.data.partial).toBe(false);
    });

    it('marca a resposta como parcial quando a origem falha', async () => {
      http.get.mockRejectedValue(new Error('origem indisponivel'));

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'radiola' })
        .expect(200);

      // A busca nao derruba a requisicao: devolve 200 sinalizando o que falhou.
      expect(body.data.items).toHaveLength(0);
      expect(body.data.partial).toBe(true);
      expect(body.data.sources.find((s: { key: string }) => s.key === 'uol-ads').outcome).toBe(
        'error',
      );
    });

    it('restringe a busca as origens informadas em `sources`', async () => {
      http.get.mockResolvedValue(CAMPANHAS_BUSCA);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'radiola', sources: 'uol-ads' })
        .expect(200);

      expect(body.data.sources).toHaveLength(1);
      expect(body.data.sources[0].key).toBe('uol-ads');
    });

    it('marca como `skipped` a origem que nao atende a consulta', async () => {
      http.get.mockResolvedValue(CAMPANHAS_BUSCA);
      // Zera o historico acumulado pelos casos anteriores para poder afirmar
      // que esta consulta nao tocou a origem.
      http.get.mockClear();

      // Termo curto demais para busca por nome: o conector se declara
      // incompativel em vez de consultar a origem a toa.
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'ab' })
        .expect(200);

      const uolAds = body.data.sources.find((s: { key: string }) => s.key === 'uol-ads');
      expect(uolAds.outcome).toBe('skipped');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('inclui o payload original quando `includeRaw=true`', async () => {
      http.get.mockResolvedValue(CAMPANHAS_BUSCA);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'radiola', includeRaw: 'true' })
        .expect(200);

      expect(body.data.items[0].raw).toMatchObject({ id: 115912 });
    });

    it('omite o payload original por padrao', async () => {
      http.get.mockResolvedValue(CAMPANHAS_BUSCA);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'radiola' })
        .expect(200);

      expect(body.data.items[0]).not.toHaveProperty('raw');
    });

    it('propaga o erro quando a origem foi escolhida explicitamente', async () => {
      http.get.mockRejectedValue(new Error('origem fora do ar'));

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search/uol-ads')
        .query({ q: 'radiola' })
        .expect(500);

      expect(body.success).toBe(false);
    });
  });

  describe('midia - UOL Ads', () => {
    const CAMPAIGNS = [
      { id: 114964, name: 'jan_calix_sesc', status: 'FINALIZADO', detailedStatus: 'Concluido' },
      { id: 115912, name: 'jul_radiola_cra-rj', status: 'FINALIZADO', detailedStatus: 'Concluido' },
      { id: 116001, name: 'jul_radiola_rio', status: 'PAUSADO', detailedStatus: 'Pausado' },
      { id: 116162, name: 'set_nova', status: 'PENDENTE', detailedStatus: 'Crie um anuncio' },
    ];

    const REPORT_ROW = {
      date: '2026-08-01',
      campaignId: 115912,
      campaignName: 'jul_radiola_cra-rj',
      groupName: 'conjunto_awareness',
      creativeName: 'CRA_INSTITUCIONAL',
      totalImpressions: 155,
      totalClicks: 4,
      totalCost: 10,
      ctr: 2.58,
    };

    it('lista campanhas com o resumo de estados da conta inteira', async () => {
      http.get.mockResolvedValue(CAMPAIGNS);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns')
        .expect(200);

      expect(body.data.statusSummary).toEqual({ completed: 2, paused: 1, pending: 1 });
      expect(body.data.totalAvailable).toBe(4);
      expect(body.data.items[0]).toMatchObject({
        id: 114964,
        status: 'completed',
        rawStatus: 'FINALIZADO',
      });
    });

    it('filtra por estado sem alterar o resumo', async () => {
      http.get.mockResolvedValue(CAMPAIGNS);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns')
        .query({ status: 'paused' })
        .expect(200);

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].id).toBe(116001);
      // O resumo continua descrevendo a conta toda.
      expect(body.data.statusSummary.completed).toBe(2);
    });

    it('rejeita estado invalido', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns')
        .query({ status: 'encerrada' })
        .expect(400);

      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('devolve o relatorio por data com conjunto e criativo', async () => {
      http.get.mockResolvedValue([REPORT_ROW]);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({ startDate: '2026-08-01', endDate: '2026-08-31' })
        .expect(200);

      expect(body.data.breakdown).toBe('date');
      expect(body.data.creativeAvailable).toBe(true);
      expect(body.data.rows[0]).toMatchObject({
        date: '2026-08-01',
        groupName: 'conjunto_awareness',
        creativeName: 'CRA_INSTITUCIONAL',
        region: null,
      });
      expect(body.data.totals.impressions).toBe(155);
    });

    it('devolve o relatorio por localidade, sinalizando a ausencia de criativo', async () => {
      http.get.mockResolvedValue([{ ...REPORT_ROW, creativeName: undefined, region: 'RJ' }]);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({ startDate: '2026-08-01', endDate: '2026-08-31', breakdown: 'region' })
        .expect(200);

      expect(body.data.creativeAvailable).toBe(false);
      expect(body.data.rows[0].region).toBe('RJ');
      expect(body.data.rows[0].creativeName).toBeNull();
    });

    it('devolve linhas tabulares com `layout=flat`', async () => {
      http.get.mockResolvedValue([REPORT_ROW]);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({ startDate: '2026-08-01', endDate: '2026-08-31', layout: 'flat' })
        .expect(200);

      expect(body.data.layout).toBe('flat');
      expect(body.data.unavailableFields).toEqual([]);
      expect(body.data.rows[0]).toMatchObject({
        date: '2026-08-01',
        campaignName: 'jul_radiola_cra-rj',
        groupName: 'conjunto_awareness',
        creativeName: 'CRA_INSTITUCIONAL',
        impressions: 155,
        clicks: 4,
      });
      // Colunas de video existem mesmo sem dado, para o cabecalho ser estavel.
      expect(body.data.rows[0]).toHaveProperty('views100', null);
      expect(body.data.rows[0]).toHaveProperty('conversions', null);
    });

    it('avisa quais colunas a plataforma nao entrega por localidade', async () => {
      http.get.mockResolvedValue([{ ...REPORT_ROW, creativeName: undefined, region: 'RJ' }]);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          breakdown: 'region',
          layout: 'flat',
        })
        .expect(200);

      expect(body.data.unavailableFields).toEqual(
        expect.arrayContaining(['creativeName', 'views100', 'viewabilityRate', 'conversions']),
      );
      expect(body.data.rows[0].region).toBe('RJ');
    });

    it('exige o periodo', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .expect(400);

      expect(body.error.details.issues.join(' ')).toContain('startDate');
    });

    it('rejeita periodo invertido antes de chamar a origem', async () => {
      http.get.mockClear();

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({ startDate: '2026-08-31', endDate: '2026-08-01' })
        .expect(400);

      expect(body.error.message).toContain('anterior ou igual');
      expect(http.get).not.toHaveBeenCalled();
    });

    it('rejeita UF invalida antes de chamar a origem', async () => {
      http.get.mockClear();

      await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          breakdown: 'region',
          regions: 'XX',
        })
        .expect(400);

      expect(http.get).not.toHaveBeenCalled();
    });

    it('recusa `regions` fora do breakdown por localidade, em vez de ignorar', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/ads/uol/campaigns/115912/report')
        .query({ startDate: '2026-08-01', endDate: '2026-08-31', regions: 'SP' })
        .expect(400);

      expect(body.error.message).toContain('breakdown=region');
    });

    it('participa da busca federada', async () => {
      http.get.mockResolvedValue(CAMPAIGNS);

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'radiola', capability: 'ad-campaign' })
        .expect(200);

      const uol = body.data.sources.find((s: { key: string }) => s.key === 'uol-ads');
      expect(uol.outcome).toBe('ok');
      expect(body.data.items[0]).toMatchObject({ type: 'ad-campaign', source: 'uol-ads' });
    });
  });

  describe('validacao de entrada', () => {
    it('exige o termo de busca', async () => {
      const { body } = await request(app.getHttpServer()).get('/api/v1/search').expect(400);

      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejeita parametro desconhecido em vez de ignora-lo', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'teste', parametroInventado: 'x' })
        .expect(400);

      expect(body.error.details.issues.join(' ')).toContain('parametroInventado');
    });

    it('valida os limites da paginacao', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/search')
        .query({ q: 'teste', limit: 500 })
        .expect(400);

      expect(body.error.details.issues.join(' ')).toContain('limit');
    });
  });
});
