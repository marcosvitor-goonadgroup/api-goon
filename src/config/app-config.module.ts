import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { configuration } from './configuration';

/**
 * Modulo global de configuracao.
 *
 * `cache: true` evita releitura de `process.env` a cada acesso - relevante em
 * ambiente serverless, onde a instancia e reaproveitada entre requisicoes.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
