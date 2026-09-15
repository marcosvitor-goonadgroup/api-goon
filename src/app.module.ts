import { MiddlewareConsumer, Module, type NestModule, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE, Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AppConfigModule } from './config/app-config.module';
import { CoreModule } from './core/core.module';
import { HealthModule } from './core/health/health.module';
import { AppLoggerModule } from './core/logger/logger.module';
import { AppThrottlerModule } from './core/throttler/throttler.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AdsModule } from './modules/ads/ads.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    // A configuracao vem primeiro: os demais modulos dependem dela no factory.
    AppConfigModule,
    AppLoggerModule,
    AppThrottlerModule,
    CoreModule,
    IntegrationsModule,
    SearchModule,
    AdsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    /**
     * Validacao global.
     *
     * `whitelist` + `forbidNonWhitelisted` fazem a API rejeitar parametros que
     * ela nao conhece, em vez de ignora-los em silencio - um erro de digitacao
     * do cliente vira 400 explicito, nao um filtro que nunca foi aplicado.
     */
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        validateCustomDecorators: true,
      }),
    },

    /**
     * Ordem importa: o rate limit roda antes da autenticacao, para que uma
     * enxurrada de requisicoes sem credencial tambem seja contida.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },

    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector],
      useFactory: (reflector: Reflector) => new ResponseInterceptor(reflector),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*splat');
  }
}
