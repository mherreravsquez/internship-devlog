/* ════════════════════════════════════════════
   STATE & GLOBALS
═════════════════════════════════════════════ */
const S = {
    dir: null,
    allPosts: [],
    posts: [],
    cache: {},
    view: 'empty',
    filter: { tag: null, project: null, category: null, month: null, type: null, search: '' }
};

/* ════════════════════════════════════════════
   CARGA ESTÁTICA (GitHub Pages / cualquier servidor HTTP)
═════════════════════════════════════════════ */
async function loadStatic() {
    try {
        const res = await fetch('./index.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        S.allPosts = (data.posts || []).filter(p => (p.category || 'game') === 'ulpomedia');
        if (S.allPosts.length === 0) {
            throw new Error('No se encontraron posts con categoría "ulpomedia".');
        }
        S.allPosts.sort((a,b) => new Date(b.date) - new Date(a.date));
        applyFilters();
        buildSidebar();
        showList();
        document.getElementById('status-text').innerText = `${S.allPosts.length} posts cargados`;
        document.getElementById('nav-status').classList.add('visible');
        document.getElementById('empty-state').style.display = 'none';
    }
    catch (err) {
        console.error(err);
        document.getElementById('empty-state').innerHTML = `
            <div class="es-icon">⚠️</div>
            <div class="es-title">Error de carga</div>
            <div class="es-sub">
                No se pudo cargar index.json. Asegúrate de que el visor esté corriendo en un servidor web<br>
                (GitHub Pages, Live Server, etc.) y que la estructura de archivos sea correcta.
                <br><br>
                <code style="background:#000; padding:4px;">📁 /index.json + /blogs/*.md</code>
            </div>
        `;
    }
}

async function loadPostFile(slug) {
    if (S.cache[slug]) return S.cache[slug];

    // Sin Jekyll activo, se necesita la extensión .md explícitamente
    const candidates = [
        `./blogs/${slug}.md`,   // Ruta principal
        `./blogs/${slug}.MD`,   // Por si acaso
        `./${slug}.md`,
        `/blogs/${slug}.md`
    ];

    for (const url of candidates) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                const text = await res.text();
                S.cache[slug] = text;
                console.log(`✅ Cargado desde: ${url}`);
                return text;
            }
        } catch (e) { }
    }

    throw new Error(`❌ No se pudo cargar el post ${slug}. Archivo no encontrado como .md en blogs/`);
}

/* ════════════════════════════════════════════
   PARSEO FRONTMATTER + RENDER MARKDOWN
═════════════════════════════════════════════ */
function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { fm: {}, body: raw };
    const fm = {};
    match[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        let key = line.slice(0, idx).trim();
        let val = line.slice(idx+1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1,-1);
        if (val.startsWith('[')) try { val = JSON.parse(val); } catch(e) {}
        fm[key] = val;
    });
    return { fm, body: match[2].trim() };
}

