import { Module } from '@nestjs/common';

import { IntegrationsModule } from '../../integrations/integrations.module';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

/**
 * Rotas de midia.
 *
 * Depende do `IntegrationsModule`, que ja exporta os conectores - o
 * `UolAdsConnector` e reaproveitado aqui em vez de duplicar o acesso a origem.
 */
@Module({
  imports: [IntegrationsModule],
  controllers: [AdsController],
  providers: [AdsService],
  exports: [AdsService],
})
export class AdsModule {}
