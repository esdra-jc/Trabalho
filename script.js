(() => {
'use strict';
const KEY = 'bobinatrack.v1';
const $ = s => document.querySelector(s);
let db = { bobinas: [], hist: [] };
try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.bobinas) db = d; } catch (e) {}
let idx = [];
let wide = false, selId = null;

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Falha ao salvar: armazenamento cheio.'); } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const compact = s => norm(s).replace(/[^A-Z0-9]/g, '');
const log = txt => { db.hist.unshift({ t: Date.now(), txt }); db.hist.length = Math.min(db.hist.length, 500); };
let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2500); }
function rebuild() {
  idx = db.bobinas.map(b => ({ b, t: norm(b.tipo), n: compact(b.numero), e: compact(b.endereco) }));
  $('#total').textContent = db.bobinas.length + ' bobinas';
}

/* ---------- Distância de edição (Damerau-Levenshtein / OSA) ---------- */
function matrix(a, b) {
  const n = a.length, m = b.length, d = [];
  for (let i = 0; i <= n; i++) { d[i] = new Array(m + 1); d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
    d[i][j] = v;
  }
  return d;
}
// a = pesquisado, b = cadastrado
function diffs(a, b) {
  const d = matrix(a, b); let i = a.length, j = b.length; const out = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) { i--; j--; }
    else if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      out.push(`dígitos trocados de lugar (posições ${j - 1}-${j}): pesquisou "${a[i - 2]}${a[i - 1]}", cadastrado "${b[j - 2]}${b[j - 1]}"`); i -= 2; j -= 2;
    }
    else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) { out.push(`posição ${j}: pesquisou "${a[i - 1]}", cadastrado "${b[j - 1]}"`); i--; j--; }
    else if (j > 0 && d[i][j] === d[i][j - 1] + 1) { out.push(`falta "${b[j - 1]}" na posição ${j} (está no cadastro, não na pesquisa)`); j--; }
    else { out.push(`"${a[i - 1]}" a mais na pesquisa`); i--; }
  }
  return out.reverse();
}

/* ---------- Comparação de código ---------- */
function matchCode(q, n, ratio) {
  if (q === n) return { s: 100, nivel: 'exato', motivo: 'Número idêntico ao cadastrado.' };
  if (q.length >= 3 && n.startsWith(q))
    return { s: Math.round(80 + 15 * q.length / n.length), nivel: 'parcial', motivo: `Código cadastrado começa com o número pesquisado (faltam ${n.length - q.length} caractere(s) no final).` };
  if (q.length >= 3 && n.includes(q))
    return { s: Math.round(65 + 10 * q.length / n.length), nivel: 'parcial', motivo: 'Código cadastrado contém o número pesquisado.' };
  if (n.length >= 3 && q.length > n.length && q.startsWith(n))
    return { s: 70, nivel: 'parcial', motivo: 'A pesquisa tem caracteres a mais no final do código cadastrado.' };
  const L = Math.max(q.length, n.length), maxD = Math.max(1, Math.floor(L * ratio));
  if (Math.abs(q.length - n.length) > maxD) return null;
  const d = matrix(q, n)[q.length][n.length];
  if (d > maxD) return null;
  return { s: Math.round((1 - d / L) * 90), nivel: 'erro', motivo: 'Possível erro de digitação.', dif: diffs(q, n) };
}

