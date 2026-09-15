import { SetMetadata } from '@nestjs/common';

/** Metadata usada pelo registry para descobrir conectores via DiscoveryService. */
export const CONNECTOR_METADATA_KEY = 'integration:connector';

/**
 * Marca uma classe como conector de dados.
 *
 * Combinada com o `ConnectorRegistryService`, elimina a necessidade de manter
 * uma lista central de integracoes: basta anotar a classe e registra-la como
 * provider do seu proprio modulo.
 */
export const RegisterConnector = () => SetMetadata(CONNECTOR_METADATA_KEY, true);
