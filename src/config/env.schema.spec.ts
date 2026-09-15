import { buildAppConfig } from './configuration';
import { parseEnv } from './env.schema';

describe('parseEnv', () => {
  it('aplica os defaults quando o ambiente esta vazio', () => {
    const env = parseEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api');
    expect(env.CACHE_ENABLED).toBe(true);
  });

  it('converte numeros vindos como string', () => {
    const env = parseEnv({ PORT: '8080', HTTP_TIMEOUT_MS: '5000' });

    expect(env.PORT).toBe(8080);
    expect(env.HTTP_TIMEOUT_MS).toBe(5000);
  });

  it('interpreta booleanos em varias grafias', () => {
    expect(parseEnv({ SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
    expect(parseEnv({ SWAGGER_ENABLED: '0' }).SWAGGER_ENABLED).toBe(false);
    expect(parseEnv({ SWAGGER_ENABLED: 'TRUE' }).SWAGGER_ENABLED).toBe(true);
    expect(parseEnv({ SWAGGER_ENABLED: 'yes' }).SWAGGER_ENABLED).toBe(true);
  });

  it('converte listas separadas por virgula, ignorando espacos e vazios', () => {
    const env = parseEnv({ API_KEYS: ' chave-a , chave-b ,, ' });

    expect(env.API_KEYS).toEqual(['chave-a', 'chave-b']);
  });

  it('devolve lista vazia quando a variavel de lista nao foi definida', () => {
    expect(parseEnv({}).API_KEYS).toEqual([]);
    expect(parseEnv({}).CORS_ORIGINS).toEqual([]);
  });

  it('falha com mensagem util quando um valor e invalido', () => {
    expect(() => parseEnv({ PORT: 'nao-e-numero' })).toThrow(/Configuracao de ambiente invalida/);
    expect(() => parseEnv({ NODE_ENV: 'homologacao' })).toThrow(/NODE_ENV/);
  });

  it('reune todos os erros numa unica mensagem', () => {
    let message = '';

    try {
      parseEnv({ PORT: '-1', LOG_LEVEL: 'verboso' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
  });

  it('rejeita URL de conector malformada', () => {
    expect(() => parseEnv({ UOL_ADS_BASE_URL: 'nao-e-url' })).toThrow(/UOL_ADS_BASE_URL/);
  });
});

describe('buildAppConfig', () => {
  it('normaliza prefixo e caminho da documentacao removendo barras', () => {
    const config = buildAppConfig(parseEnv({ API_PREFIX: '/api/', SWAGGER_PATH: '/docs/' }));

    expect(config.apiPrefix).toBe('api');
    expect(config.swagger.path).toBe('docs');
  });

  it('normaliza o header de API key para minusculas', () => {
    const config = buildAppConfig(parseEnv({ API_KEY_HEADER: 'X-Minha-Chave' }));

    expect(config.security.apiKeyHeader).toBe('x-minha-chave');
  });

  it('deriva os atalhos de ambiente', () => {
    const production = buildAppConfig(parseEnv({ NODE_ENV: 'production' }));

    expect(production.isProduction).toBe(true);
    expect(production.isDevelopment).toBe(false);
  });
});
