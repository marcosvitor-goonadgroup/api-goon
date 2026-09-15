import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiIntegrationErrors,
  ApiStandardErrors,
  ApiStandardResponse,
} from '../common/decorators/api-response.decorator';
import { ConnectorHealthDto, ConnectorMetadataDto } from './dto/connector.dto';
import { ConnectorRegistryService } from './registry/connector-registry.service';

@ApiTags('Integracoes')
@ApiStandardErrors()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly registry: ConnectorRegistryService) {}

  /**
   * Catalogo de integracoes.
   *
   * Use esta rota para descobrir, em tempo de execucao, quais sistemas estao
   * disponiveis e o que cada um sabe responder - sem precisar reler a
   * documentacao a cada integracao nova.
   */
  @Get()
  @ApiOperation({ summary: 'Lista as integracoes disponiveis e suas capabilities' })
  @ApiStandardResponse(ConnectorMetadataDto, { isArray: true })
  list(): ConnectorMetadataDto[] {
    return this.registry.catalog();
  }

  /**
   * Capabilities suportadas por pelo menos um conector ativo.
   *
   * Sao os valores aceitos no parametro `capability` da busca.
   */
  @Get('capabilities')
  @ApiOperation({ summary: 'Lista as capabilities disponiveis para busca' })
  @ApiStandardResponse(String, { isArray: true })
  capabilities(): string[] {
    return this.registry.capabilities();
  }

  /**
   * Estado de saude de todas as integracoes, incluindo o disjuntor de cada uma.
   */
  @Get('health')
  @ApiOperation({ summary: 'Verifica a saude de todas as integracoes' })
  @ApiStandardResponse(ConnectorHealthDto, { isArray: true })
  @ApiIntegrationErrors()
  async healthAll(): Promise<ConnectorHealthDto[]> {
    // Em paralelo: uma origem lenta nao deve atrasar o diagnostico das outras.
    return Promise.all(this.registry.all().map((connector) => connector.health()));
  }

  /**
   * Metadados de uma integracao especifica.
   */
  @Get(':key')
  @ApiOperation({ summary: 'Detalha uma integracao' })
  @ApiParam({ name: 'key', description: 'Chave do conector', example: 'uol-ads' })
  @ApiStandardResponse(ConnectorMetadataDto)
  detail(@Param('key') key: string): ConnectorMetadataDto {
    const connector = this.registry.get(key);
    return { ...connector.metadata, enabled: connector.isEnabled() };
  }

  /**
   * Saude de uma integracao especifica.
   */
  @Get(':key/health')
  @ApiOperation({ summary: 'Verifica a saude de uma integracao' })
  @ApiParam({ name: 'key', description: 'Chave do conector', example: 'uol-ads' })
  @ApiStandardResponse(ConnectorHealthDto)
  @ApiIntegrationErrors()
  health(@Param('key') key: string): Promise<ConnectorHealthDto> {
    return this.registry.get(key).health();
  }
}