function renderMd(md) {
    if (!md) return '';
    let html = md;

    // 1. Proteger bloques de código
    const blocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        blocks.push(`<pre><code class="lang-${lang || 'txt'}">${esc}</code></pre>`);
        return `\x00BLK${blocks.length - 1}\x00`;
    });

    // 2. Proteger código inline
    const inlines = [];
    html = html.replace(/`([^`\n]+)`/g, (_, c) => {
        const esc = c.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        inlines.push(`<code>${esc}</code>`);
        return `\x00INL${inlines.length - 1}\x00`;
    });

    // 3. Proteger vídeos e imágenes (antes de escapar)
    const media = [];
    html = html.replace(/(https?:\/\/[^\s<>]+\.(?:mp4|webm|mov)(?:\?[^\s<>]*)?)/gi, (url) => {
        const tag = `<video controls style="max-width:100%; margin:16px 0; display:block;"><source src="${url}" type="video/mp4"></video>`;
        media.push(tag);
        return `\x00MED${media.length - 1}\x00`;
    });
    html = html.replace(/(https?:\/\/[^\s<>]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s<>]*)?)/gi, (url) => {
        const tag = `<img src="${url}" loading="lazy" style="max-width:100%; display:block; margin:16px 0;">`;
        media.push(tag);
        return `\x00MED${media.length - 1}\x00`;
    });
    // También proteger markdown image syntax ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const tag = `<img src="${url}" alt="${alt}" loading="lazy" style="max-width:100%; display:block; margin:16px 0;">`;
        media.push(tag);
        return `\x00MED${media.length - 1}\x00`;
    });

    // 4. Escapar el resto del HTML (solo lo que no está protegido)
    html = html.replace(/&(?!amp;|lt;|gt;|#x00)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 5. Convertir markdown links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // 6. Headers + text formatting
    html = html
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold + italic
    html = html
        // ***bold italic***
        .replace(/(?<!\*)\*\*\*([^\n]+?)\*\*\*(?!\*)/g, '<strong><em>$1</em></strong>')

        // **bold**
        .replace(/(?<!\*)\*\*([^\n]+?)\*\*(?!\*)/g, '<strong>$1</strong>')

        // __bold__
        .replace(/(?<!_)__([^\n]+?)__(?!_)/g, '<strong>$1</strong>')

        // *italic*
        .replace(/(?<!\*)\*([^\s*][^*\n]*?)\*(?!\*)/g, '<em>$1</em>')

        // _italic_
        .replace(/(?<!_)_([^\s_][^_\n]*?)_(?!_)/g, '<em>$1</em>')

        // ~~strike~~
        .replace(/~~([^\n]+?)~~/g, '<del>$1</del>');

    // 7. Tablas
    html = html.replace(/^\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/gm, (_, hdr, rows) => {
        const th = hdr.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
        const trs = rows.trim().split('\n').map(r => `<tr>${r.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('')}</td>`).join('');
        return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
    });

    // Blockquotes
    html = html.replace(/^&gt; (.*$)/gm, '<blockquote>$1</blockquote>\n');
    html = html.replace(/(<blockquote>.*?<\/blockquote>\n?)+/gs, (match) => {
        const content = match.replace(/<\/?blockquote>/g, '').trim();
        return `<blockquote>${content}</blockquote>\n`;
    });

    // Listas anidadas (no ordenadas y ordenadas)
    function processListItems(listText, ordered = false) {
        const lines = listText.trim().split('\n');

        let html = '';
        let currentLevel = 0;

        const openTag = (lvl, type) => {
            html += `<${type}>`;
        };

        const closeTag = (lvl, type) => {
            html += `</li></${type}>`;
        };

        lines.forEach((line, index) => {
            const unorderedMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
            const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);

            const match = unorderedMatch || orderedMatch;
            if (!match) return;

            const spaces = match[1].replace(/\t/g, '    ').length;
            const level = Math.floor(spaces / 2);

            const type = unorderedMatch ? 'ul' : 'ol';
            const content = match[2];

            while (currentLevel > level) {
                html += `</li></ul>`;
                currentLevel--;
            }

            while (currentLevel < level) {
                html += `<ul>`;
                currentLevel++;
            }

            if (index > 0) {
                html += `</li>`;
            }

            html += `<li>${content}`;
        });

        while (currentLevel > 0) {
            html += `</li></ul>`;
            currentLevel--;
        }

        html += `</li>`;

        return `<${ordered ? 'ol' : 'ul'}>${html}</${ordered ? 'ol' : 'ul'}>`;
    }

    // Aplicar a listas no ordenadas y ordenadas
    html = html.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (match) => processListItems(match, false));
    html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (match) => processListItems(match, true));

    // HR
    html = html.replace(/^---$/gm, '<hr>');

    // 8. Párrafos justificados (evitar envolver etiquetas protegidas)
    const paragraphs = html.split(/\n{2,}/);
    const justified = paragraphs.map(para => {
        para = para.trim();
        if (!para) return '';
        // Si comienza con marcador, no envolver en párrafo (ya será una etiqueta)
        if (/^\x00(BLK|INL|MED)/.test(para)) return para;
        // Si ya es un bloque HTML conocido, no envolver
        if (/^<(h[1-6]|ul|ol|blockquote|pre|table|hr|div)/i.test(para)) return para;
        // Envolver en <p> justificado
        return `<p class="md-paragraph">${para.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

    html = justified;

    // 9. Restaurar marcadores
    blocks.forEach((c, i) => html = html.replace(new RegExp(`\\x00BLK${i}\\x00`, 'g'), c));
    inlines.forEach((c, i) => html = html.replace(new RegExp(`\\x00INL${i}\\x00`, 'g'), c));
    media.forEach((c, i) => html = html.replace(new RegExp(`\\x00MED${i}\\x00`, 'g'), c));

    return html;
}

