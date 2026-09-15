/** Header que carrega (ou devolve) o identificador de correlacao da requisicao. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Chave usada para guardar o request id no objeto de requisicao. */
export const REQUEST_ID_KEY = 'requestId';

/** Chave usada para guardar o inicio do processamento (hrtime em ms). */
export const REQUEST_START_KEY = 'requestStartedAt';

/** Metadata: marca uma rota como publica (ignora o guard de API key). */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Metadata: marca uma rota que devolve o payload cru, sem o envelope padrao. */
export const RAW_RESPONSE_KEY = 'response:raw';

/**
 * Codigos de erro estaveis da API. O cliente deve programar contra estes
 * valores - a mensagem em texto pode mudar, o codigo nao.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INTEGRATION_ERROR: 'INTEGRATION_ERROR',
  INTEGRATION_TIMEOUT: 'INTEGRATION_TIMEOUT',
  INTEGRATION_UNAVAILABLE: 'INTEGRATION_UNAVAILABLE',
  INTEGRATION_NOT_FOUND: 'INTEGRATION_NOT_FOUND',
  UPSTREAM_INVALID_RESPONSE: 'UPSTREAM_INVALID_RESPONSE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
