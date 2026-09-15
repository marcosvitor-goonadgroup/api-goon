import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * Query strings chegam como `string`, `string[]` ou - com a sintaxe
 * `?x[y]=z` - como objeto. Os conversores abaixo aceitam apenas escalares e
 * descartam o resto, em vez de produzir `"[object Object]"` silenciosamente.
 */
const asScalar = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;

/** Converte `?sources=a,b` ou `?sources=a&sources=b` em `['a','b']`. */
const toStringArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  const items = Array.isArray(value) ? value : [value];

  return items
    .flatMap((item) => asScalar(item)?.split(',') ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
};

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;

  const scalar = asScalar(value);
  return scalar === undefined ? undefined : ['true', '1', 'yes'].includes(scalar.toLowerCase());
};

export class SearchQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Termo buscado. Aceita CNPJ, CEP, DDD, codigo ou nome de banco.',
    example: '00000000000191',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1, { message: 'q nao pode ser vazio' })
  @MaxLength(200)
  q: string;

  @ApiPropertyOptional({
    description:
      'Restringe a um tipo de consulta. Quando omitido, cada conector deduz pelo formato do termo. Valores validos em GET /integrations/capabilities.',
    example: 'cnpj',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  capability?: string;

  @ApiPropertyOptional({
    description:
      'Limita a busca a conectores especificos (separados por virgula). Omitido = consulta todos os compativeis.',
    example: 'uol-ads',
    type: String,
  })
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  sources?: string[];

  @ApiPropertyOptional({
    description: 'Inclui em cada registro o payload original devolvido pela origem.',
    default: false,
    example: false,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeRaw?: boolean;

  @ApiPropertyOptional({
    description:
      'Filtros especificos do conector, no formato `filters[chave]=valor`. Repassados a integracao que os entenda; os conectores atuais buscam apenas por termo e ignoram este campo.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}
