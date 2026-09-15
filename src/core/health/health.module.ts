import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { IntegrationsModule } from '../../integrations/integrations.module';
import { ConnectorsHealthIndicator } from './connectors.health-indicator';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TerminusModule.forRoot({
      // O formato de erro continua sendo tratado pelo filtro global.
      errorLogStyle: 'pretty',
    }),
    IntegrationsModule,
  ],
  controllers: [HealthController],
  providers: [ConnectorsHealthIndicator],
})
export class HealthModule {}
