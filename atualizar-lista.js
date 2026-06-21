'use strict';

const https = require('https');
const fs = require('fs');
const puppeteer = require('puppeteer');

const URL_PROCON = 'https://sistemas.procon.sp.gov.br/evitesite/list/evitesites.php';
const URL_OPENPHISH = 'https://openphish.com/feed.txt';
const OUTPUT_FILE = 'blocklist.json';
const TIMEOUT_MS = 15_000;

// Domínios legítimos: qualquer subdomínio destes também é ignorado
const IGNORE_LIST = [
  'microsoft.com', 'google.com', 'google.com.br', 'youtube.com',
  'w3.org', 'w3c.org', 'github.com', 'apple.com', 'amazon.com',
  'facebook.com', 'instagram.com', 'whatsapp.com', 'linkedin.com',
];

function ehDominioIgnorado(dominio) {
  return IGNORE_LIST.some(
    (seguro) => dominio === seguro || dominio.endsWith('.' + seguro)
  );
}

function fazerRequisicao(url, opcoes = {}, redirecionamentos = 0) {
  return new Promise((resolve, reject) => {
    if (redirecionamentos > 5) {
      return reject(new Error('Limite de redirecionamentos excedido'));
    }

    const req = https.get(url, opcoes, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fazerRequisicao(res.headers.location, opcoes, redirecionamentos + 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status HTTP inesperado: ${res.statusCode} em ${url}`));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout de ${TIMEOUT_MS}ms excedido em ${url}`));
    });

    req.on('error', reject);
  });
}

function extrairDominio(url) {
  try {
    const urlFormatada = url.startsWith('http') ? url : 'http://' + url;
    return new URL(urlFormatada).hostname.replace(/^www\./, '').toLowerCase().trim();
  } catch {
    return null;
  }
}

async function coletarProcon(destino) {
  console.log('⏳ Coletando dados do Procon-SP via Puppeteer...');

  const browser = await puppeteer.launch({
    headless: true,  // 'new' foi depreciado nas versões recentes do Puppeteer
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(URL_PROCON, { waitUntil: 'networkidle2', timeout: 30_000 });
    await page.waitForSelector('table tr td', { timeout: 20_000 });

    const textosCelulas = await page.$$eval('table tr td', (cells) =>
      cells.map((c) => c.innerText.trim())
    );

    let contador = 0;

    for (const texto of textosCelulas) {
      const dominio = extrairDominio(texto);
      if (dominio && dominio.length > 4 && !ehDominioIgnorado(dominio)) {
        destino.add(dominio);
        contador++;
      }
    }

    console.log(`✅ Procon-SP: ${contador} domínios encontrados.`);
  } finally {
    await browser.close();
  }
}

async function coletarOpenPhish(destino) {
  console.log('⏳ Coletando dados do OpenPhish...');

  const texto = await fazerRequisicao(URL_OPENPHISH);
  const linhas = texto.split('\n');
  let contador = 0;

  for (const linha of linhas) {
    const url = linha.trim();
    if (!url) continue;

    const dominio = extrairDominio(url);
    if (!dominio) continue;
    if (ehDominioIgnorado(dominio)) continue;

    destino.add(dominio);
    contador++;
  }

  console.log(`✅ OpenPhish: ${contador} domínios encontrados.`);
}

async function rodarRobo() {
  console.log('🤖 Iniciando atualização da Blocklist Híbrida...\n');

  const todosOsDominios = new Set();
  const erros = [];

  await coletarProcon(todosOsDominios).catch((err) => {
    erros.push(`Procon-SP: ${err.message}`);
    console.error('❌ Erro ao coletar dados do Procon-SP:', err.message);
  });

  await coletarOpenPhish(todosOsDominios).catch((err) => {
    erros.push(`OpenPhish: ${err.message}`);
    console.error('❌ Erro ao coletar dados do OpenPhish:', err.message);
  });

  if (todosOsDominios.size === 0) {
    console.error('\n🚫 Nenhum domínio coletado. Arquivo NÃO atualizado.');
    console.error('   Erros encontrados:');
    erros.forEach((e) => console.error('   -', e));
    process.exit(1);
  }

  const listaFinal = Array.from(todosOsDominios).sort();

  try {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(listaFinal, null, 2), 'utf-8');
    console.log(`\n🚀 Sucesso! ${OUTPUT_FILE} atualizado com ${listaFinal.length} domínios.`);

    if (erros.length > 0) {
      console.warn('\n⚠️  Atenção: algumas fontes falharam:');
      erros.forEach((e) => console.warn('   -', e));
    }
  } catch (err) {
    console.error('\n❌ Erro ao gravar o arquivo:', err.message);
    process.exit(1);
  }
}

rodarRobo();
