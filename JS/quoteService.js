const CONFIG = { MYMEMORY_EMAIL: '' };

// ================== UTILITÁRIOS ==================
async function fetchJSON(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const decodificar = (s) =>
  new DOMParser().parseFromString(s, 'text/html').documentElement.textContent;

// Busca por tema: compara palavras sem acento, pelo começo da palavra (virtue ~ virtues)
const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const IGNORAR = new Set(['the', 'and', 'for', 'you', 'not', 'are', 'que', 'uma', 'com', 'dos', 'das', 'por']);
const termosDe = (s) => [
  ...new Set(semAcento(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !IGNORAR.has(w)))
];
const casa = (texto, termos) => {
  const palavras = semAcento(texto).split(/[^a-z0-9]+/);
  return termos.some((t) => palavras.some((p) => p.startsWith(t)));
};

// ================== TRADUÇÃO (MyMemory) ==================
const cacheTraducao = new Map();

// MyMemory aceita ~500 bytes por requisição, então frases longas são divididas
function dividir(texto, max = 350) {
  const partes = texto.match(/[^.!?;]+[.!?;]*\s*/g) || [texto];
  const chunks = [];
  let atual = '';
  for (const p of partes) {
    if ((atual + p).length > max && atual) {
      chunks.push(atual.trim());
      atual = p;
    } else {
      atual += p;
    }
  }
  if (atual.trim()) chunks.push(atual.trim());
  return chunks;
}

async function traduzir(texto, de = 'en', para = 'pt-BR') {
  const chave = `${de}|${para}|${texto}`;
  if (cacheTraducao.has(chave)) return cacheTraducao.get(chave);

  try {
    const partes = [];
    for (const parte of dividir(texto)) {
      const params = new URLSearchParams({ q: parte, langpair: `${de}|${para}` });
      if (CONFIG.MYMEMORY_EMAIL) params.set('de', CONFIG.MYMEMORY_EMAIL);
      const data = await fetchJSON(`https://api.mymemory.translated.net/get?${params}`);
      const t = data && data.responseData && data.responseData.translatedText;
      // Quando a cota diária acaba, o MyMemory devolve um aviso no lugar da tradução
      if (Number(data.responseStatus) !== 200 || !t || /MYMEMORY WARNING/i.test(t)) {
        throw new Error('Tradução indisponível');
      }
      partes.push(decodificar(t));
    }
    const resultado = { texto: partes.join(' '), traduzido: true };
    cacheTraducao.set(chave, resultado);
    return resultado;
  } catch (err) {
    console.error('Erro na tradução:', err.message);
    return { texto, traduzido: false };
  }
}

// ================== WIKIQUOTE (frases já em português) ==================
const cacheWiki = new Map();

function limparWiki(s) {
  return s
    .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["“”«»]+|["“”«»]+$/g, '')
    .trim();
}

// Carrega todas as frases de uma página do Wikiquote (com cache)
async function carregarFrasesWiki(pagina, lang) {
  const id = `${lang}:${pagina}`;
  if (cacheWiki.has(id)) return cacheWiki.get(id);

  const url =
    `https://${lang}.wikiquote.org/w/api.php?action=parse&page=${encodeURIComponent(pagina)}` +
    `&prop=wikitext&redirects=1&format=json&formatversion=2&origin=*`;
  const data = await fetchJSON(url, 10000);
  let wikitext = data.parse.wikitext;

  // Corta a partir das seções de "citações sobre" / links / referências
  const corte = wikitext.search(
    /^==\s*(Sobre|Citações sobre|About|Quotes about|Ver também|See also|Ligações externas|Links externos|External links|Referências|References)/im
  );
  if (corte > 0) wikitext = wikitext.slice(0, corte);

  const frases = wikitext
    .split('\n')
    .filter((l) => /^\*[^*]/.test(l))
    .map((l) => limparWiki(l.replace(/^\*\s*/, '')))
    .filter((f) => f.length >= 30 && f.length <= 300 && !/https?:|Categoria|Category/i.test(f));

  if (!frases.length) throw new Error('Nenhuma frase encontrada na página');
  cacheWiki.set(id, frases);
  return frases;
}

async function buscarWikiquote(pagina, lang, fonte) {
  try {
    const frases = await carregarFrasesWiki(pagina, lang);
    return { texto: pick(frases), autor: pagina, fonte, idioma: lang === 'pt' ? 'pt' : 'en' };
  } catch (err) {
    console.error(`Erro no Wikiquote (${pagina}):`, err.message);
    return null;
  }
}