/* ════════════════════════════════════════════
   FILTROS, SIDEBAR, RENDER
═════════════════════════════════════════════ */
const MONTHS = { '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre' };
function monthLabel(k){ if(!k) return 'Sin fecha'; let [y,m]=k.split('-'); return `${MONTHS[m]||m} ${y}`; }
function getTitle(p){ return p.title?.es || p.title?.en || p.slug; }
function getExcerpt(p){ return p.excerpt?.es || p.excerpt?.en || ''; }

function applyFilters(){
    let posts = [...S.allPosts];
    const f = S.filter;
    if(f.category) posts = posts.filter(p => p.category === f.category);
    if(f.tag) posts = posts.filter(p => (p.tags||[]).includes(f.tag));
    if(f.project) posts = posts.filter(p => p.project === f.project);
    if(f.type) posts = posts.filter(p => (p.type||'update') === f.type);
    if(f.month) posts = posts.filter(p => p.date?.startsWith(f.month));
    if(f.search){
        const q = f.search.toLowerCase();
        posts = posts.filter(p => getTitle(p).toLowerCase().includes(q) || getExcerpt(p).toLowerCase().includes(q) || (p.tags||[]).join(' ').toLowerCase().includes(q));
    }
    S.posts = posts;
}

function setFilter(key,val){ S.filter[key] = (S.filter[key] === val) ? null : val; applyFilters(); renderList(); syncChips(); }
function clearFilters(){ S.filter = { tag:null, project:null, category:null, month:null, type:null, search: S.filter.search }; applyFilters(); renderList(); syncChips(); }
function clearOneFilter(k){ S.filter[k] = null; applyFilters(); renderList(); syncChips(); }

function renderFilterBadges(){
    const labels = { tag:'Tag', project:'Proyecto', month:'Mes', type:'Tipo' };
    const active = Object.entries(S.filter).filter(([k,v]) => k !== 'search' && v);
    const el = document.getElementById('active-filters');
    if(!active.length){ el.innerHTML = ''; return; }
    el.innerHTML = `<div class="active-filter-bar">${active.map(([k,v])=>`<span class="af-badge">${labels[k] || k}: ${k==='month'?monthLabel(v):v}<span class="af-x" onclick="clearOneFilter('${k}')">✕</span></span>`).join('')}<span class="af-badge" onclick="clearFilters()" style="cursor:pointer;">Limpiar todo ✕</span></div>`;
}

function syncChips(){
    document.querySelectorAll('.f-chip[data-fkey]').forEach(el=>{ el.classList.toggle('active', S.filter[el.dataset.fkey] === el.dataset.fval); });
    const allChip=document.getElementById('chip-all'); if(allChip) allChip.classList.toggle('active', !Object.entries(S.filter).some(([k,v])=>k!=='search' && v));
}

