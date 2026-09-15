import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import {
  CampaignStatus,
  ReportBreakdown,
  ReportLayout,
} from '../../../integrations/connectors/uol-ads/uol-ads.model';

const STATUS_VALUES = Object.values(CampaignStatus);

export class AdGroupDto {
  @ApiProperty({ description: 'ID do conjunto de anuncios.', example: 5000149200 })
  id: number;

  @ApiProperty({ nullable: true, example: 'leilao_cpm_display_desk-mob_all_all_18-mais' })
  name: string | null;

  @ApiProperty({ enum: STATUS_VALUES, example: 'completed' })
  status: string;

  @ApiProperty({ nullable: true, example: 'Concluido' })
  statusLabel: string | null;

  @ApiProperty({ nullable: true, example: '2026-01-16' })
  startDate: string | null;

  @ApiProperty({ nullable: true, example: '2026-02-15' })
  endDate: string | null;
}

export class AdCampaignDto {
  @ApiProperty({ description: 'ID da campanha na plataforma.', example: 115912 })
  id: number;

  @ApiProperty({ example: 'jul_radiola_cra-rj_campanha-pj_promocional_awareness' })
  name: string;

  @ApiProperty({
    description: 'Estado normalizado - programe contra este campo.',
    enum: STATUS_VALUES,
    example: 'completed',
  })
  status: string;

  @ApiProperty({
    description: 'Texto legivel do estado, vindo da plataforma.',
    nullable: true,
    example: 'Concluido',
  })
  statusLabel: string | null;

  @ApiProperty({
    description: 'Valor original da plataforma, preservado para rastreabilidade.',
    nullable: true,
    example: 'FINALIZADO',
  })
  rawStatus: string | null;

  @ApiProperty({ example: 1 })
  groupCount: number;

  @ApiProperty({ type: [AdGroupDto] })
  groups: AdGroupDto[];
}

export class CampaignStatusSummaryDto {
  @ApiPropertyOptional({ description: 'Campanhas em veiculacao.', example: 0 })
  active?: number;

  @ApiPropertyOptional({ example: 8 })
  paused?: number;

  @ApiPropertyOptional({ description: 'Campanhas finalizadas.', example: 13 })
  completed?: number;

  @ApiPropertyOptional({ example: 1 })
  pending?: number;

  @ApiPropertyOptional({ example: 0 })
  approved?: number;

  @ApiPropertyOptional({ example: 0 })
  rejected?: number;

  @ApiPropertyOptional({ example: 0 })
  archived?: number;

  @ApiPropertyOptional({ example: 0 })
  deleted?: number;

  @ApiPropertyOptional({ description: 'Estado nao reconhecido na plataforma.', example: 0 })
  unknown?: number;
}

export class CampaignListDto {
  @ApiProperty({ type: [AdCampaignDto] })
  items: AdCampaignDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({
    description:
      'Contagem por estado sobre a conta inteira - nao e afetada por filtro nem paginacao.',
    type: CampaignStatusSummaryDto,
  })
  statusSummary: CampaignStatusSummaryDto;

  @ApiProperty({
    description: 'Total de campanhas na conta, antes de qualquer filtro.',
    example: 22,
  })
  totalAvailable: number;
}

export class ReportMetricsDto {
  @ApiProperty({ example: 155 })
  impressions: number;

  @ApiProperty({ example: 26 })
  clicks: number;

  @ApiProperty({ description: 'Investimento em reais.', example: 51.22 })
  cost: number;

  @ApiProperty({ description: 'Taxa de cliques (%).', example: 0.181 })
  ctr: number;

  @ApiProperty({ description: 'Custo por clique.', example: 1.97 })
  cpc: number;

  @ApiProperty({ description: 'Custo por mil impressoes.', example: 3.57 })
  cpm: number;

  @ApiProperty({ description: 'Custo por visualizacao.', example: 0 })
  cpv: number;

  @ApiPropertyOptional({ example: 155 })
  measurableImpressions?: number;

  @ApiPropertyOptional({ example: 101 })
  viewableImpressions?: number;

