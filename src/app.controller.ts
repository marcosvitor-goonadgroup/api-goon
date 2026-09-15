import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { Public } from './common/decorators/public.decorator';
import { ApiStandardResponse } from './common/decorators/api-response.decorator';
import { AppConfigService } from './config/app-config.service';
import { ConnectorRegistryService } from './integrations/registry/connector-registry.service';

export class ApiInfoDto {
  @ApiProperty({ example: 'api-goon' })
  name: string;

  @ApiProperty({ example: '1' })
  version: string;

  @ApiProperty({ example: 'production' })
  environment: string;

  @ApiProperty({ description: 'Caminho da documentacao interativa.', example: '/docs' })
  docs: string;

  @ApiProperty({ description: 'Caminho base das rotas versionadas.', example: '/api/v1' })
  basePath: string;

  @ApiProperty({ description: 'Integracoes ativas.', example: ['uol-ads'] })
  integrations: string[];

  @ApiProperty({ description: 'Segundos desde o start da instancia.', example: 1284 })
  uptimeSeconds: number;
}

/**
 * Rota de apresentacao da API.
 *
 * Fica fora do prefixo versionado de proposito: e o primeiro lugar onde
 * alguem bate ao receber a URL, e deve responder sem que a pessoa precise
 * adivinhar o caminho correto.
 */
@ApiTags('Sistema')
@Controller({ path: '', version: VERSION_NEUTRAL })
export class AppController {
  constructor(
    private readonly config: AppConfigService,
    private readonly registry: ConnectorRegistryService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Informacoes da API e pontos de entrada' })
  @ApiStandardResponse(ApiInfoDto)
  info(): ApiInfoDto {
    return {
      name: 'api-goon',
      version: this.config.apiVersion,
      environment: this.config.env,
      docs: this.config.swagger.enabled ? `/${this.config.swagger.path}` : 'desabilitada',
      basePath: `/${this.config.apiPrefix}/v${this.config.apiVersion}`,
      integrations: this.registry.enabled().map((connector) => connector.metadata.key),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