function buildSidebar(){
    const posts = S.allPosts;
    const cats={}, projs={}, types={}, months={}, tags={};
    posts.forEach(p=>{
        if(p.category) cats[p.category]=(cats[p.category]||0)+1;
        if(p.project) projs[p.project]=(projs[p.project]||0)+1;
        let t = p.type||'update'; types[t]=(types[t]||0)+1;
        if(p.date){ let mo = p.date.slice(0,7); months[mo]=(months[mo]||0)+1; }
        (p.tags||[]).forEach(tg=> tags[tg]=(tags[tg]||0)+1);
    });
    const TYPE_LABEL = { update:'Update', release:'Release', devlog:'Devlog', 'devlog-semanal':'Devlog Semanal' };
    let html = `<div class="sb-section"><div class="sb-label">Vista</div><div class="chip-group"><button class="f-chip" id="chip-all" onclick="clearFilters()">Todos <span class="chip-n">${posts.length}</span></button></div></div>`;
    if(Object.keys(cats).length) html += `<div class="sb-section"><div class="sb-label">Categoría</div><div class="chip-group">${Object.entries(cats).map(([k,v])=>`<button class="f-chip" data-fkey="category" data-fval="${k}" onclick="setFilter('category','${k}')">${k}<span class="chip-n">${v}</span></button>`).join('')}</div></div>`;
    if(Object.keys(projs).length) html += `<div class="sb-section"><div class="sb-label">Proyecto</div><div class="chip-group">${Object.entries(projs).map(([k,v])=>`<button class="f-chip" data-fkey="project" data-fval="${k}" onclick="setFilter('project','${k}')">${k}<span class="chip-n">${v}</span></button>`).join('')}</div></div>`;
    if(Object.keys(types).length) html += `<div class="sb-section"><div class="sb-label">Tipo</div><div class="chip-group">${Object.entries(types).map(([k,v])=>`<button class="f-chip type-${k}" data-fkey="type" data-fval="${k}" onclick="setFilter('type','${k}')">${TYPE_LABEL[k]||k}<span class="chip-n">${v}</span></button>`).join('')}</div></div>`;
    if(Object.keys(months).length) html += `<div class="sb-section"><div class="sb-label">Mes</div><div class="chip-group">${Object.entries(months).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,v])=>`<button class="f-chip" data-fkey="month" data-fval="${k}" onclick="setFilter('month','${k}')">${monthLabel(k)}<span class="chip-n">${v}</span></button>`).join('')}</div></div>`;
    if(Object.keys(tags).length) html += `<div class="sb-section"><div class="sb-label">Etiquetas</div><div class="chip-group">${Object.entries(tags).map(([k,v])=>`<button class="f-chip" data-fkey="tag" data-fval="${k}" onclick="setFilter('tag','${k}')">${k}<span class="chip-n">${v}</span></button>`).join('')}</div></div>`;
    document.getElementById('sb-content').innerHTML = html; syncChips();
}

/* ── Thumbnail helper ── */
function thumbHTML(p) {
    const url = (p.thumbnail || '').trim();
    const proj = (p.project || 'DEVLOG').toUpperCase();
    if (!url) {
        return `<div class="card-thumb-fallback" data-project="${proj}"><span class="no-thumb-icon">◈</span></div>`;
    }
    // gifv → mp4 (Imgur specific)
    const isGifv = url.endsWith('.gifv');
    const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(url) || isGifv;
    if (isVideo) {
        const src = isGifv ? url.replace('.gifv', '.mp4') : url;
        return `<video autoplay loop muted playsinline><source src="${src}" type="video/mp4"></video>`;
    }
    return `<img src="${url}" alt="${getTitle(p)}" loading="lazy">`;
}

