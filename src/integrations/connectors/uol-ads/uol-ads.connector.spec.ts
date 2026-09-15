import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../../config/app-config.service';
import { ResilientHttpService } from '../../../core/http/resilient-http.service';
import { UolAdsConnector } from './uol-ads.connector';
import { CampaignStatus, ReportBreakdown } from './uol-ads.model';
import type { UolAnalyticsRow, UolCampaign } from './uol-ads.types';

/** Amostra fiel da conta real: 2 finalizadas, 1 pausada, 1 pendente. */
const CAMPAIGNS: UolCampaign[] = [
  {
    id: 114964,
    name: 'jan_calix_sesc_maquininha',
    status: 'FINALIZADO',
    detailedStatus: 'Concluído',
    groups: [
      {
        id: 5000149200,
        name: 'leilao_cpm_display',
        status: 'FINALIZADO',
        detailedStatus: 'Concluído',
        startDate: '2026-01-16T00:00:00',
        endDate: '2026-02-15T00:00:00',
      },
    ],
  },
  { id: 115912, name: 'jul_radiola_cra-rj', status: 'FINALIZADO', detailedStatus: 'Concluído' },
  { id: 116001, name: 'jul_radiola_rio', status: 'PAUSADO', detailedStatus: 'Pausado' },
  { id: 116162, name: 'set_campanha_nova', status: 'PENDENTE', detailedStatus: 'Crie um anúncio' },
];

const ANALYTICS_ROW: UolAnalyticsRow = {
  date: '2026-08-01',
  campaignId: 115912,
  campaignName: 'jul_radiola_cra-rj',
  groupName: 'conjunto_awareness',
  creativeName: 'CRA_INSTITUCIONAL',
  format: 'IMAGE',
  totalImpressions: 155,
  totalClicks: 4,
  totalCost: 10,
  ctr: 2.58,
  avgCpc: 2.5,
  avgCpm: 64.5,
  avgCpv: 0,
  measurableImpressions: 155,
  viewableImpressions: 101,
  viewableImpressionsRate: 0.652,
  // A origem devolve estes campos nulos quando a campanha nao e de video.
  totalConversions: null,
  totalViewConversions: null,
  totalClickConversions: null,
  videoStart: null,
  videoComplete: null,
  vtr: null,
};

