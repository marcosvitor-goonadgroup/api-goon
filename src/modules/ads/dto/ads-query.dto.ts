import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  CampaignStatus,
  ReportBreakdown,
  ReportLayout,
  type CampaignStatusValue,
  type ReportBreakdownValue,
  type ReportLayoutValue,
} from '../../../integrations/connectors/uol-ads/uol-ads.model';
import { UOL_REGIONS } from '../../../integrations/connectors/uol-ads/uol-ads.types';

const STATUS_VALUES = Object.values(CampaignStatus);
const BREAKDOWN_VALUES = Object.values(ReportBreakdown);
const LAYOUT_VALUES = Object.values(ReportLayout);

/** Formato exigido pela origem: yyyy-MM-dd. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `?regions=SP,RJ` ou `?regions=SP&regions=RJ` -> ['SP','RJ'] em maiusculas. */
const toUpperArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const items = Array.isArray(value) ? value : [value];

  return items
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
};

const toNumberArray = ({ value }: { value: unknown }): number[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const items = Array.isArray(value) ? value : [value];

  return items
    .flatMap((item) =>
      typeof item === 'string' || typeof item === 'number' ? String(item).split(',') : [],
    )
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
};

export class ListCampaignsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filtra pelo estado da campanha. Omitido, devolve todas. O resumo por estado vem sempre completo em `statusSummary`.',
    enum: STATUS_VALUES,
    example: CampaignStatus.COMPLETED,
  })
  @IsOptional()
  @IsIn(STATUS_VALUES, {
    message: `status deve ser um de: ${STATUS_VALUES.join(', ')}`,
  })
  status?: CampaignStatusValue;

  @ApiPropertyOptional({
    description: 'Busca por parte do nome ou pelo ID exato da campanha. Ignora acentos e caixa.',
    example: 'radiola',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class CampaignReportQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Inicio do periodo (yyyy-MM-dd).',
    example: '2026-08-01',
  })
  @Matches(DATE_PATTERN, { message: 'startDate deve estar no formato yyyy-MM-dd' })
  startDate: string;

  @ApiProperty({
    description: 'Fim do periodo (yyyy-MM-dd). Deve ser igual ou posterior a startDate.',
    example: '2026-08-31',
  })
  @Matches(DATE_PATTERN, { message: 'endDate deve estar no formato yyyy-MM-dd' })
  endDate: string;

  @ApiPropertyOptional({
    description:
      'Segmentacao. `date` traz o nome do criativo; `region` traz a UF, mas sem criativo - a origem nao cruza as duas informacoes.',
    enum: BREAKDOWN_VALUES,
    default: ReportBreakdown.DATE,
  })
  @IsOptional()
  @IsIn(BREAKDOWN_VALUES, {
    message: `breakdown deve ser um de: ${BREAKDOWN_VALUES.join(', ')}`,
  })
  breakdown: ReportBreakdownValue = ReportBreakdown.DATE;

  @ApiPropertyOptional({
    description:
      'Localidades a incluir (UF, ou BR para nacional), separadas por virgula. Usado apenas com `breakdown=region`.',
    example: 'SP,RJ',
    type: String,
  })
  @IsOptional()
  @Transform(toUpperArray)
  @IsArray()
  @IsIn(UOL_REGIONS, {
    each: true,
    message: `regions aceita apenas: ${UOL_REGIONS.join(', ')}`,
  })
  regions?: string[];

  @ApiPropertyOptional({
    description: 'Restringe a conjuntos de anuncios especificos, separados por virgula.',
    example: '5000149200',
    type: String,
  })
  @IsOptional()
  @Transform(toNumberArray)
  @IsArray()
  groupIds?: number[];

  @ApiPropertyOptional({
    description:
      'Formato das linhas. `nested` agrupa as metricas e omite o que a origem nao mediu; `flat` devolve colunas fixas (metrica ausente vem null), pronto para planilha ou BI.',
    enum: LAYOUT_VALUES,
    default: ReportLayout.NESTED,
  })
  @IsOptional()
  @IsIn(LAYOUT_VALUES, {
    message: `layout deve ser um de: ${LAYOUT_VALUES.join(', ')}`,
  })
  layout: ReportLayoutValue = ReportLayout.NESTED;
}
