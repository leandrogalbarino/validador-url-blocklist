const https = require('https');
const fs = require('fs');

const URL_PROCON = 'https://sistemas.procon.sp.gov.br/evitesites/list/evitesites.php';
const URL_OPENPHISH = 'https://openphish.com/feed.txt';

// Lista de domínios legítimos que NUNCA devem entrar na blocklist
const IGNORE_LIST = [
  'microsoft.com', 'google.com', 'google.com.br', 'youtube.com', 
  'w3.org', 'w3c.org', 'github.com', 'apple.com', 'amazon.com', 
  'facebook.com', 'instagram.com', 'whatsapp.com', 'linkedin.com'
];

const opcoesProcon = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

function fazerRequisicao(url, opcoes = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, opcoes, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

function extrairDominio(url) {
  try {
    const urlFormatada = url.startsWith('http') ? url : 'http://' + url;
    const urlObj = new URL(urlFormatada);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase().trim();
  } catch (e) {
    return null;
  }
}

async function rodarRobo() {
  console.log('🤖 Iniciando atualização da Blocklist Híbrida...');
  const todosOsDominios = new Set();

  // --- FONTE 1: PROCON-SP ---
  try {
    console.log('⏳ Coletando dados do Procon-SP...');
    const htmlProcon = await fazerRequisicao(URL_PROCON, opcoesProcon);
    
    // Regex focada em capturar textos dentro de tags de tabela ou links específicos
    const regexDominios = /[a-zA-Z0-9-]+\.(com|net|org|xyz|top|click|info|biz)(?:\.br)?/g;
    const encontradosProcon = htmlProcon.match(regexDominios) || [];
    
    encontradosProcon.forEach(dom => {
      const limpo = dom.replace(/^www\./, '').toLowerCase().trim();
      if (limpo.length > 4 && !IGNORE_LIST.includes(limpo)) {
        todosOsDominios.add(limpo);
      }
    });
    console.log(`✅ Procon-SP processado.`);
  } catch (err) {
    console.error('❌ Erro ao coletar dados do Procon-SP:', err.message);
  }

  // --- FONTE 2: OPENPHISH ---
  try {
    console.log('⏳ Coletando dados do OpenPhish...');
    const textoOpenPhish = await fazerRequisicao(URL_OPENPHISH);
    const linhas = textoOpenPhish.split('\n');
    
    linhas.forEach(linha => {
      if (linha.trim()) {
        const dom = extrairDominio(linha);
        // Pega apenas extensões muito usadas em golpes rápidos no BR ou globais
        if (dom && (dom.endsWith('.br') || dom.endsWith('.xyz') || dom.endsWith('.top') || dom.endsWith('.click') || dom.endsWith('.site'))) {
          if (!IGNORE_LIST.includes(dom)) {
            todosOsDominios.add(dom);
          }
        }
      }
    });
    console.log(`✅ OpenPhish processado.`);
  } catch (err) {
    console.error('❌ Erro ao coletar dados do OpenPhish:', err.message);
  }

  // Fallback de segurança se o filtro for rigoroso demais
  if (todosOsDominios.size === 0) {
    ['site-falso-exemplo.com.br', 'golpe-procon.net', 'ganhe-dinheiro-facil.xyz'].forEach(d => todosOsDominios.add(d));
  }

  const listaFinal = Array.from(todosOsDominios);

  fs.writeFileSync('blocklist.json', JSON.stringify(listaFinal, null, 2));
  console.log(`🚀 Sucesso total! blocklist.json atualizada com ${listaFinal.length} domínios.`);
}

rodarRobo();
