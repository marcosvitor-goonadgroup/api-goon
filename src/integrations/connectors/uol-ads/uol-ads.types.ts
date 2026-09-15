/**
 * Formas de resposta da API do UOL Ads.
 *
 * Espelham o que a origem devolve de fato (verificado contra a conta real),
 * incluindo os campos que vem nulos conforme as dimensoes pedidas.
 *
 * @see https://api.ads.uol.com.br/swagger-ui/index.html
 */

/** Status efetivo de uma campanha, grupo ou criativo na origem. */
export type UolStatus =
  | 'ATIVO'
  | 'PAUSADO'
  | 'PENDENTE'
  | 'APROVADO'
  | 'REPROVADO'
  | 'FINALIZADO'
  | 'REPROVADO_ADSERVER'
  | 'ARQUIVADO'
  | 'EXCLUIDO';

/** Grupo (conjunto de anuncios) como vem aninhado dentro da campanha. */
export interface UolCampaignGroup {
  id: number;
  name?: string;
  status?: UolStatus;
  detailedStatus?: string;
  startDate?: string;
  endDate?: string;
}

export interface UolCampaign {
  id: number;
  name: string;
  status?: UolStatus;
  /** Texto legivel do estado, ex.: "Em veiculacao", "Concluido", "Pausado". */
  detailedStatus?: string;
  groups?: UolCampaignGroup[];
}

/** Linha de `/report/metrics/analytics`. */
export interface UolAnalyticsRow {
  date?: string;
  month?: string;
  campaignId?: number;
  campaignName?: string;
  groupId?: number;
  groupName?: string;
  creativeId?: number;
  creativeName?: string;
  format?: string;

  totalImpressions?: number | null;
  totalClicks?: number | null;
  totalCost?: number | null;
  ctr?: number | null;
  avgCpc?: number | null;
  avgCpm?: number | null;
  avgCpv?: number | null;

  measurableImpressions?: number | null;
  viewableImpressions?: number | null;
  viewableImpressionsRate?: number | null;

  totalConversions?: number | null;
  totalViewConversions?: number | null;
  totalClickConversions?: number | null;

  trueView?: number | null;
  avgTrueViewCost?: number | null;
  videoStart?: number | null;
  videoFirstQuartile?: number | null;
  videoMidpoint?: number | null;
  videoThirdQuartile?: number | null;
  videoComplete?: number | null;
  videoCompletionRate?: number | null;
  vtr?: number | null;
}

/** Linha de `/report/metrics/regions` - nao traz criativo nem metricas de video. */
export interface UolRegionRow {
  date?: string;
  month?: string;
  campaignId?: number;
  campaignName?: string;
  groupId?: number;
  groupName?: string;
  region?: string;

  totalImpressions?: number | null;
  totalClicks?: number | null;
  totalCost?: number | null;
  ctr?: number | null;
  avgCpc?: number | null;
  avgCpm?: number | null;
  avgCpv?: number | null;
}

/** Dimensoes aceitas por `/report/metrics/analytics`. */
export const ANALYTICS_DIMENSIONS = [
  'DATE',
  'MONTH',
  'CAMPAIGN_ID',
  'CAMPAIGN_NAME',
  'GROUP_ID',
  'GROUP_NAME',
  'CREATIVE_ID',
  'CREATIVE_NAME',
  'FORMAT',
] as const;

/**
 * Dimensoes aceitas por `/report/metrics/regions`.
 *
 * Note a ausencia de CREATIVE_*: a origem responde 400 se forem enviadas.
 */
export const REGION_DIMENSIONS = [
  'DATE',
  'MONTH',
  'CAMPAIGN_ID',
  'CAMPAIGN_NAME',
  'GROUP_ID',
  'GROUP_NAME',
] as const;

/** Localidades aceitas no filtro de regiao (BR = nacional, demais sao UFs). */
export const UOL_REGIONS = [
  'BR',
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;

export type UolRegion = (typeof UOL_REGIONS)[number];