// ================== FONTES (todas externas) ==================
// Cada fonte devolve { texto, autor, fonte, idioma } ou null.

async function fonteBiblia() {
  // Livros de sabedoria/ânimo, para evitar genealogias e listas
  const livros = 'PSA,PRO,ECC,ISA,JER,JOS,DEU,MAT,ROM,PHP,2TI,JAS';
  for (let i = 0; i < 4; i++) {
    try {
      const url = i < 2
        ? `https://bible-api.com/data/almeida/random/${livros}`
        : 'https://bible-api.com/data/almeida/random';
      const data = await fetchJSON(url);
      const v = data.random_verse;
      const texto = v.text.replace(/\s+/g, ' ').trim();
      if (texto.length < 50) continue; // descarta versículos curtos demais
      return {
        texto,
        autor: `Bíblia — ${v.book} ${v.chapter}:${v.verse}`,
        fonte: 'Bíblia Sagrada (Almeida)',
        idioma: 'pt'
      };
    } catch (err) {
      console.error('Erro ao buscar versículo:', err.message);
    }
  }
  return null;
}

async function fonteEstoica() {
  try {
    const d = await fetchJSON('https://www.stoic-quotes.com/api/quote');
    return { texto: d.text, autor: d.author, fonte: 'Filosofia Estoica', idioma: 'en' };
  } catch (err) {
    console.error('Erro ao buscar frase estoica:', err.message);
  }
  // Reserva: Wikiquote em português
  return buscarWikiquote(pick(['Marco Aurélio', 'Sêneca', 'Epicteto']), 'pt', 'Filosofia Estoica');
}

async function fonteNietzsche() {
  try {
    // O Quote Garden roda em plano gratuito; a primeira chamada pode demorar
    const d = await fetchJSON(
      `https://quote-garden.onrender.com/api/v3/quotes/random?author=${encodeURIComponent('Friedrich Nietzsche')}`,
      15000
    );
    if (d.data && d.data.length) {
      return {
        texto: d.data[0].quoteText.trim(),
        autor: d.data[0].quoteAuthor,
        fonte: 'Filosofia Alemã',
        idioma: 'en'
      };
    }
  } catch (err) {
    console.error('Erro ao buscar frase de Nietzsche:', err.message);
  }
  // Reserva: Wikiquote em português
  return buscarWikiquote('Friedrich Nietzsche', 'pt', 'Filosofia Alemã');
}

async function fonteGeral() {
  try {
    const d = await fetchJSON('https://dummyjson.com/quotes/random');
    return { texto: d.quote, autor: d.author, fonte: 'Citações gerais', idioma: 'en' };
  } catch (err) {
    console.error('Erro ao buscar frase geral:', err.message);
    return null;
  }
}

async function finalizar(q) {
  if (q.idioma === 'pt') return q;
  const t = await traduzir(q.texto, 'en', 'pt-BR');
  return {
    ...q,
    texto: t.texto,
    fonte: t.traduzido
      ? `${q.fonte} — traduzido do inglês`
      : `${q.fonte} — original em inglês (tradução indisponível agora)`
  };
}

async function buscar(fonte) {
  const q = await fonte();
  return q ? finalizar(q) : null;
}

