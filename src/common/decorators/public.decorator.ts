import { SetMetadata } from '@nestjs/common';

import { IS_PUBLIC_KEY, RAW_RESPONSE_KEY } from '../constants';

/**
 * Libera a rota do `ApiKeyGuard`.
 *
 * Use em health checks, documentacao e endpoints deliberadamente abertos.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Devolve o payload cru, sem o envelope `{ success, data, meta }`.
 *
 * Necessario quando um consumidor externo exige um formato especifico
 * (webhooks, callbacks de terceiros, specs OpenAPI servidas como JSON).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
