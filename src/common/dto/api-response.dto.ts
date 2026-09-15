import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Metadados presentes em toda resposta. Servem para rastrear a requisicao
 * ponta a ponta (o `requestId` aparece nos logs e no header `x-request-id`).
 */
export class ResponseMetaDto {
  @ApiProperty({
    description: 'Identificador de correlacao da requisicao.',
    example: '8f3d2c1a-5b6e-4f70-9c2d-1e4a7b9c0d11',
  })
  requestId: string;

  @ApiProperty({
    description: 'Momento em que a resposta foi gerada (ISO-8601, UTC).',
    example: '2026-09-11T18:30:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Tempo total de processamento no servidor, em milissegundos.',
    example: 142,
  })
  durationMs: number;
}

/**
 * Envelope de sucesso. `data` e generico - use os decorators de
 * `api-response.decorator.ts` para descrever o tipo concreto no Swagger.
 */
export class ApiSuccessResponseDto<T = unknown> {
  @ApiProperty({ description: 'Indica que a operacao foi concluida.', example: true })
  success: true;

  @ApiProperty({ description: 'Conteudo devolvido pela operacao.' })
  data: T;

  @ApiProperty({ type: ResponseMetaDto })
  meta: ResponseMetaDto;
}

/** Detalhamento de um erro de validacao, campo a campo. */
export class ValidationIssueDto {
  @ApiProperty({ description: 'Campo que falhou na validacao.', example: 'limit' })
  field: string;

  @ApiProperty({
    description: 'Descricoes das regras violadas.',
    example: ['limit deve ser menor ou igual a 100'],
    type: [String],
  })
  messages: string[];
}

export class ApiErrorDetailDto {
  @ApiProperty({
    description: 'Codigo estavel do erro. Programe contra ele, nao contra a mensagem.',
    example: 'VALIDATION_ERROR',
  })
  code: string;

  @ApiProperty({
    description: 'Mensagem legivel descrevendo a falha.',
    example: 'Os dados enviados sao invalidos.',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Informacoes adicionais (itens de validacao, resposta do sistema externo...).',
  })
  details?: unknown;

  @ApiPropertyOptional({
    description: 'Conector envolvido, quando o erro vem de uma integracao.',
    example: 'uol-ads',
  })
  source?: string;
}

/** Envelope de erro. Mesma forma para 4xx e 5xx. */
export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success: false;

  @ApiProperty({ type: ApiErrorDetailDto })
  error: ApiErrorDetailDto;

  @ApiProperty({ type: ResponseMetaDto })
  meta: ResponseMetaDto;

  @ApiProperty({ description: 'Rota que originou o erro.', example: '/api/v1/search' })
  path: string;

  @ApiProperty({ description: 'Status HTTP.', example: 400 })
  statusCode: number;
}