// ================== SERVIÇO ==================
const QuoteService = {
  getBibleQuote: () => buscar(fonteBiblia),
  getStoicQuote: () => buscar(fonteEstoica),
  getNietzscheQuote: () => buscar(fonteNietzsche),

  // Aleatória: tenta as fontes em ordem aleatória até uma funcionar
  async getRandomQuote() {
    const fontes = [fonteBiblia, fonteEstoica, fonteNietzsche, fonteGeral].sort(() => Math.random() - 0.5);
    for (const fonte of fontes) {
      const q = await buscar(fonte);
      if (q) return q;
    }
    return null;
  },

  // Busca por tema: o termo em português é traduzido para inglês antes de consultar
  async searchByKeyword(keyword) {
    const kwEn = (await traduzir(keyword, 'pt-BR', 'en')).texto;
    const termosEn = termosDe(`${kwEn} ${keyword}`);
    const termosPt = termosDe(keyword);
    const fonte = `Tema: "${keyword}"`;

    // Cada fonte falha sozinha (devolve lista vazia) sem derrubar as outras
    const seguro = (promessa, nome) =>
      promessa.catch((err) => {
        console.error(`Busca por tema falhou (${nome}):`, err.message);
        return [];
      });

    const [garden, dummy, estoicos, wiki] = await Promise.all([
      // Quote Garden: busca por texto no servidor
      seguro(
        fetchJSON(`https://quote-garden.onrender.com/api/v3/quotes?query=${encodeURIComponent(kwEn)}&limit=30`, 8000)
          .then((d) => (d.data || []).map((i) => ({ texto: i.quoteText.trim(), autor: i.quoteAuthor, idioma: 'en' }))),
        'Quote Garden'
      ),
      // DummyJSON não tem busca em /quotes: baixa as 100 frases e filtra aqui
      seguro(
        fetchJSON('https://dummyjson.com/quotes?limit=0')
          .then((d) => d.quotes
            .map((i) => ({ texto: i.quote, autor: i.author, idioma: 'en' }))
            .filter((q) => casa(q.texto, termosEn))),
        'DummyJSON'
      ),
      // Estoicos: pede 100 frases aleatórias e filtra aqui
      seguro(
        fetchJSON('https://www.stoic-quotes.com/api/quotes?num=100')
          .then((d) => d
            .map((i) => ({ texto: i.text, autor: i.author, idioma: 'en' }))
            .filter((q) => casa(q.texto, termosEn))),
        'Stoic Quotes'
      ),
      // Wikiquote em português: filtra pelo termo digitado, sem precisar traduzir
      seguro(
        Promise.all(
          ['Friedrich Nietzsche', 'Marco Aurélio', 'Sêneca', 'Epicteto'].map((p) =>
            carregarFrasesWiki(p, 'pt')
              .then((fs) => fs.filter((f) => casa(f, termosPt)).map((f) => ({ texto: f, autor: p, idioma: 'pt' })))
              .catch((err) => {
                console.error(`Wikiquote falhou (${p}):`, err.message);
                return [];
              })
          )
        ).then((listas) => listas.flat()),
        'Wikiquote'
      )
    ]);

    // Frases já em português têm prioridade (não gastam cota de tradução)
    const candidatas = wiki.length ? wiki : [...garden, ...dummy, ...estoicos];
    if (!candidatas.length) {
      return { texto: 'Nenhuma citação encontrada para este tema. Tente outra palavra.', autor: '-', fonte: '-' };
    }
    return finalizar({ ...pick(candidatas), fonte });
  }
};

// ================== INTERFACE ==================
const quoteCard = document.getElementById('quoteCard');
const quoteText = document.getElementById('quoteText');
const quoteAuthor = document.getElementById('quoteAuthor');
const quoteSource = document.getElementById('quoteSource');

function mostrar(quote) {
  quoteText.textContent = `"${quote.texto}"`;
  quoteAuthor.textContent = quote.autor;
  quoteSource.textContent = quote.fonte;
}

async function carregarFrase(tipo) {
  quoteCard.classList.add('loading');
  quoteText.textContent = 'Carregando citação...';
  quoteAuthor.textContent = '';
  quoteSource.textContent = '';

  try {
    let quote;
    if (tipo === 'biblia') quote = await QuoteService.getBibleQuote();
    else if (tipo === 'estoico') quote = await QuoteService.getStoicQuote();
    else if (tipo === 'nietzsche') quote = await QuoteService.getNietzscheQuote();
    else quote = await QuoteService.getRandomQuote();

    if (!quote) throw new Error('Nenhuma fonte respondeu');
    mostrar(quote);
  } catch (err) {
    quoteText.textContent = 'Não foi possível carregar a citação agora. Tente novamente em instantes.';
  } finally {
    quoteCard.classList.remove('loading');
  }
}

async function buscarPorTema() {
  const input = document.getElementById('searchInput');
  const termo = input.value.trim();
  if (!termo) return;

  quoteCard.classList.add('loading');
  quoteText.textContent = 'Buscando tema...';
  quoteAuthor.textContent = '';
  quoteSource.textContent = '';

  try {
    mostrar(await QuoteService.searchByKeyword(termo));
  } catch (err) {
    quoteText.textContent = 'Ocorreu um erro na busca por tema.';
  } finally {
    quoteCard.classList.remove('loading');
  }
}