function renderList(){
    const posts = S.posts;
    document.getElementById('list-count').innerText = `${posts.length} post${posts.length!==1?'s':''}`;
    renderFilterBadges();
    const listEl = document.getElementById('post-list');
    if(!posts.length){ listEl.innerHTML = '<div class="no-results">⌀ Sin coincidencias.</div>'; return; }
    const groups = new Map();
    posts.forEach(p=>{ let key = p.date ? p.date.slice(0,7) : 'sin-fecha'; if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(p); });
    let html='';
    for(let [key, monthPosts] of groups.entries()){
        html += `<div class="month-group">`;
        html += `<div class="month-label">${monthLabel(key)}</div>`;
        html += `<div class="month-cards">`;
        monthPosts.forEach(p=>{
            const typeClass = p.type || 'update';
            const title = getTitle(p);
            const excerpt = getExcerpt(p);
            html += `
            <div class="post-card t-${typeClass}" onclick="openPost('${p.slug}')">
                <div class="card-thumb">
                    ${thumbHTML(p)}
                    <div class="card-type-overlay">
                        <span class="type-badge ${typeClass}">${typeClass}</span>
                        ${p.project ? `<span class="card-project" style="font-size:7px;letter-spacing:.08em;opacity:.8;">⌥ ${p.project}</span>` : ''}
                    </div>
                </div>
                <div class="card-inner">
                    <div class="card-meta">
                        <span class="card-date">${p.date||''}</span>
                    </div>
                    <div class="card-title">${title}</div>
                    ${excerpt ? `<div class="card-excerpt">${excerpt}</div>` : ''}
                    ${(p.tags||[]).length ? `<div class="card-tags">${p.tags.map(t=>`<span class="ptag">${t}</span>`).join('')}</div>` : ''}
                </div>
            </div>`;
        });
        html += `</div></div>`;
    }
    listEl.innerHTML = html;
}

function setView(v){
    document.getElementById('empty-state').style.display = v === 'empty' ? 'flex' : 'none';
    document.getElementById('list-view').style.display = v === 'list' ? 'block' : 'none';
    document.getElementById('post-view').style.display = v === 'post' ? 'block' : 'none';
    document.getElementById('editor-view').style.display = v === 'editor' ? 'block' : 'none';
    S.view = v;
}
function showList(){ setView('list'); renderList(); }

async function openPost(slug){
    setView('post');
    const headerEl = document.getElementById('post-header-el');
    const bodyEl = document.getElementById('post-body-el');
    headerEl.innerHTML = '<div class="loading-msg"><span class="spinner"></span> Cargando post...</div>';
    bodyEl.innerHTML = '';
    const meta = S.allPosts.find(p=>p.slug===slug);
    try{
        const raw = await loadPostFile(slug);
        const {fm, body} = parseFrontmatter(raw);
        const htmlBody = renderMd(body);
        const title = fm.title || getTitle(meta);
        const date = fm.date || meta?.date || '';
        const pType = fm.type || meta?.type || 'update';
        const project = fm.project || meta?.project || '';
        const tags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? fm.tags.split(',').map(t=>t.trim()) : (meta?.tags||[]));
        headerEl.className = `post-header t-${pType}`;
        headerEl.innerHTML = `<div class="post-meta"><span class="card-date">${date}</span><span class="type-badge ${pType}">${pType}</span>${project ? `<span class="card-project">⌥ ${project}</span>` : ''}</div><div class="post-h-title">${title}</div>${tags.length ? `<div class="post-tags-row">${tags.map(t=>`<span class="ptag">${t}</span>`).join('')}</div>` : ''}`;
        bodyEl.innerHTML = htmlBody;
    }catch(e){
        headerEl.innerHTML = ''; bodyEl.innerHTML = `<p style="color:var(--pink);">⚠ Error: ${e.message}</p>`;
    }
}

