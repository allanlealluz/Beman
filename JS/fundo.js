const Fundo = (() => {
  const PENSADORES = [
    'Friedrich Nietzsche', // primeiro pensador a aparecer
    'Marcus Aurelius',
    'Seneca the Younger',
    'Epictetus',
    'Thomas Aquinas',
    'Augustine of Hippo',
    'Dante Alighieri',
    'Boethius',
    'Arthur Schopenhauer',
    'Søren Kierkegaard'
  ];

  const CENAS_MEDIEVAIS = [
    'Middle Ages',
    'Illuminated manuscript',
    'Gothic architecture',
    'Castle',
    'Cathedral',
    'Monastery'
  ];

  const INTERVALO_MS = 14000;
  const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const camadas = [document.getElementById('fundoA'), document.getElementById('fundoB')];
  const credito = document.getElementById('fundoCredito');
  let ativa = 0;
  let indice = -1;
  let slides = [];

  const embaralhar = (arr) => [...arr].sort(() => Math.random() - 0.5);
  function intercalar(a, b) {
    const saida = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) saida.push(a[i]);
      if (b[i]) saida.push(b[i]);
    }
    return saida;
  }

  async function carregarImagens() {
    const titulos = [...PENSADORES, ...CENAS_MEDIEVAIS];
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=1600' +
      `&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(titulos.join('|'))}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const paginas = (data.query.pages || []).filter((p) => p.thumbnail);
    const montar = (p) => ({
      titulo: p.title,
      src: p.thumbnail.source,
      retrato: p.thumbnail.height > p.thumbnail.width,
      link: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`
    });

    const pensadores = paginas.filter((p) => PENSADORES.includes(p.title)).map(montar);
    const cenas = paginas.filter((p) => CENAS_MEDIEVAIS.includes(p.title)).map(montar);
    const nietzsche = pensadores.filter((s) => s.titulo === 'Friedrich Nietzsche');
    const outros = embaralhar(pensadores.filter((s) => s.titulo !== 'Friedrich Nietzsche'));

    return intercalar(embaralhar(cenas), [...nietzsche, ...outros]);
  }

  function preCarregar(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function mostrar(slide) {
    try {
      await preCarregar(slide.src);
    } catch (err) {
      console.error('Imagem de fundo não carregou:', slide.titulo);
      return false;
    }

    const atual = camadas[ativa];
    const proxima = camadas[1 - ativa];

    proxima.style.backgroundImage = `url("${slide.src}")`;
    proxima.classList.toggle('retrato', slide.retrato);
    proxima.classList.add('visivel');
    atual.classList.remove('visivel');
    ativa = 1 - ativa;

    credito.textContent = `${slide.titulo} — Wikipédia`;
    credito.href = slide.link;
    return true;
  }

  async function avancar() {
    for (let tentativas = 0; tentativas < slides.length; tentativas++) {
      indice = (indice + 1) % slides.length;
      if (await mostrar(slides[indice])) return;
    }
  }

  async function iniciar() {
    try {
      slides = await carregarImagens();
    } catch (err) {
      console.error('Não foi possível carregar as imagens de fundo:', err.message);
      return;
    }
    if (!slides.length) return;

    await avancar();
    if (!reduzirMovimento) {
      setInterval(() => {
        if (!document.hidden) avancar();
      }, INTERVALO_MS);
    }
  }

  return { iniciar };
})();

Fundo.iniciar();