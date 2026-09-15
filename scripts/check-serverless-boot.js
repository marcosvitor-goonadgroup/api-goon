#!/usr/bin/env node
/**
 * Verifica se a aplicacao sobe sob as regras do runtime serverless.
 *
 * Dois erros ja derrubaram o deploy inteiro - ambos no boot, antes de qualquer
 * rota existir, o que faz a API responder 500 por completo:
 *
 * 1. `ERR_REQUIRE_ESM` - um pacote CommonJS carregando um pacote ESM via
 *    `require()`. O Node local (>= 22.12) permite; o runtime da Vercel nao.
 *    `--no-experimental-require-module` impoe a mesma restricao aqui.
 *
 * 2. Ambiente sem variaveis configuradas. Na Vercel, enquanto nada e cadastrado
 *    em Settings > Environment Variables, a aplicacao sobe com os defaults do
 *    schema - e precisa subir mesmo assim, ainda que degradada.
 *
 * Por isso os dois cenarios abaixo. Uso:
 *
 *   npm run build && npm run check:serverless
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const BASE_PORT = Number(process.env.CHECK_PORT ?? '3399');
const BOOT_TIMEOUT_MS = 60_000;
const ENTRYPOINT = path.join(__dirname, '..', 'dist', 'main.js');

/** Rotas que cobrem os principais caminhos de carregamento de modulos. */
const ROUTES = ['/', '/health/live', '/docs', '/docs/openapi.json', '/docs/swagger'];

/**
 * `NODE_ENV: undefined` remove a variavel em vez de sobrescreve-la, para
 * exercitar o default do schema - que e o estado real de um projeto recem
 * publicado na Vercel.
 */
const SCENARIOS = [
  {
    name: 'producao configurada',
    env: { NODE_ENV: 'production', LOG_LEVEL: 'warn', SWAGGER_ENABLED: 'true' },
  },
  {
    name: 'sem variaveis cadastradas',
    env: { NODE_ENV: undefined, LOG_LEVEL: undefined, SWAGGER_ENABLED: undefined },
  },
];

if (!fs.existsSync(ENTRYPOINT)) {
  console.error('dist/main.js nao encontrado. Rode "npm run build" antes.');
  process.exit(1);
}

const get = (port, route) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: route }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });

/** Aguarda a porta aceitar conexao, em vez de dormir um tempo fixo. */
const waitForBoot = async (port, hasExited) => {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (hasExited()) return false;
    try {
      await get(port, '/health/live');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
};

const diagnose = (output) => {
  if (output.includes('ERR_REQUIRE_ESM')) {
    return (
      'Uma dependencia CommonJS importa um pacote ESM via require(), o que quebra na Vercel.\n' +
      '  Saidas: trocar o pacote, carrega-lo com import() dinamico, ou servir o recurso por CDN.'
    );
  }
  if (output.includes('unable to determine transport target')) {
    return (
      'O pino pediu um transport que nao existe no bundle (tipicamente `pino-pretty`,\n' +
      '  que e devDependency e e carregado por nome, fora do alcance do rastreamento de arquivos).'
    );
  }
  if (output.includes('Configuracao de ambiente invalida')) {
    return 'O schema de ambiente recusou os valores. Confira as variaveis cadastradas na Vercel.';
  }
  return null;
};

const runScenario = async (scenario, port) => {
  const env = { ...process.env, PORT: String(port) };
  for (const [key, value] of Object.entries(scenario.env)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const child = spawn(process.execPath, ['--no-experimental-require-module', ENTRYPOINT], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let exited = false;
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  child.on('exit', () => (exited = true));

  const stop = () => {
    if (!child.killed) child.kill();
  };

  console.log(`\n[${scenario.name}]`);

  if (!(await waitForBoot(port, () => exited))) {
    stop();
    const hint = diagnose(output);
    console.error('  a aplicacao nao subiu.');
    if (hint) console.error(`\n  Causa provavel: ${hint}`);
    const relevant = output
      .split('\n')
      .filter((line) => /error|Error/.test(line))
      .slice(0, 6);
    if (relevant.length) console.error(`\n${relevant.join('\n')}`);
    return false;
  }

  let failures = 0;
  for (const route of ROUTES) {
    const status = await get(port, route).catch(() => 0);
    const ok = status >= 200 && status < 400;
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok   ' : 'FALHA'} ${route} -> HTTP ${status || 'sem resposta'}`);
  }

  stop();
  return failures === 0;
};

void (async () => {
  let allPassed = true;

  for (const [index, scenario] of SCENARIOS.entries()) {
    const passed = await runScenario(scenario, BASE_PORT + index);
    if (!passed) allPassed = false;
  }

  if (!allPassed) {
    console.error('\n[FALHOU] a aplicacao nao sobe sob as regras do runtime serverless.');
    process.exit(1);
  }

  console.log('\nboot compativel com o runtime serverless.');
  process.exit(0);
})();
