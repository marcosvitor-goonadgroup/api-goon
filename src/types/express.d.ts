/**
 * Campos que os middlewares da aplicacao anexam a requisicao Express.
 * Declaration merging mantem o acesso tipado sem `as any` espalhado.
 */
declare global {
  namespace Express {
    interface Request {
      /** Identificador de correlacao propagado para logs e resposta. */
      requestId?: string;
      /** `Date.now()` do inicio do processamento, usado para medir a duracao. */
      requestStartedAt?: number;
      /** Chave de API autenticada (quando a autenticacao esta ativa). */
      apiKey?: string;
    }
  }
}

export {};
