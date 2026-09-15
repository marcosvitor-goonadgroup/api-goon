import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { UolAdsConnector } from '../../integrations/connectors/uol-ads/uol-ads.connector';
import { AdsService } from './ads.service';
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
});