describe('UolAdsConnector', () => {
  let connector: UolAdsConnector;
  let http: { get: jest.Mock; getCircuitSnapshot: jest.Mock };

  const build = async (apiKey = 'chave-de-teste', enabled = true) => {
    http = {
      get: jest.fn(),
      getCircuitSnapshot: jest.fn().mockReturnValue({
        state: 'closed',
        failures: 0,
        lastFailureAt: null,
        retryAt: null,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UolAdsConnector,
        { provide: ResilientHttpService, useValue: http },
        {
          provide: AppConfigService,
          useValue: {
            http: { timeoutMs: 8000 },
            connectors: {
              uolAds: { enabled, baseUrl: 'https://api.ads.uol.com.br', apiKey, cacheTtlMs: 1000 },
            },
          },
        },
      ],
    }).compile();

    connector = moduleRef.get(UolAdsConnector);
  };

  beforeEach(() => build());

  describe('habilitacao', () => {
    it('fica desabilitado sem credencial, para nao disparar 401 em serie', async () => {
      await build('');
      expect(connector.isEnabled()).toBe(false);
    });

    it('fica desabilitado quando desligado por configuracao', async () => {
      await build('chave', false);
      expect(connector.isEnabled()).toBe(false);
    });

    it('habilita com credencial presente', () => {
      expect(connector.isEnabled()).toBe(true);
    });
  });

  describe('listCampaigns', () => {
    beforeEach(() => http.get.mockResolvedValue(CAMPAIGNS));

    it('NUNCA repassa o parametro status para a origem', async () => {
      // O filtro da origem e enganoso: status=ATIVO devolve campanhas ja
      // finalizadas. Classificamos aqui, a partir do estado real.
      await connector.listCampaigns({ status: CampaignStatus.ACTIVE });

      const params = http.get.mock.calls[0][0].params as Record<string, unknown> | undefined;
      expect(params?.status).toBeUndefined();
      expect(http.get.mock.calls[0][0].url).toBe('/campaigns');
    });

    it('envia a credencial no header Authorization', async () => {
      await connector.listCampaigns();

      expect(http.get.mock.calls[0][0].headers).toMatchObject({
        Authorization: 'chave-de-teste',
      });
    });

    it('nao coloca a credencial na chave de cache', async () => {
      await connector.listCampaigns();

      expect(String(http.get.mock.calls[0][0].cacheKey)).not.toContain('chave-de-teste');
    });

    it('traduz os status da origem para os valores normalizados', async () => {
      const { campaigns } = await connector.listCampaigns();

      expect(campaigns.map((c) => c.status)).toEqual([
        'completed',
        'completed',
        'paused',
        'pending',
      ]);
      expect(campaigns[0]).toMatchObject({
        id: 114964,
        status: CampaignStatus.COMPLETED,
        statusLabel: 'Concluído',
        rawStatus: 'FINALIZADO',
      });
    });

    it('filtra pelo estado normalizado', async () => {
      const { campaigns } = await connector.listCampaigns({ status: CampaignStatus.PAUSED });

      expect(campaigns).toHaveLength(1);
      expect(campaigns[0].id).toBe(116001);
    });

    it('conta o resumo sobre a base inteira, mesmo com filtro aplicado', async () => {
      const { statusSummary, totalAvailable } = await connector.listCampaigns({
        status: CampaignStatus.PAUSED,
      });

      expect(statusSummary).toEqual({ completed: 2, paused: 1, pending: 1 });
      expect(totalAvailable).toBe(4);
    });

    it('busca por nome ignorando caixa e acento', async () => {
      const { campaigns } = await connector.listCampaigns({ search: 'RADIOLA' });
      expect(campaigns.map((c) => c.id)).toEqual([115912, 116001]);
    });

    it('busca pelo ID exato', async () => {
      const { campaigns } = await connector.listCampaigns({ search: '116162' });
      expect(campaigns).toHaveLength(1);
      expect(campaigns[0].id).toBe(116162);
    });

    it('extrai a data dos grupos, descartando a parte de hora', async () => {
      const { campaigns } = await connector.listCampaigns();

      expect(campaigns[0].groups[0]).toMatchObject({
        id: 5000149200,
        startDate: '2026-01-16',
        endDate: '2026-02-15',
      });
      expect(campaigns[0].groupCount).toBe(1);
    });

    it('classifica status desconhecido como `unknown` em vez de quebrar', async () => {
      http.get.mockResolvedValue([{ id: 1, name: 'x', status: 'ESTADO_NOVO' }]);

      const { campaigns } = await connector.listCampaigns();
      expect(campaigns[0].status).toBe(CampaignStatus.UNKNOWN);
    });

    it('lida com resposta vazia da origem', async () => {
      http.get.mockResolvedValue(null);

      const { campaigns, totalAvailable } = await connector.listCampaigns();
      expect(campaigns).toEqual([]);
      expect(totalAvailable).toBe(0);
    });
  });

  describe('getCampaignReport', () => {
    const period = { startDate: '2026-08-01', endDate: '2026-08-31' };

    it('usa /analytics com CREATIVE_NAME quando o breakdown e por data', async () => {
      http.get.mockResolvedValue([ANALYTICS_ROW]);

      const report = await connector.getCampaignReport(115912, period);
      const call = http.get.mock.calls[0][0] as { url: string; params: Record<string, unknown> };

      expect(call.url).toBe('/report/metrics/analytics');
      expect(call.params.dimensions).toContain('CREATIVE_NAME');
      expect(call.params.campaignIds).toEqual([115912]);
      expect(report.creativeAvailable).toBe(true);
      expect(report.rows[0].creativeName).toBe('CRA_INSTITUCIONAL');
    });

    it('usa /regions SEM CREATIVE_NAME quando o breakdown e por localidade', async () => {
      // A origem responde 400 se receber dimensao de criativo aqui.
      http.get.mockResolvedValue([{ date: '2026-08-01', region: 'RJ', totalImpressions: 10 }]);

      const report = await connector.getCampaignReport(115912, {
        ...period,
        breakdown: ReportBreakdown.REGION,
        regions: ['RJ', 'SP'],
      });
      const call = http.get.mock.calls[0][0] as { url: string; params: Record<string, unknown> };

      expect(call.url).toBe('/report/metrics/regions');
      expect(call.params.dimensions).not.toContain('CREATIVE_NAME');
      expect(call.params.regions).toEqual(['RJ', 'SP']);
      expect(report.creativeAvailable).toBe(false);
      expect(report.rows[0].region).toBe('RJ');
      expect(report.rows[0].creativeName).toBeNull();
    });

    it('so envia `regions` no breakdown por localidade', async () => {
      http.get.mockResolvedValue([]);

      await connector.getCampaignReport(115912, { ...period, regions: ['SP'] });

      const params = http.get.mock.calls[0][0].params as Record<string, unknown>;
      expect(params.regions).toBeUndefined();
    });

    it('repassa o filtro de conjuntos de anuncios', async () => {
      http.get.mockResolvedValue([]);

      await connector.getCampaignReport(115912, { ...period, groupIds: [500, 501] });

      expect(http.get.mock.calls[0][0].params.groupIds).toEqual([500, 501]);
    });

    it('omite os blocos de video e conversao quando a origem devolve nulos', async () => {
      http.get.mockResolvedValue([ANALYTICS_ROW]);

      const report = await connector.getCampaignReport(115912, period);

      expect(report.rows[0]).not.toHaveProperty('video');
      expect(report.rows[0]).not.toHaveProperty('conversions');
      expect(report.rows[0].metrics.viewabilityRate).toBe(0.652);
    });

    it('inclui os blocos quando ha dado de video e conversao', async () => {
      http.get.mockResolvedValue([
        { ...ANALYTICS_ROW, videoStart: 100, videoComplete: 70, totalConversions: 5 },
      ]);

      const report = await connector.getCampaignReport(115912, period);

      expect(report.rows[0].video).toEqual({ starts: 100, completions: 70 });
      expect(report.rows[0].conversions).toEqual({ total: 5 });
    });

    it('calcula os totais sobre todas as linhas, recalculando as taxas', async () => {
      http.get.mockResolvedValue([
        { ...ANALYTICS_ROW, totalImpressions: 1000, totalClicks: 10, totalCost: 20, ctr: 1 },
        { ...ANALYTICS_ROW, totalImpressions: 1000, totalClicks: 30, totalCost: 30, ctr: 3 },
      ]);

      const report = await connector.getCampaignReport(115912, period);

      expect(report.totals.impressions).toBe(2000);
      expect(report.totals.clicks).toBe(40);
      expect(report.totals.cost).toBe(50);
      // Taxa derivada dos somatorios - nao a media de 1 e 3.
      expect(report.totals.ctr).toBe(2);
      expect(report.totals.cpc).toBe(1.25);
      expect(report.totals.cpm).toBe(25);
    });

    it('devolve o nome da campanha em cada linha', async () => {
      http.get.mockResolvedValue([ANALYTICS_ROW]);

      const report = await connector.getCampaignReport(115912, period);

      expect(report.rows[0].campaignName).toBe('jul_radiola_cra-rj');
    });

    it('nao divide por zero quando o periodo nao tem dados', async () => {
      http.get.mockResolvedValue([]);

      const report = await connector.getCampaignReport(115912, period);

      expect(report.rows).toEqual([]);
      expect(report.totals).toMatchObject({ impressions: 0, clicks: 0, cost: 0, ctr: 0, cpc: 0 });
      expect(report.campaign.name).toBeNull();
    });
  });

  describe('toFlatRow (layout tabular)', () => {
    const period = { startDate: '2026-08-01', endDate: '2026-08-31' };

    it('mantem todas as colunas, usando null para o que a origem nao mediu', async () => {
      http.get.mockResolvedValue([ANALYTICS_ROW]);

      const report = await connector.getCampaignReport(115912, period);
      const flat = connector.toFlatRow(report.rows[0]);

      // Uma planilha precisa do mesmo cabecalho em toda linha: as colunas de
      // video existem mesmo numa campanha que nao e de video.
      expect(Object.keys(flat)).toEqual([
        'date',
        'campaignName',
        'groupName',
        'creativeName',
        'region',
        'format',
        'impressions',
        'clicks',
        'cost',
        'views',
        'views25',
        'views50',
        'views75',
        'views100',
        'trueViews',
        'viewableImpressions',
        'viewabilityRate',
        'conversions',
        'ctr',
        'cpc',
        'cpm',
      ]);

      expect(flat).toMatchObject({
        date: '2026-08-01',
        campaignName: 'jul_radiola_cra-rj',
        groupName: 'conjunto_awareness',
        creativeName: 'CRA_INSTITUCIONAL',
        impressions: 155,
        clicks: 4,
        viewableImpressions: 101,
        viewabilityRate: 0.652,
        views: null,
        views100: null,
        conversions: null,
      });
    });

    it('preenche as colunas de video e conversao quando ha dado', async () => {
      http.get.mockResolvedValue([
        {
          ...ANALYTICS_ROW,
          videoStart: 500,
          videoFirstQuartile: 400,
          videoMidpoint: 300,
          videoThirdQuartile: 250,
          videoComplete: 200,
          trueView: 180,
          totalConversions: 7,
        },
      ]);

      const report = await connector.getCampaignReport(115912, period);
      const flat = connector.toFlatRow(report.rows[0]);

      expect(flat).toMatchObject({
        views: 500,
        views25: 400,
        views50: 300,
        views75: 250,
        views100: 200,
        trueViews: 180,
        conversions: 7,
      });
    });

    it('zera as colunas indisponiveis no corte por localidade', async () => {
      http.get.mockResolvedValue([
        {
          date: '2026-08-01',
          campaignName: 'c',
          groupName: 'g',
          region: 'RJ',
          totalImpressions: 10,
        },
      ]);

      const report = await connector.getCampaignReport(115912, {
        ...period,
        breakdown: ReportBreakdown.REGION,
      });
      const flat = connector.toFlatRow(report.rows[0]);

      expect(flat.region).toBe('RJ');
      expect(flat.impressions).toBe(10);
      expect(flat.creativeName).toBeNull();
      expect(flat.viewabilityRate).toBeNull();
      expect(flat.views100).toBeNull();
      expect(flat.conversions).toBeNull();
    });
  });

  describe('busca federada', () => {
    it('atende consultas da capability declarada', () => {
      expect(connector.supports({ term: 'x', capability: 'ad-campaign' })).toBe(true);
      expect(connector.supports({ term: 'x', capability: 'cep' })).toBe(false);
    });

    it('atende ID numerico e termos com 3+ caracteres', () => {
      expect(connector.supports({ term: '115912' })).toBe(true);
      expect(connector.supports({ term: 'rad' })).toBe(true);
      expect(connector.supports({ term: 'ab' })).toBe(false);
    });

    it('aceita ID numerico de qualquer tamanho', () => {
      // IDs de campanha tem 6 digitos e os de grupo 10; nao ha faixa reservada.
      expect(connector.supports({ term: '11' })).toBe(true);
      expect(connector.supports({ term: '5000149200' })).toBe(true);
    });

    it('responde apenas pela capability que anuncia', () => {
      expect(connector.supports({ term: 'radiola', capability: 'ad-campaign' })).toBe(true);
      expect(connector.supports({ term: 'radiola', capability: 'cep' })).toBe(false);
    });

    it('devolve campanhas no formato normalizado da busca', async () => {
      http.get.mockResolvedValue(CAMPAIGNS);

      const [record] = await connector.search({ term: 'radiola' }, { requestId: 'req-1' });

      expect(record).toMatchObject({
        id: '115912',
        type: 'ad-campaign',
        source: 'uol-ads',
        subtitle: 'Concluído',
      });
      expect(record.attributes).toMatchObject({ status: 'completed', isRunning: false });
    });

    it('recusa identificador nao numerico sem chamar a origem', async () => {
      const result = await connector.findById('abc', { requestId: 'req-1' });

      expect(result).toBeNull();
      expect(http.get).not.toHaveBeenCalled();
    });
  });
});