  @ApiPropertyOptional({ description: 'Proporcao de impressoes visiveis.', example: 0.652 })
  viewabilityRate?: number;
}

/** Presente apenas quando a campanha mede conversoes. */
export class ReportConversionsDto {
  @ApiPropertyOptional({ example: 12 })
  total?: number;

  @ApiPropertyOptional({ description: 'Conversoes atribuidas a visualizacao.', example: 4 })
  fromView?: number;

  @ApiPropertyOptional({ description: 'Conversoes atribuidas a clique.', example: 8 })
  fromClick?: number;
}

/** Presente apenas em campanhas de video. */
export class ReportVideoMetricsDto {
  @ApiPropertyOptional({ example: 980 })
  trueView?: number;

  @ApiPropertyOptional({ example: 0.12 })
  avgTrueViewCost?: number;

  @ApiPropertyOptional({ example: 1200 })
  starts?: number;

  @ApiPropertyOptional({ example: 1050 })
  firstQuartile?: number;

  @ApiPropertyOptional({ example: 960 })
  midpoint?: number;

  @ApiPropertyOptional({ example: 890 })
  thirdQuartile?: number;

  @ApiPropertyOptional({ example: 840 })
  completions?: number;

  @ApiPropertyOptional({ description: 'Proporcao de videos assistidos ate o fim.', example: 0.7 })
  completionRate?: number;

  @ApiPropertyOptional({ description: 'View-through rate.', example: 0.65 })
  vtr?: number;
}

/**
 * Linha tabular (`layout=flat`): colunas fixas, prontas para planilha ou BI.
 *
 * Toda coluna existe sempre; metrica que a origem nao mediu vem `null`.
 */
export class FlatReportRowDto {
  @ApiProperty({ nullable: true, example: '2026-08-01' })
  date: string | null;

  @ApiProperty({ nullable: true, example: 'jul_radiola_cra-rj_campanha-pj' })
  campaignName: string | null;

  @ApiProperty({ description: 'Nome do conjunto de anuncios.', nullable: true })
  groupName: string | null;

  @ApiProperty({
    description: 'Nulo em `breakdown=region`.',
    nullable: true,
    example: 'CRA_INSTITUCIONAL',
  })
  creativeName: string | null;

  @ApiProperty({ description: 'Preenchido apenas em `breakdown=region`.', nullable: true })
  region: string | null;

  @ApiProperty({ nullable: true, example: 'IMAGE' })
  format: string | null;

  @ApiProperty({ example: 14350 })
  impressions: number;

  @ApiProperty({ example: 26 })
  clicks: number;

  @ApiProperty({ example: 51.22 })
  cost: number;

  @ApiProperty({
    description: 'Video iniciado. Nulo quando a campanha nao e de video.',
    nullable: true,
    example: null,
  })
  views: number | null;

  @ApiProperty({ description: 'Video assistido ate 25%.', nullable: true })
  views25: number | null;

  @ApiProperty({ description: 'Video assistido ate 50%.', nullable: true })
  views50: number | null;

  @ApiProperty({ description: 'Video assistido ate 75%.', nullable: true })
  views75: number | null;

  @ApiProperty({ description: 'Video assistido ate o fim.', nullable: true })
  views100: number | null;

  @ApiProperty({ description: 'Visualizacoes qualificadas (TrueView).', nullable: true })
  trueViews: number | null;

  @ApiProperty({ description: 'Impressoes efetivamente visiveis.', nullable: true, example: 101 })
  viewableImpressions: number | null;

  @ApiProperty({
    description: 'Proporcao de impressoes visiveis (0 a 1). Nulo em `breakdown=region`.',
    nullable: true,
    example: 0.652,
  })
  viewabilityRate: number | null;

  @ApiProperty({
    description: 'Conversoes registradas. Nulo quando a campanha nao mede conversao.',
    nullable: true,
    example: null,
  })
  conversions: number | null;

  @ApiProperty({ example: 0.181 })
  ctr: number;

  @ApiProperty({ example: 1.97 })
  cpc: number;

