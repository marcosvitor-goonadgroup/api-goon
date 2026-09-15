import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import type { DataConnector } from '../../integrations/contracts/connector.contract';

/**
 * Traduz o health check de um conector para o formato do Terminus.
 *
 * Duas decisoes deliberadas sobre o que conta como falha:
 *
 * - **desabilitado nao e falha**: desligar uma integracao por configuracao e
 *   uma decisao, nao um incidente. Sai como `up` com a marca `disabled`.
 * - **degradado nao derruba o check**: a origem esta lenta, mas responde.
 *   Sai como `up` com `degraded: true`, para nao disparar alarme nem fazer
 *   um orquestrador tirar a aplicacao do ar por lentidao de terceiro.
 *
 * Apenas `down` (origem fora ou circuito aberto) marca o indicador como falho.
 */
@Injectable()
export class ConnectorsHealthIndicator {
  constructor(private readonly healthIndicator: HealthIndicatorService) {}

  async check(connector: DataConnector): Promise<HealthIndicatorResult> {
    const session = this.healthIndicator.check(connector.metadata.key);
    const health = await connector.health();

    const data = {
      circuit: health.circuit.state,
      failures: health.circuit.failures,
      ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}),
      ...(health.message ? { message: health.message } : {}),
    };

    switch (health.status) {
      case 'up':
        return session.up(data);
      case 'degraded':
        return session.up({ ...data, degraded: true });
      case 'disabled':
        return session.up({ ...data, disabled: true });
      default:
        return session.down(data);
    }
  }
}