/* ---------- Pesquisa ---------- */
function search(raw) {
  const q0 = norm(raw); if (!q0) return null;
  const toks = q0.split(/[\s|]+/).filter(Boolean);
  let tipo = '';
  const tipos = new Set(idx.map(x => x.t));
  if (toks.length > 1 && tipos.has(toks[0])) tipo = toks.shift();
  const q = compact(toks.join(''));
  if (!q) return { res: [], tipo, q };
  const ratio = wide ? 0.5 : 0.34, min = wide ? 35 : 55, res = [];
  for (const x of idx) {
    if (tipo && x.t !== tipo) continue;
    let r = matchCode(q, x.n, ratio);
    if (x.e === q) { if (!r || r.s < 100) r = { s: 100, nivel: 'exato', motivo: `Endereço "${x.b.endereco}" é exatamente o pesquisado.` }; }
    else if (q.length >= 2 && x.e.startsWith(q) && (!r || r.s < 60)) r = { s: 60, nivel: 'parcial', motivo: 'Endereço começa com o texto pesquisado.' };
    if (r && r.s >= min) { r.b = x.b; res.push(r); }
  }
  const ord = { exato: 0, parcial: 1, erro: 2 };
  res.sort((a, b) => b.s - a.s || ord[a.nivel] - ord[b.nivel] || a.b.numero.localeCompare(b.b.numero));
  return { res, tipo, q };
}

const LBL = { exato: 'Correspondência exata', parcial: 'Correspondência parcial', erro: 'Possível erro de digitação' };
function renderSearch() {
  const box = $('#res'), raw = $('#q').value;
  $('#sel').hidden = true; selId = null;
  const out = search(raw);
  if (!out) { box.innerHTML = '<p class="why">Digite para pesquisar.</p>'; return; }
  const { res, tipo } = out;
  if (!res.length) {
    box.innerHTML = `<div class="aviso">Nenhuma correspondência confiável encontrada${tipo ? ' para o tipo ' + esc(tipo) : ''}.${wide ? '' : '<br><button id="amp">Ampliar pesquisa</button>'}</div>`;
    return;
  }
  const show = res.slice(0, 40);
  let h = `<p class="why">${res.length} resultado(s)${tipo ? ' · tipo ' + esc(tipo) : ''}${wide ? ' · pesquisa ampliada' : ''}. Confira e escolha a bobina correta.</p>`;
  for (const r of show) {
    h += `<div class="card ${r.nivel}"><div class="top"><span class="num">${esc(r.b.numero)}</span><span class="b ${r.nivel}">${LBL[r.nivel]}</span></div>
    <dl><dt>Tipo</dt><dd>${esc(r.b.tipo)}</dd><dt>Endereço</dt><dd><b>${esc(r.b.endereco)}</b></dd><dt>Semelhança</dt><dd>${r.s}%</dd></dl>
    <div class="why">${esc(r.motivo)}</div>${r.dif ? '<div class="why">Diferenças: ' + r.dif.map(esc).join('; ') + '.</div>' : ''}
    <button data-sel="${esc(r.b.id)}">Selecionar esta bobina</button></div>`;
  }
  if (res.length > show.length) h += `<p class="why">Mostrando os ${show.length} mais semelhantes. Refine a pesquisa para ver os demais.</p>`;
  if (!wide) h += '<button id="amp">Ampliar pesquisa</button>';
  box.innerHTML = h;
}
let deb;
$('#q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(renderSearch, 120); });
$('#res').addEventListener('click', e => {
  if (e.target.id === 'amp') { wide = true; renderSearch(); return; }
  const id = e.target.dataset.sel; if (id) select(id);
});

/* ---------- Seleção e movimentação ---------- */
function select(id) {
  const b = db.bobinas.find(x => x.id === id); if (!b) return;
  selId = id;
  const s = $('#sel'); s.hidden = false;
  s.innerHTML = `<h2>Bobina selecionada</h2><p><b>${esc(b.numero)}</b> · Tipo ${esc(b.tipo)}<br>Endereço atual: <b>${esc(b.endereco)}</b></p>
  <label>Novo endereço (movimentação)<input id="m-end" placeholder="${esc(b.endereco)}"></label>
  <div class="row"><button class="pri" id="m-ok">Confirmar movimentação</button><button id="m-conf">Confirmar conferência</button><button id="m-x">Cancelar</button></div>`;
  s.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#sel').addEventListener('click', e => {
  const b = db.bobinas.find(x => x.id === selId); if (!b) return;
  if (e.target.id === 'm-x') { $('#sel').hidden = true; selId = null; }
  if (e.target.id === 'm-conf') { log(`Conferida: ${b.numero} em ${b.endereco}`); save(); toast('Conferência registrada.'); }
  if (e.target.id === 'm-ok') {
    const ne = $('#m-end').value.trim().toUpperCase();
    if (!ne) return toast('Informe o novo endereço.');
    log(`Movida: ${b.numero} de ${b.endereco} para ${ne}`); b.endereco = ne; save(); rebuild(); renderList(); renderHist();
    toast('Endereço atualizado.'); renderSearch();
  }
});