/* ════════════════════════════════════════════
   EDITOR Y EXPORTACIÓN
═════════════════════════════════════════════ */
let currentEditingSlug = null;
function openEditor(postData = null) {
    setView('editor');
    if (postData) {
        document.getElementById('ed-title').value = postData.title || '';
        document.getElementById('ed-project').value = postData.project || '';
        document.getElementById('ed-category').value = postData.category || '';
        document.getElementById('ed-tags').value = (postData.tags || []).join(', ');
        document.getElementById('ed-type').value = postData.type || 'devlog';
        document.getElementById('ed-body').value = postData.body || '';
        currentEditingSlug = postData.slug;
    } else {
        document.getElementById('ed-title').value = '';
        document.getElementById('ed-project').value = '';
        document.getElementById('ed-category').value = '';
        document.getElementById('ed-tags').value = '';
        document.getElementById('ed-type').value = 'devlog';
        document.getElementById('ed-body').value = '';
        currentEditingSlug = null;
    }
}

function downloadMD(){
    const title = document.getElementById('ed-title').value;
    const project = document.getElementById('ed-project').value;
    const category = document.getElementById('ed-category').value;
    const tags = document.getElementById('ed-tags').value;
    const body = document.getElementById('ed-body').value;
    const date = new Date().toISOString().slice(0,10);
    const md = `---\ntitle: "${title}"\ndate: "${date}"\nproject: "${project}"\ncategory: "${category}"\ntags: [${tags.split(',').map(t=>`"${t.trim()}"`).join(', ')}]\n---\n\n${body}`;
    const blob = new Blob([md], {type:'text/markdown'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (title.toLowerCase().replace(/\s+/g,'-') || 'post') + '.md';
    a.click();
}

function copyIndexEntry() {
    const title = document.getElementById('ed-title').value.trim();
    const project = document.getElementById('ed-project').value.trim();
    const category = document.getElementById('ed-category').value.trim();
    const tagsRaw = document.getElementById('ed-tags').value.trim();
    const type = document.getElementById('ed-type').value;
    const body = document.getElementById('ed-body').value.trim();
    const date = new Date().toISOString().slice(0,10);
    const slug = `${date}`;
    let excerpt = body.replace(/\n/g, ' ').slice(0, 120);
    if (excerpt.length === 120) excerpt += '…';
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(t => t) : [];
    const thumbnail = document.getElementById('ed-thumbnail')?.value.trim() || '';
    const entry = {
        slug: slug,
        title: { es: title },
        date: date,
        type: type,
        lang: "es",
        project: project || "",
        category: category || "ulpomedia",
        thumbnail: thumbnail,
        tags: tags,
        excerpt: { es: excerpt }
    };
    const entryStr = JSON.stringify(entry, null, 2);
    const preview = document.getElementById('json-preview');
    if (preview) preview.value = entryStr;
    navigator.clipboard.writeText(entryStr).then(() => {
        alert('✅ Entrada JSON copiada. Pégala dentro del array "posts" de index.json');
    }).catch(() => {
        alert('No se pudo copiar automáticamente. Copia manualmente desde el campo de vista previa.');
    });
}

/* ════════════════════════════════════════════
   EVENTOS Y ARRANQUE
═════════════════════════════════════════════ */
let searchTimer;
document.getElementById('search-input').addEventListener('input', e=>{
    clearTimeout(searchTimer);
    searchTimer = setTimeout(()=>{ S.filter.search = e.target.value.trim(); applyFilters(); if(S.view === 'list') renderList(); }, 220);
});
document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && S.view === 'post') showList();
    if((e.ctrlKey||e.metaKey) && e.key === 'o'){ e.preventDefault(); openFolder(); }
    if((e.ctrlKey||e.metaKey) && e.key === 'f' && S.view === 'list'){ e.preventDefault(); document.getElementById('search-input').focus(); }
});
// Ocultar el botón de carpeta en GitHub Pages (no es necesario)
if(window.location.protocol !== 'file:') {
    const btn = document.getElementById('open-btn');
    if(btn) btn.style.display = 'none';
} else {
    // Si está en file://, mostramos el botón pero con advertencia
    const btn = document.getElementById('open-btn');
    if(btn) btn.style.display = 'inline-block';
}

// Inicio
loadStatic();