import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Query de paginacao reutilizavel. Herde dela nos DTOs de listagem para que
 * todos os endpoints de busca exponham os mesmos parametros.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Pagina desejada, começando em 1.',
    minimum: 1,
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page deve ser um numero inteiro' })
  @Min(1, { message: 'page deve ser maior ou igual a 1' })
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Quantidade de itens por pagina.',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um numero inteiro' })
  @Min(1, { message: 'limit deve ser maior ou igual a 1' })
  @Max(100, { message: 'limit deve ser menor ou igual a 100' })
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Campo usado na ordenacao.',
    example: 'name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Direcao da ordenacao.',
    enum: SortDirection,
    default: SortDirection.ASC,
  })
  @IsOptional()
  @IsEnum(SortDirection, { message: 'sortOrder deve ser "asc" ou "desc"' })
  sortOrder: SortDirection = SortDirection.ASC;

  /** Deslocamento equivalente, util para repassar a sistemas externos. */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ description: 'Total de itens disponiveis.', example: 137 })
  total: number;

  @ApiProperty({ description: 'Total de paginas.', example: 7 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}

/** Resultado paginado generico devolvido pelos services de busca. */
export class PaginatedDto<T> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

/** Monta o bloco de paginacao a partir do total e da query usada. */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMetaDto {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && total > 0,
  };
}

/** Aplica paginacao em memoria - util para conectores que devolvem tudo de uma vez. */
export function paginate<T>(items: T[], page: number, limit: number): PaginatedDto<T> {
  const start = (page - 1) * limit;

  return {
    items: items.slice(start, start + limit),
    pagination: buildPaginationMeta(items.length, page, limit),
  };
}
