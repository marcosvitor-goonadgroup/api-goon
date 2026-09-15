import { HttpModule } from '@nestjs/axios';
import { CacheModule, type CacheManagerOptions } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { CacheableMemory } from 'cacheable';

import { AppConfigService } from '../config/app-config.service';
import { ResilientHttpService } from './http/resilient-http.service';

/** Store aceito pelo `CacheModule` (uma instancia de Keyv ou adapter equivalente). */
type CacheStore = Extract<NonNullable<CacheManagerOptions['stores']>, readonly unknown[]>[number];

/**
 * Monta o store em memoria com teto de entradas.
 *
 * O `lruSize` importa: sem ele o cache cresce sem limite numa instancia de
 * vida longa (o fluid compute da Vercel reaproveita o processo entre
 * requisicoes), e chaves variadas o suficiente acabariam consumindo a memoria
 * da funcao.
 *
 * O cast cobre apenas uma diferenca de tipagem entre pacotes: o
 * `@nestjs/cache-manager` envolve qualquer store que nao seja Keyv/Cacheable
 * em `new Keyv({ store })` antes de usar, mas o `CacheableMemory` nao declara
 * `KeyvStoreAdapter` nominalmente.
 */
function createMemoryStore(config: AppConfigService): CacheStore {
  const store = new CacheableMemory({
    ttl: config.cache.ttlMs,
    lruSize: config.cache.maxItems,
  });

  return store as unknown as CacheStore;
}

/**
 * Infraestrutura transversal: cliente HTTP resiliente e cache.
 *
 * E global porque praticamente todo conector depende dele - registrar em cada
 * modulo de integracao so geraria repeticao.
 *
 * Nota sobre cache em serverless: o store em memoria vive dentro da instancia
 * da funcao. Com fluid compute a instancia e reaproveitada, entao o cache
 * funciona bem para rajadas; ele nao e compartilhado entre instancias. Para
 * cache global, troque o store por `@keyv/redis` (Upstash/Redis) - nenhum
 * outro arquivo precisa mudar.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        timeout: config.http.timeoutMs,
        maxRedirects: 3,
        headers: {
          'User-Agent': 'api-goon/1.0',
          Accept: 'application/json',
        },
        /**
         * Arrays viram chave repetida - `?d=A&d=B` - e nao o
         * `?d[]=A&d[]=B` que o axios usa por padrao.
         *
         * A forma com colchetes e rejeitada por boa parte das APIs (Spring,
         * por exemplo, responde "Required List parameter is not present"),
         * enquanto a chave repetida e entendida por praticamente todas.
         */
        paramsSerializer: { indexes: null },
      }),
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        ttl: config.cache.ttlMs,
        stores: [createMemoryStore(config)],
      }),
    }),
  ],
  providers: [ResilientHttpService],
  exports: [ResilientHttpService, HttpModule, CacheModule],
})
export class CoreModule {}
