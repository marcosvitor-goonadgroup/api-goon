import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, RawResponse } from '../../common/decorators/public.decorator';
import { ConnectorRegistryService } from '../../integrations/registry/connector-registry.service';
import { ConnectorsHealthIndicator } from './connectors.health-indicator';

/** Teto de heap aceitavel antes de considerar o processo degradado. */
const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;

/**
 * Rotas de diagnostico.
 *
 * Separar liveness de readiness e o que evita o pior cenario operacional: um
 * orquestrador reiniciar a aplicacao porque uma **dependencia externa** caiu.
 * `/health/live` so responde "o processo esta de pe"; `/health/ready` e que
 * consulta as integracoes.
 *
 * Todas sao publicas e devolvem o formato do Terminus, sem o envelope padrao -
 * ferramentas de monitoramento esperam exatamente essa forma.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly connectors: ConnectorsHealthIndicator,
    private readonly registry: ConnectorRegistryService,
  ) {}

  /**
   * Verificacao completa: processo + todas as integracoes.
   */
  @Get()
  @Public()
  @RawResponse()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check completo (processo + integracoes)' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      ...this.registry.enabled().map((connector) => () => this.connectors.check(connector)),
    ]);
  }

  /**
   * Liveness: a aplicacao esta de pe e respondendo?
   *
   * Nao toca em nenhum sistema externo de proposito.
   */
  @Get('live')
  @Public()
  @RawResponse()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness - nao consulta dependencias externas' })
  live(): Promise<HealthCheckResult> {
    return this.health.check([() => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES)]);
  }

  /**
   * Readiness: as integracoes respondem? Devolve 503 quando alguma esta fora.
   */
  @Get('ready')
  @Public()
  @RawResponse()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness - consulta todas as integracoes ativas' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check(
      this.registry.enabled().map((connector) => () => this.connectors.check(connector)),
    );
  }
}
