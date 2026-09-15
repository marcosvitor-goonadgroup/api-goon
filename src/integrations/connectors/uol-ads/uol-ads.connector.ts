import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { ResilientHttpService } from '../../../core/http/resilient-http.service';
import { BaseHttpConnector } from '../../base/base-http.connector';
import type {
  ConnectorContext,
  ConnectorMetadata,
  ConnectorQuery,
  NormalizedRecord,
} from '../../contracts/connector.contract';
import { RegisterConnector } from '../../decorators/register-connector.decorator';
import {
  CampaignStatus,
  normalizeStatus,
  ReportBreakdown,
  type AdCampaign,
  type AdGroup,
  type CampaignListResult,
  type CampaignReport,
  type CampaignReportRow,
  type CampaignReportTotals,
  type CampaignStatusSummary,
  type CampaignStatusValue,
  type FlatReportRow,
  type ReportBreakdownValue,
  type ReportConversions,
  type ReportMetrics,
  type ReportVideoMetrics,
} from './uol-ads.model';
import type { UolAnalyticsRow, UolCampaign, UolCampaignGroup, UolRegionRow } from './uol-ads.types';

export interface ListCampaignsOptions {
  /** Filtra pelo estado normalizado. Aplicado aqui, nunca na origem. */
  status?: CampaignStatusValue;
  /** Busca textual por nome ou ID. */
  search?: string;
}

export interface CampaignReportOptions {
  startDate: string;
  endDate: string;
  breakdown?: ReportBreakdownValue;
  /** UFs (ou `BR`) para `breakdown=region`. */
  regions?: string[];
  /** Restringe a conjuntos de anuncios especificos. */
  groupIds?: number[];
}

/** Numero em qualquer forma vira numero; nulo da origem vira 0. */
const num = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Mantem o campo apenas se a origem realmente mediu algo. */
const optional = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Remove chaves indefinidas; devolve `undefined` se nada sobrou.
 *
 * E o que impede blocos vazios de metrica na resposta: a origem devolve ~15
 * campos nulos por linha (video, conversoes), e em milhares de linhas isso
 * seria so ruido.
 */
