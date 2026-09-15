import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { UolAdsConnector } from '../../integrations/connectors/uol-ads/uol-ads.connector';
import { AdsService, MAX_UNPAGINATED_ROWS } from './ads.service';
import { ALL_ROWS } from './dto/ads-query.dto';
import type { CampaignReportQueryDto, ListCampaignsQueryDto } from './dto/ads-query.dto';

describe('AdsService', () => {
  let service: AdsService;
  let connector: {
    isEnabled: jest.Mock;
    listCampaigns: jest.Mock;
    getCampaign: jest.Mock;
    getCampaignReport: jest.Mock;
    toFlatRow: jest.Mock;
  };

  const build = async (enabled: boolean) => {
    connector = {
      isEnabled: jest.fn().mockReturnValue(enabled),
      listCampaigns: jest
        .fn()
        .mockResolvedValue({ campaigns: [], statusSummary: {}, totalAvailable: 0 }),
      getCampaign: jest.fn().mockResolvedValue({ id: 1 }),
      getCampaignReport: jest.fn().mockResolvedValue({
        campaign: { id: 1, name: null },
        period: { startDate: '2026-08-01', endDate: '2026-08-31' },
        breakdown: 'date',
        creativeAvailable: true,
        rows: [],
        totals: { impressions: 0, clicks: 0, cost: 0, ctr: 0, cpc: 0, cpm: 0 },
      }),
      toFlatRow: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AdsService, { provide: UolAdsConnector, useValue: connector }],
    }).compile();

    service = moduleRef.get(AdsService);
  };

  const listQuery = { page: 1, limit: 20 } as ListCampaignsQueryDto;
  const reportQuery = {
    page: 1,
    limit: 20,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    breakdown: 'date',
    layout: 'nested',
  } as CampaignReportQueryDto;

  describe('conector sem credencial', () => {
    beforeEach(() => build(false));

    /**
     * Sem esta guarda a chamada seguia para a origem e voltava o 401 dela -
     * mensagem que culpa a plataforma por um problema de configuracao nossa.
     */
    it.each([
      ['listCampaigns', () => service.listCampaigns(listQuery)],
      ['getCampaign', () => service.getCampaign(1)],
      ['getCampaignReport', () => service.getCampaignReport(1, reportQuery)],
    ])('%s recusa antes de tocar a origem', async (_nome, call) => {
      await expect(call()).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(connector.listCampaigns).not.toHaveBeenCalled();
      expect(connector.getCampaign).not.toHaveBeenCalled();
      expect(connector.getCampaignReport).not.toHaveBeenCalled();
    });

    it('explica o que fazer, citando a variavel que falta', async () => {
      const erro = await service
        .listCampaigns(listQuery)
        .catch((e: ServiceUnavailableException) => e.getResponse());

      expect(erro).toMatchObject({
        code: 'INTEGRATION_UNAVAILABLE',
        source: 'uol-ads',
        message: expect.stringContaining('UOL_ADS_KEY'),
      });
    });
  });

  describe('conector configurado', () => {
    beforeEach(() => build(true));

    it('consulta a origem normalmente', async () => {
      await service.listCampaigns(listQuery);
      expect(connector.listCampaigns).toHaveBeenCalled();
    });

    it('permite o relatorio', async () => {
      await service.getCampaignReport(1, reportQuery);
      expect(connector.getCampaignReport).toHaveBeenCalled();
    });
  });

  describe('limit=all', () => {
    const linhas = (quantidade: number) =>
      Array.from({ length: quantidade }, (_, i) => ({
        date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
        campaignName: 'c',
        groupName: 'g',
        creativeName: 'cr',
        region: null,
        format: 'IMAGE',
        metrics: { impressions: 1, clicks: 0, cost: 0, ctr: 0, cpc: 0, cpm: 0 },
      }));

    const comLinhas = async (quantidade: number) => {
      await build(true);
      connector.getCampaignReport.mockResolvedValue({
        campaign: { id: 1, name: 'c' },
        period: { startDate: '2026-08-01', endDate: '2026-08-31' },
        breakdown: 'date',
        creativeAvailable: true,
        rows: linhas(quantidade),
        totals: { impressions: quantidade, clicks: 0, cost: 0, ctr: 0, cpc: 0, cpm: 0 },
      });
    };

    const queryAll = { ...reportQuery, limit: ALL_ROWS };

    it('devolve todas as linhas numa resposta so', async () => {
      await comLinhas(250);

      const resultado = await service.getCampaignReport(1, queryAll);

      expect(resultado.rows).toHaveLength(250);
      expect(resultado.pagination).toMatchObject({
        page: 1,
        total: 250,
        totalPages: 1,
        hasNextPage: false,
      });
    });

    it('consulta a origem uma unica vez', async () => {
      await comLinhas(250);
      await service.getCampaignReport(1, queryAll);

      // O ganho de `all`: a origem nao pagina, entao percorrer paginas
      // repetiria esta mesma chamada.
      expect(connector.getCampaignReport).toHaveBeenCalledTimes(1);
    });

    it('recusa acima do teto, em vez de truncar em silencio', async () => {
      await comLinhas(MAX_UNPAGINATED_ROWS + 1);

      // Uma resposta truncada sem aviso viraria relatorio errado; o limite da
      // Vercel (4,5 MB) tambem devolveria 500 sem explicacao util.
      await expect(service.getCampaignReport(1, queryAll)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('aceita exatamente o teto', async () => {
      await comLinhas(MAX_UNPAGINATED_ROWS);

      const resultado = await service.getCampaignReport(1, queryAll);
      expect(resultado.rows).toHaveLength(MAX_UNPAGINATED_ROWS);
    });

    it('a paginacao normal segue recortando', async () => {
      await comLinhas(250);

      const resultado = await service.getCampaignReport(1, {
        ...reportQuery,
        page: 2,
        limit: 100,
      });

      expect(resultado.rows).toHaveLength(100);
      expect(resultado.pagination).toMatchObject({ page: 2, total: 250, totalPages: 3 });
    });
  });
});
