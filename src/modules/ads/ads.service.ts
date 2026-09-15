import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ErrorCode } from '../../common/constants';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { UolAdsConnector } from '../../integrations/connectors/uol-ads/uol-ads.connector';
import {
  REGION_UNAVAILABLE_FIELDS,
  ReportBreakdown,
  ReportLayout,
} from '../../integrations/connectors/uol-ads/uol-ads.model';
import { ALL_ROWS } from './dto/ads-query.dto';
import type { CampaignReportQueryDto, ListCampaignsQueryDto } from './dto/ads-query.dto';

/**
 * Teto para `limit=all`.
 *
 * A resposta de uma Vercel Function nao pode passar de 4,5 MB - acima disso a
 * plataforma devolve 500 sem que a aplicacao consiga tratar. Uma linha do
 * relatorio ocupa cerca de 490 bytes, entao 5000 linhas ficam em torno de
 * 2,4 MB: folgado o bastante para praticamente todo periodo, e longe do limite.
 * Acima disso preferimos um erro explicativo a uma resposta truncada em
 * silencio, que produziria um relatorio errado sem ninguem perceber.
 */
export const MAX_UNPAGINATED_ROWS = 5000;
import type { CampaignListDto, CampaignReportDto } from './dto/ads-response.dto';

/**
 * Orquestra as consultas de midia sobre o conector do UOL Ads.
 *
 * O conector cuida do acesso e da normalizacao; aqui ficam as regras da nossa
 * API: validacao de periodo, paginacao e montagem da resposta.
 */
@Injectable()
export class AdsService {
  constructor(private readonly uolAds: UolAdsConnector) {}

  async listCampaigns(query: ListCampaignsQueryDto): Promise<CampaignListDto> {
    this.assertConnectorReady();

    const { campaigns, statusSummary, totalAvailable } = await this.uolAds.listCampaigns({
      status: query.status,
      search: query.search,
    });

    const start = (query.page - 1) * query.limit;

    return {
      items: campaigns.slice(start, start + query.limit),
      pagination: buildPaginationMeta(campaigns.length, query.page, query.limit),
      statusSummary,
      totalAvailable,
    };
  }

  async getCampaign(id: number) {
    this.assertConnectorReady();

    const campaign = await this.uolAds.getCampaign(id);

    if (!campaign) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: `Campanha ${id} nao encontrada no UOL Ads.`,
      });
    }

    return campaign;
  }

  async getCampaignReport(
    campaignId: number,
    query: CampaignReportQueryDto,
  ): Promise<CampaignReportDto> {
    this.assertConnectorReady();
    this.assertPeriod(query.startDate, query.endDate);
    this.assertRegionsUsage(query);

    const report = await this.uolAds.getCampaignReport(campaignId, {
      startDate: query.startDate,
      endDate: query.endDate,
      breakdown: query.breakdown,
      regions: query.regions,
      groupIds: query.groupIds,
    });

    const fetchAll = query.limit === ALL_ROWS;

    if (fetchAll && report.rows.length > MAX_UNPAGINATED_ROWS) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message:
          `O periodo tem ${report.rows.length} linhas, acima do maximo de ${MAX_UNPAGINATED_ROWS} para uma resposta unica. ` +
          'Reduza o periodo, filtre por `groupIds`, ou pagine com `limit=100`.',
        details: { rows: report.rows.length, maxRows: MAX_UNPAGINATED_ROWS },
      });
    }

    const start = fetchAll ? 0 : (query.page - 1) * query.limit;
    const page = fetchAll ? report.rows : report.rows.slice(start, start + query.limit);
    const isRegion = report.breakdown === ReportBreakdown.REGION;

    return {
      campaign: report.campaign,
      period: report.period,
      breakdown: report.breakdown,
      layout: query.layout,
      creativeAvailable: report.creativeAvailable,
      /**
       * Diz de antemao quais colunas virao vazias neste corte, para o
       * consumidor nao montar um relatorio contando com dado que a origem
       * nao entrega por localidade.
       */
      unavailableFields: isRegion ? [...REGION_UNAVAILABLE_FIELDS] : [],
      rows:
        query.layout === ReportLayout.FLAT ? page.map((row) => this.uolAds.toFlatRow(row)) : page,
      pagination: fetchAll
        ? {
            page: 1,
            limit: report.rows.length,
            total: report.rows.length,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          }
        : buildPaginationMeta(report.rows.length, query.page, query.limit),
      totals: report.totals,
    };
  }

  /**
   * Recusa a chamada quando o conector esta sem credencial.
   *
   * Sem isto a requisicao seguia para a origem e voltava um 401 dela, que
   * culpa a plataforma por um problema que e de configuracao nossa. A busca
   * federada ja pulava o conector desabilitado; estas rotas, por falarem com
   * ele diretamente, precisam da propria checagem.
   */
  private assertConnectorReady(): void {
    if (this.uolAds.isEnabled()) {
      return;
    }

    throw new ServiceUnavailableException({
      code: ErrorCode.INTEGRATION_UNAVAILABLE,
      message:
        'A integracao com o UOL Ads nao esta configurada. Defina UOL_ADS_KEY no ambiente (na Vercel: Settings > Environment Variables) e faca um novo deploy.',
      source: 'uol-ads',
    });
  }

  /**
   * O formato ja foi validado no DTO; aqui verificamos a coerencia - datas
   * reais e em ordem. Falhar antes de chamar a origem evita um 400 dela com
   * stack trace Java na resposta.
   */
  private assertPeriod(startDate: string, endDate: string): void {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'startDate e endDate devem ser datas validas no formato yyyy-MM-dd.',
      });
    }

    if (start > end) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'startDate deve ser anterior ou igual a endDate.',
        details: { startDate, endDate },
      });
    }
  }

  /**
   * Recusa `regions` fora de `breakdown=region`, em vez de ignorar em silencio -
   * o cliente pensaria estar filtrando por UF sem estar.
   */
  private assertRegionsUsage(query: CampaignReportQueryDto): void {
    if (query.regions?.length && query.breakdown !== ReportBreakdown.REGION) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'O parametro "regions" exige "breakdown=region".',
        details: { breakdown: query.breakdown, regions: query.regions },
      });
    }
  }
}