function compact<T extends object>(input: T): T | undefined {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * Integracao com a API de anuncios do UOL.
 *
 * Primeira integracao autenticada do projeto: a credencial vai no header
 * `Authorization` via `authHeaders()`, o que tambem cobre o health check.
 *
 * **Decisao central**: o parametro `status` de `GET /campaigns` NAO e usado.
 * Medido na conta real, ele filtra pela configuracao da campanha e nao pelo
 * estado efetivo - `status=ATIVO` devolve campanhas ja finalizadas e nenhuma
 * ativa, e `status=PAUSADO` devolve mais campanhas finalizadas do que
 * pausadas. Buscamos a lista completa e classificamos pelo campo `status` de
 * cada registro, que e confiavel.
 *
 * @see https://api.ads.uol.com.br/swagger-ui/index.html
 */
@Injectable()
@RegisterConnector()
export class UolAdsConnector extends BaseHttpConnector {
  constructor(http: ResilientHttpService, config: AppConfigService) {
    super(http, config);
  }

  readonly metadata: ConnectorMetadata = {
    key: 'uol-ads',
    label: 'UOL Ads',
    description:
      'Campanhas e relatorios de midia do UOL Ads: metricas por data, conjunto, criativo e localidade.',
    capabilities: ['ad-campaign'],
    baseUrl: this.config.connectors.uolAds.baseUrl,
    docsUrl: 'https://api.ads.uol.com.br/swagger-ui/index.html',
    requiresCredentials: true,
  };

  /**
   * Desabilitado sem credencial: melhor ficar fora do catalogo do que aparecer
   * ativo e responder 401 em toda chamada.
   */
  isEnabled(): boolean {
    const { enabled, apiKey } = this.config.connectors.uolAds;
    return enabled && apiKey.trim().length > 0;
  }

  protected override authHeaders(): Record<string, string> {
    const key = this.config.connectors.uolAds.apiKey;
    return key ? { Authorization: key } : {};
  }

  /** Resposta minima: filtra por um id que quase certamente nao existe. */
  protected healthProbePath(): string {
    return '/campaigns?ids=1';
  }

  // ------------------------------------------------------------------
  // Contrato de busca federada
  // ------------------------------------------------------------------

  supports(query: ConnectorQuery): boolean {
    if (query.capability) {
      return this.metadata.capabilities.includes(query.capability);
    }

    const term = query.term.trim();

    // Termo so de digitos e tratado como ID de campanha, de qualquer tamanho.
    if (/^\d+$/.test(term)) {
      return true;
    }

    return term.length >= 3;
  }

  async search(query: ConnectorQuery, context: ConnectorContext): Promise<NormalizedRecord[]> {
    const { campaigns } = await this.listCampaigns({ search: query.term });

    return campaigns
      .slice(0, query.limit ?? 20)
      .map((campaign) => this.toCampaignRecord(campaign, context));
  }

  async findById(id: string, context: ConnectorContext): Promise<NormalizedRecord | null> {
    const campaignId = Number(id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return null;
    }

    const campaign = await this.getCampaign(campaignId);
    return campaign ? this.toCampaignRecord(campaign, context) : null;
  }

  // ------------------------------------------------------------------
  // Operacoes de dominio
  // ------------------------------------------------------------------

  /**
   * Lista campanhas com o estado normalizado.
   *
   * Sempre busca a base inteira: o `statusSummary` precisa contar todos os
   * estados, e o filtro da origem nao e confiavel (ver nota da classe).
   */
  async listCampaigns(options: ListCampaignsOptions = {}): Promise<CampaignListResult> {
    const raw = await this.fetch<UolCampaign[]>('/campaigns', {
      cacheTtlMs: this.config.connectors.uolAds.cacheTtlMs,
    });

    // `Array.isArray` e nao `?? []`: uma origem que responda com objeto de erro
    // no lugar da lista nao pode derrubar a rota com "map is not a function".
    const all = (Array.isArray(raw) ? raw : []).map((campaign) => this.toCampaign(campaign));
    const statusSummary = this.summarize(all);

    let campaigns = all;

    if (options.status) {
      campaigns = campaigns.filter((campaign) => campaign.status === options.status);
    }

    if (options.search?.trim()) {
      const needle = this.normalizeText(options.search);
      campaigns = campaigns.filter(
        (campaign) =>
          this.normalizeText(campaign.name).includes(needle) || String(campaign.id) === needle,
      );
    }

    return { campaigns, statusSummary, totalAvailable: all.length };
  }

  async getCampaign(id: number): Promise<AdCampaign | null> {
    const raw = await this.fetch<UolCampaign>(`/campaigns/${id}`, {
      cacheTtlMs: this.config.connectors.uolAds.cacheTtlMs,
    });

    return raw ? this.toCampaign(raw) : null;
  }

  /**
   * Relatorio de uma campanha, segmentado por data ou por localidade.
   *
   * As duas segmentacoes vem de endpoints diferentes da origem, com conjuntos
   * de dimensoes incompativeis: `analytics` traz criativo mas nao UF;
   * `regions` traz UF e responde 400 se receber dimensao de criativo.
   */
  async getCampaignReport(
    campaignId: number,
    options: CampaignReportOptions,
  ): Promise<CampaignReport> {
    const breakdown = options.breakdown ?? ReportBreakdown.DATE;
    const byRegion = breakdown === ReportBreakdown.REGION;

    const params: Record<string, unknown> = {
      startDate: options.startDate,
      endDate: options.endDate,
      campaignIds: [campaignId],
      dimensions: byRegion
        ? ['DATE', 'CAMPAIGN_ID', 'CAMPAIGN_NAME', 'GROUP_NAME']
        : ['DATE', 'CAMPAIGN_ID', 'CAMPAIGN_NAME', 'GROUP_NAME', 'CREATIVE_NAME', 'FORMAT'],
    };

    if (options.groupIds?.length) {
      params.groupIds = options.groupIds;
    }

    if (byRegion && options.regions?.length) {
      params.regions = options.regions;
    }

    const path = byRegion ? '/report/metrics/regions' : '/report/metrics/analytics';

    // TTL menor que o das campanhas: o dia corrente ainda recebe dados.
    const raw = await this.fetch<Array<UolAnalyticsRow | UolRegionRow>>(path, {
      params,
      cacheTtlMs: this.config.connectors.uolAds.cacheTtlMs * 2,
    });

    const source = Array.isArray(raw) ? raw : [];
    const rows = source.map((row) => this.toReportRow(row, byRegion));

    return {
      campaign: {
        id: campaignId,
        name: source.find((row) => row.campaignName)?.campaignName ?? null,
      },
      period: { startDate: options.startDate, endDate: options.endDate },
      breakdown,
      creativeAvailable: !byRegion,
      rows,
      totals: this.totalize(rows),
    };
  }

  // ------------------------------------------------------------------
  // Normalizacao
  // ------------------------------------------------------------------

  private toCampaign(raw: UolCampaign): AdCampaign {
    const groups = (raw.groups ?? []).map((group) => this.toGroup(group));

    return {
      id: raw.id,
      name: raw.name,
      status: normalizeStatus(raw.status),
      statusLabel: raw.detailedStatus ?? null,
      rawStatus: raw.status ?? null,
      groupCount: groups.length,
      groups,
    };
  }

  private toGroup(raw: UolCampaignGroup): AdGroup {
    return {
      id: raw.id,
      name: raw.name ?? null,
      status: normalizeStatus(raw.status),
      statusLabel: raw.detailedStatus ?? null,
      // A origem devolve date-time nos grupos; a parte da data e o que importa.
      startDate: raw.startDate?.slice(0, 10) ?? null,
      endDate: raw.endDate?.slice(0, 10) ?? null,
    };
  }

  private summarize(campaigns: AdCampaign[]): CampaignStatusSummary {
    const summary: CampaignStatusSummary = {};

    for (const campaign of campaigns) {
      summary[campaign.status] = (summary[campaign.status] ?? 0) + 1;
    }

    return summary;
  }

  private toReportRow(row: UolAnalyticsRow | UolRegionRow, byRegion: boolean): CampaignReportRow {
    const analytics = row as UolAnalyticsRow;
    const region = (row as UolRegionRow).region;

    const metrics: ReportMetrics = {
      impressions: num(row.totalImpressions),
      clicks: num(row.totalClicks),
      cost: num(row.totalCost),
      ctr: num(row.ctr),
      cpc: num(row.avgCpc),
      cpm: num(row.avgCpm),
      cpv: num(row.avgCpv),
    };

    if (!byRegion) {
      const measurable = optional(analytics.measurableImpressions);
      const viewable = optional(analytics.viewableImpressions);
      const rate = optional(analytics.viewableImpressionsRate);

      if (measurable !== undefined) metrics.measurableImpressions = measurable;
      if (viewable !== undefined) metrics.viewableImpressions = viewable;
      if (rate !== undefined) metrics.viewabilityRate = rate;
    }

    const conversions = byRegion
      ? undefined
      : compact<ReportConversions>({
          total: optional(analytics.totalConversions),
          fromView: optional(analytics.totalViewConversions),
          fromClick: optional(analytics.totalClickConversions),
        });

    const video = byRegion
      ? undefined
      : compact<ReportVideoMetrics>({
          trueView: optional(analytics.trueView),
          avgTrueViewCost: optional(analytics.avgTrueViewCost),
          starts: optional(analytics.videoStart),
          firstQuartile: optional(analytics.videoFirstQuartile),
          midpoint: optional(analytics.videoMidpoint),
          thirdQuartile: optional(analytics.videoThirdQuartile),
          completions: optional(analytics.videoComplete),
          completionRate: optional(analytics.videoCompletionRate),
          vtr: optional(analytics.vtr),
        });

    return {
      date: row.date ?? row.month ?? null,
      campaignName: row.campaignName ?? null,
      groupName: row.groupName ?? null,
      creativeName: byRegion ? null : (analytics.creativeName ?? null),
      region: byRegion ? (region ?? null) : null,
      format: byRegion ? null : (analytics.format ?? null),
      metrics,
      ...(conversions ? { conversions } : {}),
      ...(video ? { video } : {}),
    };
  }

  /**
   * Converte a linha aninhada em linha tabular de colunas fixas.
   *
   * Aqui a regra se inverte em relacao ao formato aninhado: metrica ausente
   * vira `null` em vez de sumir. Uma planilha ou tabela de banco precisa do
   * mesmo cabecalho em todas as linhas.
   */
  toFlatRow(row: CampaignReportRow): FlatReportRow {
    const { metrics, video, conversions } = row;

    return {
      date: row.date,
      campaignName: row.campaignName,
      groupName: row.groupName,
      creativeName: row.creativeName,
      region: row.region,
      format: row.format,

      impressions: metrics.impressions,
      clicks: metrics.clicks,
      cost: metrics.cost,

      views: video?.starts ?? null,
      views25: video?.firstQuartile ?? null,
      views50: video?.midpoint ?? null,
      views75: video?.thirdQuartile ?? null,
      views100: video?.completions ?? null,
      trueViews: video?.trueView ?? null,

      viewableImpressions: metrics.viewableImpressions ?? null,
      viewabilityRate: metrics.viewabilityRate ?? null,

      conversions: conversions?.total ?? null,

      ctr: metrics.ctr,
      cpc: metrics.cpc,
      cpm: metrics.cpm,
    };
  }

  /**
   * Totais do periodo.
   *
   * As taxas sao recalculadas sobre os somatorios - somar ou fazer media de
   * CTR/CPC linha a linha daria um numero errado, ja que cada linha tem peso
   * diferente em impressoes.
   */
  private totalize(rows: CampaignReportRow[]): CampaignReportTotals {
    const impressions = rows.reduce((sum, row) => sum + row.metrics.impressions, 0);
    const clicks = rows.reduce((sum, row) => sum + row.metrics.clicks, 0);
    const cost = rows.reduce((sum, row) => sum + row.metrics.cost, 0);

    const round = (value: number, digits = 2): number =>
      Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

    return {
      impressions,
      clicks,
      cost: round(cost),
      ctr: impressions > 0 ? round((clicks / impressions) * 100, 3) : 0,
      cpc: clicks > 0 ? round(cost / clicks) : 0,
      cpm: impressions > 0 ? round((cost / impressions) * 1000) : 0,
    };
  }

  private toCampaignRecord(campaign: AdCampaign, context: ConnectorContext): NormalizedRecord {
    return this.toRecord({
      id: String(campaign.id),
      type: 'ad-campaign',
      title: campaign.name,
      subtitle: campaign.statusLabel ?? campaign.status,
      context,
      raw: campaign,
      attributes: {
        campaignId: campaign.id,
        name: campaign.name,
        status: campaign.status,
        statusLabel: campaign.statusLabel,
        rawStatus: campaign.rawStatus,
        groupCount: campaign.groupCount,
        isRunning: campaign.status === CampaignStatus.ACTIVE,
      },
    });
  }
}
