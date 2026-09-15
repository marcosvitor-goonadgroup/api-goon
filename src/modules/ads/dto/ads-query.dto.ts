import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
import { resolveRelativeDate } from '../../../common/utils/relative-date';

const STATUS_VALUES = Object.values(CampaignStatus);
const BREAKDOWN_VALUES = Object.values(ReportBreakdown);
const LAYOUT_VALUES = Object.values(ReportLayout);

/** Formato exigido pela origem: yyyy-MM-dd. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const RELATIVE_DATE_HINT =
  'Aceita tambem os atalhos `today`/`hoje`, `yesterday`/`ontem` e `D-n` (ex.: `D-7` = sete dias atras), ' +
  'resolvidos no fuso America/Sao_Paulo - uteis para agendar a mesma URL todo dia. ' +
  'O campo `period` da resposta mostra as datas ja resolvidas.';

/**
 * Traduz os atalhos antes da validacao de formato, de modo que o `@Matches`
 * continue sendo a unica regra sobre o formato final.
 */
const toReportDate = ({ value }: { value: unknown }): unknown => resolveRelativeDate(value);

/**
 * `limit=all` (ou `0`) desliga a paginacao.
 *
 * Faz sentido aqui porque a origem nao pagina: o conector ja traz o periodo
 * inteiro numa unica chamada e a paginacao apenas recorta o resultado. Pedir
 * pagina por pagina repete a mesma consulta externa varias vezes, enquanto
 * `limit=all` resolve tudo em uma.
 */
export const ALL_ROWS = 0;

/**
 * Faz a conversao numerica aqui, e nao via `@Type(() => Number)`: o `@Type`
 * roda antes e transformaria `all` em `NaN`, que nunca chegaria a este ponto.
 */
const toReportLimit = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (['all', 'todas', 'tudo'].includes(token)) {
      return ALL_ROWS;
    }
    return token === '' ? undefined : Number(token);
  }
  return value;
};

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

/**
 * `OmitType` remove o `limit` herdado junto com os metadados de validacao dele.
 * Sem isso, o `@Type(() => Number)` da classe base rodaria primeiro e
 * transformaria `all` em `NaN` antes de o transform proprio ser consultado.
 */
export class CampaignReportQueryDto extends OmitType(PaginationQueryDto, ['limit'] as const) {
  @ApiProperty({
    description: `Inicio do periodo (yyyy-MM-dd). ${RELATIVE_DATE_HINT}`,
    example: '2026-08-01',
  })
  @Transform(toReportDate)
  @Matches(DATE_PATTERN, {
    message: 'startDate deve ser uma data yyyy-MM-dd ou um atalho (today, yesterday, D-7)',
  })
  startDate: string;

  @ApiProperty({
    description: `Fim do periodo (yyyy-MM-dd). Deve ser igual ou posterior a startDate. ${RELATIVE_DATE_HINT}`,
    example: '2026-08-31',
  })
  @Transform(toReportDate)
  @Matches(DATE_PATTERN, {
    message: 'endDate deve ser uma data yyyy-MM-dd ou um atalho (today, yesterday, D-7)',
  })
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

  /**
   * Redefine o `limit` herdado para aceitar `all`.
   *
   * O teto de 100 por pagina continua valendo quando se pagina; `all` e a via
   * explicita para trazer o periodo inteiro de uma vez, limitada por
   * `MAX_UNPAGINATED_ROWS` para nao estourar o tamanho de resposta da Vercel.
   */
  @ApiPropertyOptional({
    description:
      'Linhas por pagina (1 a 100), ou `all` para trazer todas de uma vez. Como a plataforma nao pagina, `all` custa uma unica consulta a origem - e mais eficiente que percorrer paginas.',
    default: 20,
    example: 'all',
    oneOf: [
      { type: 'integer', minimum: 1, maximum: 100 },
      { type: 'string', enum: ['all'] },
    ],
  })
  @IsOptional()
  @Transform(toReportLimit)
  @IsInt({ message: 'limit deve ser um numero inteiro ou `all`' })
  @Min(ALL_ROWS, { message: 'limit deve ser maior ou igual a 1, ou `all`' })
  @Max(100, { message: 'limit deve ser menor ou igual a 100, ou `all` para trazer todas' })
  limit: number = 20;
}
