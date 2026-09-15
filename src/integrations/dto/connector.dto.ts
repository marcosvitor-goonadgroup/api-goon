import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Descreve uma integracao disponivel no catalogo. */
export class ConnectorMetadataDto {
  @ApiProperty({
    description: 'Chave usada nas rotas e no parametro `sources`.',
    example: 'uol-ads',
  })
  key: string;

  @ApiProperty({ example: 'UOL Ads' })
  label: string;

  @ApiProperty({
    example: 'Dados publicos brasileiros: empresas por CNPJ, enderecos por CEP, bancos e DDDs.',
  })
  description: string;

  @ApiProperty({
    description: 'Tipos de consulta atendidos por este conector.',
    example: ['cnpj', 'cep', 'bank', 'ddd'],
    type: [String],
  })
  capabilities: string[];

  @ApiProperty({ example: 'https://api.ads.uol.com.br' })
  baseUrl: string;

  @ApiPropertyOptional({ example: 'https://api.ads.uol.com.br/swagger-ui/index.html' })
  docsUrl?: string;

  @ApiProperty({ description: 'Se a integracao exige credencial configurada.', example: false })
  requiresCredentials: boolean;

  @ApiProperty({ description: 'Se esta ligada no ambiente atual.', example: true })
  enabled: boolean;
}

export class CircuitSnapshotDto {
  @ApiProperty({ enum: ['closed', 'open', 'half-open'], example: 'closed' })
  state: string;

  @ApiProperty({ description: 'Falhas consecutivas acumuladas.', example: 0 })
  failures: number;

  @ApiProperty({ nullable: true, example: null })
  lastFailureAt: string | null;

  @ApiProperty({
    description: 'Quando o circuito voltara a aceitar chamadas.',
    nullable: true,
    example: null,
  })
  retryAt: string | null;
}

export class ConnectorHealthDto {
  @ApiProperty({ example: 'uol-ads' })
  key: string;

  @ApiProperty({ enum: ['up', 'degraded', 'down', 'disabled'], example: 'up' })
  status: string;

  @ApiProperty({ type: CircuitSnapshotDto })
  circuit: CircuitSnapshotDto;

  @ApiPropertyOptional({ description: 'Latencia medida na verificacao.', example: 187 })
  latencyMs?: number;

  @ApiPropertyOptional({ example: 'Origem respondendo lentamente.' })
  message?: string;

  @ApiProperty({ example: '2026-09-11T18:30:00.000Z' })
  checkedAt: string;
}

/** Registro normalizado - forma comum a todas as origens. */
export class NormalizedRecordDto {
  @ApiProperty({ description: 'Identificador do registro na origem.', example: '00000000000191' })
  id: string;

  @ApiProperty({
    description: 'Natureza do dado.',
    example: 'company',
  })
  type: string;

  @ApiProperty({ example: 'BANCO DO BRASIL SA' })
  title: string;

  @ApiPropertyOptional({ example: 'Bancos comerciais' })
  subtitle?: string;

  @ApiProperty({ description: 'Conector que produziu o registro.', example: 'uol-ads' })
  source: string;

  @ApiProperty({
    description: 'Dados normalizados. O formato varia conforme `type`.',
    type: 'object',
    additionalProperties: true,
    example: { document: '00000000000191', legalName: 'BANCO DO BRASIL SA' },
  })
  attributes: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Resposta original da origem. Presente apenas com `includeRaw=true`.',
  })
  raw?: unknown;

  @ApiProperty({ example: '2026-09-11T18:30:00.000Z' })
  retrievedAt: string;
}