  @ApiProperty({ example: 3.57 })
  cpm: number;
}

export class CampaignReportRowDto {
  @ApiProperty({ nullable: true, example: '2026-08-01' })
  date: string | null;

  @ApiProperty({ nullable: true, example: 'jul_radiola_cra-rj_campanha-pj' })
  campaignName: string | null;

  @ApiProperty({
    description: 'Nome do conjunto de anuncios.',
    nullable: true,
    example: 'jul_radiola_cra-rj_conjunto_awareness_impressoes_brasil_18+',
  })
  groupName: string | null;

  @ApiProperty({
    description: 'Nome do criativo. Sempre nulo quando `breakdown=region`.',
    nullable: true,
    example: 'CRA_INSTITUCIONAL_CAMPAN.',
  })
  creativeName: string | null;

  @ApiProperty({
    description: 'UF. Presente apenas quando `breakdown=region`.',
    nullable: true,
    example: 'RJ',
  })
  region: string | null;

  @ApiProperty({ nullable: true, example: 'NATIVE' })
  format: string | null;

  @ApiProperty({ type: ReportMetricsDto })
  metrics: ReportMetricsDto;

  @ApiPropertyOptional({
    description: 'Omitido quando a campanha nao mede conversoes.',
    type: ReportConversionsDto,
  })
  conversions?: ReportConversionsDto;

  @ApiPropertyOptional({
    description: 'Omitido em campanhas que nao sao de video.',
    type: ReportVideoMetricsDto,
  })
  video?: ReportVideoMetricsDto;
}

export class CampaignReportTotalsDto {
  @ApiProperty({ example: 14204988 })
  impressions: number;

  @ApiProperty({ example: 8649 })
  clicks: number;

  @ApiProperty({ example: 20692.51 })
  cost: number;

  @ApiProperty({
    description: 'Recalculado sobre os somatorios, nao e a media das linhas.',
    example: 0.061,
  })
  ctr: number;

  @ApiProperty({ example: 2.39 })
  cpc: number;

  @ApiProperty({ example: 1.46 })
  cpm: number;
}

export class ReportPeriodDto {
  @ApiProperty({ example: '2026-08-01' })
  startDate: string;

  @ApiProperty({ example: '2026-08-31' })
  endDate: string;
}

export class ReportCampaignRefDto {
  @ApiProperty({ example: 115912 })
  id: number;

  @ApiProperty({ nullable: true, example: 'jul_radiola_cra-rj_campanha-pj' })
  name: string | null;
}

// As duas formas de linha entram no schema, ja que `rows` alterna entre elas.
@ApiExtraModels(CampaignReportRowDto, FlatReportRowDto)
export class CampaignReportDto {
  @ApiProperty({ type: ReportCampaignRefDto })
  campaign: ReportCampaignRefDto;

  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ enum: Object.values(ReportBreakdown), example: 'date' })
  breakdown: string;

  @ApiProperty({
    description: 'Formato das linhas em `rows`.',
    enum: Object.values(ReportLayout),
    example: 'nested',
  })
  layout: string;

  @ApiProperty({
    description:
      'Indica se `creativeName` esta preenchido. Vem `false` com `breakdown=region`: a plataforma nao segmenta criativo por localidade.',
    example: true,
  })
  creativeAvailable: boolean;

  @ApiProperty({
    description:
      'Colunas que a plataforma nao entrega neste corte e que virao sempre vazias. Vazio em `breakdown=date`.',
    type: [String],
    example: [],
  })
  unavailableFields: string[];

  @ApiProperty({
    description: 'Linhas do relatorio. O formato segue `layout`.',
    oneOf: [
      { $ref: getSchemaPath(CampaignReportRowDto) },
      { $ref: getSchemaPath(FlatReportRowDto) },
    ],
    isArray: true,
  })
  rows: CampaignReportRowDto[] | FlatReportRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({
    description: 'Totais do periodo inteiro, calculados antes da paginacao.',
    type: CampaignReportTotalsDto,
  })
  totals: CampaignReportTotalsDto;
}