/* ---------- Cadastro ---------- */
$('#c-salvar').addEventListener('click', () => {
  const tipo = $('#c-tipo').value.trim().toUpperCase(), num = $('#c-num').value.trim().toUpperCase(), end = $('#c-end').value.trim().toUpperCase();
  if (!tipo || !num || !end) return toast('Preencha tipo, número e endereço.');
  if (idx.some(x => x.n === compact(num)) && !confirm('Já existe bobina com esse número. Cadastrar mesmo assim?')) return;
  db.bobinas.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo, numero: num, endereco: end, criado: Date.now() });
  log(`Cadastrada: ${tipo} | ${num} | ${end}`); save(); rebuild(); renderList(); renderHist();
  ['#c-tipo', '#c-num', '#c-end'].forEach(s => $(s).value = ''); toast('Bobina cadastrada.');
});

/* ---------- Lista, histórico, import/export, teste ---------- */
function renderList() {
  const last = db.bobinas.slice(-100).reverse();
  $('#tabela').innerHTML = last.length ? `<table><tr><th>Tipo</th><th>Número</th><th>Endereço</th></tr>${last.map(b => `<tr><td>${esc(b.tipo)}</td><td>${esc(b.numero)}</td><td>${esc(b.endereco)}</td></tr>`).join('')}</table><p class="why">Mostrando as ${last.length} mais recentes de ${db.bobinas.length}.</p>` : '<p class="why">Nenhuma bobina cadastrada.</p>';
}
function renderHist() {
  $('#hlist').innerHTML = db.hist.slice(0, 100).map(h => `<div class="h">${esc(h.txt)}<br><small>${new Date(h.t).toLocaleString('pt-BR')}</small></div>`).join('') || '<p class="why">Sem registros.</p>';
}
$('#exp').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
  a.download = 'bobinatrack-backup.json'; a.click(); URL.revokeObjectURL(a.href);
});
$('#imp').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result); if (!Array.isArray(d.bobinas)) throw 0;
      const ids = new Set(db.bobinas.map(b => b.id)); let n = 0;
      for (const b of d.bobinas) if (b && b.id && b.tipo && b.numero && b.endereco && !ids.has(b.id)) { db.bobinas.push(b); n++; }
      log(`Importadas ${n} bobinas`); save(); rebuild(); renderList(); renderHist(); toast(n + ' bobinas importadas.');
    } catch (err) { toast('Arquivo inválido.'); }
  };
  r.readAsText(f); e.target.value = '';
});
$('#gerar').addEventListener('click', () => {
  if (!confirm('Gerar 5.000 registros FICTÍCIOS só para testar desempenho? Podem ser removidos depois.')) return;
  const T = ['R', 'P', 'T'];
  for (let i = 0; i < 5000; i++) db.bobinas.push({ id: 't' + i + Date.now().toString(36), tipo: T[i % 3], numero: 'P' + String(100000 + Math.floor(Math.random() * 899999)), endereco: (100 + Math.floor(Math.random() * 900)) + 'ABCDEF'[i % 6], teste: true });
  save(); rebuild(); renderList(); toast('Registros de teste criados.');
});
$('#limpar-teste').addEventListener('click', () => {
  db.bobinas = db.bobinas.filter(b => !b.teste); save(); rebuild(); renderList(); renderSearch(); toast('Registros de teste removidos.');
});

/* ---------- Abas ---------- */
$('#tabs').addEventListener('click', e => {
  const t = e.target.dataset.tab; if (!t) return;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b === e.target));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== t);
});

rebuild(); renderList(); renderHist(); renderSearch();
})();
