import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { NormalizedRecordDto } from '../../../integrations/dto/connector.dto';

export type SourceOutcome = 'ok' | 'empty' | 'error' | 'timeout' | 'skipped';

/**
 * Resultado individual de cada origem consultada.
 *
 * A busca federada e deliberadamente tolerante a falhas parciais: se uma
 * origem cair, as demais continuam respondendo e este bloco diz exatamente o
 * que aconteceu com cada uma - o cliente decide se o resultado parcial serve.
 */
export class SourceOutcomeDto {
  @ApiProperty({ example: 'uol-ads' })
  key: string;

  @ApiProperty({
    enum: ['ok', 'empty', 'error', 'timeout', 'skipped'],
    description:
      'ok = retornou registros; empty = respondeu sem resultados; error = falhou; timeout = estourou o tempo; skipped = nao atende esta consulta.',
    example: 'ok',
  })
  outcome: SourceOutcome;

  @ApiProperty({ description: 'Registros devolvidos por esta origem.', example: 1 })
  count: number;

  @ApiProperty({ description: 'Tempo gasto nesta origem, em ms.', example: 187 })
  tookMs: number;

  @ApiPropertyOptional({
    description: 'Motivo da falha, quando `outcome` for error ou timeout.',
    example: 'A integracao "uol-ads" nao respondeu em 8000ms.',
  })
  error?: string;

  @ApiPropertyOptional({ description: 'Codigo estavel do erro.', example: 'INTEGRATION_TIMEOUT' })
  errorCode?: string;
}

export class SearchResultDto {
  @ApiProperty({
    description: 'Registros agregados de todas as origens, ja paginados.',
    type: [NormalizedRecordDto],
  })
  items: NormalizedRecordDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({
    description: 'Diagnostico por origem consultada.',
    type: [SourceOutcomeDto],
  })
  sources: SourceOutcomeDto[];

  @ApiProperty({
    description: 'Termo efetivamente consultado.',
    example: '00000000000191',
  })
  query: string;

  @ApiPropertyOptional({
    description: 'Capability usada no roteamento, quando informada.',
    example: 'cnpj',
  })
  capability?: string;

  @ApiProperty({
    description: 'Indica se alguma origem falhou (resultado possivelmente incompleto).',
    example: false,
  })
  partial: boolean;
}
