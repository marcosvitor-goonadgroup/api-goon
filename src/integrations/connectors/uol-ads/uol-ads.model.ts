import type { UolStatus } from './uol-ads.types';

/**
 * Estado normalizado de uma campanha.
 *
 * A origem tem nove valores; estes sao os que um consumidor precisa distinguir.
 */
export const CampaignStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
  UNKNOWN: 'unknown',
} as const;

export type CampaignStatusValue = (typeof CampaignStatus)[keyof typeof CampaignStatus];

/** Os tres estados que o consumidor tipicamente filtra. */
export const MAIN_CAMPAIGN_STATUSES: CampaignStatusValue[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.PAUSED,
  CampaignStatus.COMPLETED,
];

const STATUS_MAP: Record<UolStatus, CampaignStatusValue> = {
  ATIVO: CampaignStatus.ACTIVE,
  PAUSADO: CampaignStatus.PAUSED,
  FINALIZADO: CampaignStatus.COMPLETED,
  PENDENTE: CampaignStatus.PENDING,
  APROVADO: CampaignStatus.APPROVED,
  REPROVADO: CampaignStatus.REJECTED,
  REPROVADO_ADSERVER: CampaignStatus.REJECTED,
  ARQUIVADO: CampaignStatus.ARCHIVED,
  EXCLUIDO: CampaignStatus.DELETED,
};

/**
 * Traduz o status da origem. Um valor desconhecido vira `unknown` em vez de
 * quebrar - a origem pode introduzir estados novos sem aviso.
 */
export function normalizeStatus(status?: string): CampaignStatusValue {
  if (!status) {
    return CampaignStatus.UNKNOWN;
  }
  return STATUS_MAP[status as UolStatus] ?? CampaignStatus.UNKNOWN;
}

export interface AdGroup {
  id: number;
  name: string | null;
  status: CampaignStatusValue;
  statusLabel: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface AdCampaign {
  id: number;
  name: string;
  /** Estado normalizado - use este para logica. */
  status: CampaignStatusValue;
  /** Texto legivel vindo da origem, ex.: "Em veiculacao". */
  statusLabel: string | null;
  /** Valor original da origem, preservado para rastreabilidade. */
  rawStatus: string | null;
  groupCount: number;
  groups: AdGroup[];
}

/** Contagem por estado, sempre sobre a base inteira (antes de filtro/pagina). */
export type CampaignStatusSummary = Partial<Record<CampaignStatusValue, number>>;

export interface CampaignListResult {
  campaigns: AdCampaign[];
  statusSummary: CampaignStatusSummary;
  /** Total de campanhas na conta, independente do filtro aplicado. */
  totalAvailable: number;
}

/** Como o relatorio e segmentado. */
export const ReportBreakdown = {
  DATE: 'date',
  REGION: 'region',
} as const;

export type ReportBreakdownValue = (typeof ReportBreakdown)[keyof typeof ReportBreakdown];

export interface ReportMetrics {
  impressions: number;
  clicks: number;
  cost: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpv: number;
  /** Presentes apenas quando a origem mede viewability. */
  measurableImpressions?: number;
  viewableImpressions?: number;
  viewabilityRate?: number;
}

export interface ReportConversions {
  total?: number;
  fromView?: number;
  fromClick?: number;
}

export interface ReportVideoMetrics {
  trueView?: number;
  avgTrueViewCost?: number;
  starts?: number;
  firstQuartile?: number;
  midpoint?: number;
  thirdQuartile?: number;
  completions?: number;
  completionRate?: number;
  vtr?: number;
}

export interface CampaignReportRow {
  date: string | null;
  campaignName: string | null;
  groupName: string | null;
  /** Presente apenas em `breakdown=date` - a origem nao cruza criativo com UF. */
  creativeName: string | null;
  /** Presente apenas em `breakdown=region`. */
  region: string | null;
  format: string | null;
  metrics: ReportMetrics;
  /** Blocos omitidos quando a origem nao tem o dado, para nao poluir a resposta. */
  conversions?: ReportConversions;
  video?: ReportVideoMetrics;
}

/**
 * Formato da resposta do relatorio.
 *
 * - `nested`: blocos agrupados (`metrics`, `video`, `conversions`), omitindo o
 *   que a origem nao mediu. Bom para consumo por aplicacao.
 * - `flat`: uma linha por registro com colunas fixas. Bom para planilha, BI ou
 *   carga em banco, onde uma coluna que some quebra o consumidor.
 */
export const ReportLayout = {
  NESTED: 'nested',
  FLAT: 'flat',
} as const;

export type ReportLayoutValue = (typeof ReportLayout)[keyof typeof ReportLayout];

/**
 * Linha tabular com colunas fixas.
 *
 * Diferente do formato aninhado, aqui **toda coluna existe sempre** - metricas
 * que a origem nao mediu vem `null`, e nao ausentes. E o que permite jogar o
 * resultado direto numa planilha ou tabela sem cabecalho variavel.
 */
export interface FlatReportRow {
  date: string | null;
  campaignName: string | null;
  groupName: string | null;
  creativeName: string | null;
  region: string | null;
  format: string | null;

  impressions: number;
  clicks: number;
  cost: number;

  /** Video iniciado. `null` quando a campanha nao e de video. */
  views: number | null;
  views25: number | null;
  views50: number | null;
  views75: number | null;
  views100: number | null;
  /** Visualizacoes qualificadas (padrao TrueView). */
  trueViews: number | null;

  viewableImpressions: number | null;
  /** Proporcao de impressoes efetivamente visiveis (0 a 1). */
  viewabilityRate: number | null;

  conversions: number | null;

  ctr: number;
  cpc: number;
  cpm: number;
}

export interface CampaignReportTotals {
  impressions: number;
  clicks: number;
  cost: number;
  ctr: number;
  cpc: number;
  cpm: number;
}

export interface CampaignReport {
  campaign: { id: number; name: string | null };
  period: { startDate: string; endDate: string };
  breakdown: ReportBreakdownValue;
  /**
   * `false` em `breakdown=region`: a origem nao segmenta criativo por
   * localidade, entao o campo vem nulo em todas as linhas.
   */
  creativeAvailable: boolean;
  rows: CampaignReportRow[];
  /** Totais do periodo inteiro, calculados antes da paginacao. */
  totals: CampaignReportTotals;
}

/**
 * Metricas que a origem nao entrega em `breakdown=region`.
 *
 * Documentado aqui porque o consumidor precisa saber **antes** de montar um
 * relatorio por localidade contando com colunas que virao vazias.
 */
export const REGION_UNAVAILABLE_FIELDS = [
  'creativeName',
  'views',
  'views25',
  'views50',
  'views75',
  'views100',
  'trueViews',
  'viewableImpressions',
  'viewabilityRate',
  'conversions',
] as const;
