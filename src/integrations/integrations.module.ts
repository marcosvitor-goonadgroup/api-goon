import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { UolAdsConnector } from './connectors/uol-ads/uol-ads.connector';
import { IntegrationsController } from './integrations.controller';
import { ConnectorRegistryService } from './registry/connector-registry.service';

/**
 * Ponto unico de registro das integracoes.
 *
 * Para plugar um sistema novo:
 *   1. crie `connectors/<nome>/<nome>.connector.ts` estendendo `BaseHttpConnector`;
 *   2. anote a classe com `@Injectable()` e `@RegisterConnector()`;
 *   3. adicione a classe no array `CONNECTORS` abaixo.
 *
 * Nada mais precisa mudar: catalogo, health check e busca federada passam a
 * enxergar o conector automaticamente.
 */
const CONNECTORS = [UolAdsConnector];

@Module({
  imports: [DiscoveryModule],
  controllers: [IntegrationsController],
  providers: [ConnectorRegistryService, ...CONNECTORS],
  exports: [ConnectorRegistryService, ...CONNECTORS],
})
export class IntegrationsModule {}
