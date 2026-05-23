// ─── OWNER CONFIG ────────────────────────────────────
const OWNER_EMAIL = 'sharkkapainwza007@gmail.com'; // เป็น email เจ้าของ
function isOwner() { return state.currentUser?.email === OWNER_EMAIL; }

// ─── SUPABASE CONFIG ─────────────────────────────────
let sbClient = null;
const SUPABASE_URL = 'https://izboiwsryrgpxdyswups.supabase.co';   // ม่องนี่วำคัญเด้ออย่าลืมเด้อตัวเอง
const SUPABASE_KEY = 'sb_publishable_WOeItX7yQZs17RBdPlhl5Q_BIrorRay';              
function getSupabaseConfig() {
  try { return JSON.parse(localStorage.getItem('fayeFuse_sb_config') || 'null'); } catch(e) { return null; }
}
function saveSupabaseConfig(url, key) {
  localStorage.setItem('fayeFuse_sb_config', JSON.stringify({ url, key }));
}
function initSupabase(url, key) {
  sbClient = window.supabase.createClient(url, key);
}

// ─── STATE ───────────────────────────────────────────
const PAPER_W = 2048, PAPER_H = 1536;
let state = {
  currentUser: null, // Supabase user object
  data: { items: [] }, // in-memory items for current user
  noteRowId: null, // Supabase row id for current user's note data
};
let ui = {
  currentPath: [],
  currentFile: null,
  currentPageIdx: 0,
  zoom: 1,
  panX: 0, panY: 0,
  tool: 'pen',
  penColor: '#1a1915', penSize: 3,
  pencilColor: '#555', pencilSize: 2,
  highlightColor: 'rgba(255,220,0,0.4)', highlightSize: 18,
  eraserSize: 20, eraserMode: 'normal',
  lassoActive: false, lassoPoints: [],
  lassoSelection: null,
  lassoDragging: false, lassoOffX: 0, lassoOffY: 0,
  undoStack: [], redoStack: [],
  isDrawing: false,
  lastX: 0, lastY: 0,
  pinchDist: null,
  pinchMidX: 0, pinchMidY: 0,
  pinchZoomStart: 1,
  touchMode: 'none',
  touchId: null,
  colorPickerTarget: null,
  autoSaveTimer: null,
};
let pages = [];

// ─── SYNC STATUS UI ──────────────────────────────────
function setSyncStatus(status, text) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  if (!dot || !txt) return;
  dot.className = 'sync-dot ' + status;
  txt.textContent = text;
}

// ─── CLOUD SAVE/LOAD ─────────────────────────────────
async function cloudSave() {
  if (!sbClient || !state.currentUser) return;
  setSyncStatus('syncing', 'กำลังบันทึก...');
  try {
    const payload = { data: state.data, updated_at: new Date().toISOString() };
    if (state.noteRowId) {
      await sbClient.from('notes').update(payload).eq('id', state.noteRowId);
    } else {
      const { data, error } = await sbClient.from('notes')
        .insert({ user_id: state.currentUser.id, ...payload })
        .select('id').single();
      if (data) state.noteRowId = data.id;
      if (error) throw error;
    }
    setSyncStatus('ok', 'sync ✓');
    // Show autosave indicator
    const ind = document.getElementById('autosave-indicator');
    if (ind) { ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 1500); }
  } catch(e) {
    setSyncStatus('err', 'sync ✗');
    console.error('cloudSave error:', e);
  }
}

async function cloudLoad() {
  if (!sbClient || !state.currentUser) return;
  setSyncStatus('syncing', 'กำลังโหลด...');
  try {
    const { data, error } = await sbClient.from('notes')
      .select('id, data')
      .eq('user_id', state.currentUser.id)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    if (data) {
      state.noteRowId = data.id;
      state.data = data.data || { items: [] };
    } else {
      state.data = { items: [] };
      state.noteRowId = null;
    }
    setSyncStatus('ok', 'sync ✓');
  } catch(e) {
    setSyncStatus('err', 'โหลดไม่ได้');
    console.error('cloudLoad error:', e);
  }
}

// save() = cloudSave wrapper (drop-in replacement)
function save() { triggerAutoSave(); }

function getUserData() { return state.data; }

// ─── ID ──────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2,9) + Date.now().toString(36); }

// ─── SETUP SCREEN ────────────────────────────────────
document.getElementById('setup-btn').onclick = async () => {
  const url = document.getElementById('setup-url').value.trim();
  const key = document.getElementById('setup-key').value.trim();
  const err = document.getElementById('setup-error');
  if (!url || !key) { err.textContent = 'กรุณากรอกให้ครบ'; return; }
  if (!url.startsWith('https://')) { err.textContent = 'URL ต้องขึ้นต้นด้วย https://'; return; }
  err.textContent = '';
  document.getElementById('setup-btn').textContent = 'กำลังเชื่อมต่อ...';
  try {
    initSupabase(url, key);
    // Test connection
    const { error } = await sbClient.from('notes').select('id').limit(1);
    if (error && error.code !== 'PGRST116' && error.message.includes('relation')) {
      throw new Error('ไม่พบ table "notes" กรุณาสร้าง table ก่อน');
    }
    saveSupabaseConfig(url, key);
    showScreen('login');
  } catch(e) {
    document.getElementById('setup-btn').textContent = 'เชื่อมต่อ';
    err.textContent = e.message || 'เชื่อมต่อไม่ได้ ตรวจสอบ URL และ Key อีกครั้ง';
  }
};

// ─── LOGIN ───────────────────────────────────────────
let loginMode = 'login';
document.getElementById('login-toggle-link').onclick = () => {
  loginMode = loginMode === 'login' ? 'register' : 'login';
  const isReg = loginMode === 'register';
  document.getElementById('login-password2').style.display = isReg ? '' : 'none';
  document.getElementById('login-btn').textContent = isReg ? 'สร้างบัญชี' : 'เข้าสู่ระบบ';
  document.getElementById('login-toggle-text').textContent = isReg ? 'มีบัญชีแล้ว?' : 'ยังไม่มีบัญชี?';
  document.getElementById('login-toggle-link').textContent = isReg ? 'เข้าสู่ระบบ' : 'สร้างบัญชี';
  document.getElementById('login-error').textContent = '';
};
document.getElementById('login-btn').onclick = doLogin;
document.getElementById('login-password').onkeydown = e => { if(e.key==='Enter') doLogin(); };

async function doLogin() {
  const email = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const p2 = document.getElementById('login-password2').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  if (!email || !p) { err.textContent = 'กรุณากรอกให้ครบ'; return; }
  btn.textContent = '...';
  btn.disabled = true;
  try {
    let result;
    if (loginMode === 'register') {
      if (p !== p2) { err.textContent = 'รหัสผ่านไม่ตรงกัน'; return; }
      result = await sbClient.auth.signUp({ email, password: p });
      if (result.error) throw result.error;
      if (result.data.user && !result.data.session) {
        err.style.color = 'var(--accent)';
        err.textContent = '📧 เช็คอีเมลเพื่อยืนยันบัญชีก่อนนะ!';
        return;
      }
    } else {
      result = await sbClient.auth.signInWithPassword({ email, password: p });
      if (result.error) throw result.error;
    }
    await afterLogin(result.data.user);
  } catch(e) {
    err.style.color = 'var(--danger)';
    err.textContent = e.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : e.message;
  } finally {
    btn.textContent = loginMode === 'register' ? 'สร้างบัญชี' : 'เข้าสู่ระบบ';
    btn.disabled = false;
  }
}

async function afterLogin(user) {
  state.currentUser = user;
  const email = user.email || '';
  document.getElementById('home-username').textContent = email.split('@')[0];
  ui.currentPath = [];
  await cloudLoad();
  showScreen('home');
  renderHome();
  maybeShowHelp();
  initExtensions();
}

// ─── ZOOM CONTROLS ──────────────────────────────────
function clampZoom(z) { return Math.max(0.05, Math.min(5, z)); }

function applyZoomWithSync(z) {
  ui.zoom = clampZoom(z);
  applyTransform();
  updateZoomIndicator();
  const sl = document.getElementById('zoom-slider');
  if (sl) sl.value = Math.round(ui.zoom * 100);
}

function initZoomControls() {
  const sl = document.getElementById('zoom-slider');
  const btnIn = document.getElementById('btn-zoom-in');
  const btnOut = document.getElementById('btn-zoom-out');
  const ind = document.getElementById('zoom-indicator');
  if (!sl) return;

  sl.value = Math.round(ui.zoom * 100);

  sl.oninput = () => { applyZoomWithSync(parseInt(sl.value) / 100); };

  if (btnIn) btnIn.onclick = () => { applyZoomWithSync(ui.zoom * 1.2); };
  if (btnOut) btnOut.onclick = () => { applyZoomWithSync(ui.zoom / 1.2); };
  if (ind) ind.onclick = () => {
    const wrap = document.getElementById('canvas-wrap');
    const PW = getPaperW(), PH = getPaperH();
    const scale = Math.min((wrap.clientWidth-24)/PW, (wrap.clientHeight-24)/PH, 1);
    applyZoomWithSync(Math.max(0.05, scale));
  };
}

document.getElementById('btn-logout').onclick = async () => {
  saveCurrentPageToFile();
  await cloudSave();
  await sbClient.auth.signOut();
  state.currentUser = null;
  state.data = { items: [] };
  state.noteRowId = null;
  ui.currentFile = null;
  stopAllExtensions();
  showScreen('login');
};

// ═══════════════════════════════════════════════════
// ─── WRITING SOUND SYSTEM ───────────────────────────
// ═══════════════════════════════════════════════════
const WritingSoundSystem = (() => {
  let ctx = null, gainNode = null;
  let enabled = false;
  let volume = 0.5;
  let soundType = 'pen'; // 'pen' | 'pencil'
  let _lastSoundTime = 0;
  let _soundInterval = null;
  let _isMoving = false;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // สร้างเสียงปากกา — filtered noise burst สั้นๆ
  function playPenSound() {
    try {
      const ac = getCtx();
      const buf = ac.createBuffer(1, ac.sampleRate * 0.04, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      // High-pass filter ให้เสียงคมเหมือนปลายปากกา
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2800;
      src.connect(hp);
      hp.connect(gainNode);
      src.start();
    } catch(e) {}
  }

  // สร้างเสียงดินสอ — rougher, lower freq noise
  function playPencilSound() {
    try {
      const ac = getCtx();
      const dur = 0.055 + Math.random() * 0.02;
      const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / data.length;
        // Texture: ขรุขระมากกว่าปากกา
        data[i] = (Math.random() * 2 - 1) * 0.7 * Math.pow(1 - t, 1.5)
                + Math.sin(i * 0.3) * 0.3 * (1 - t);
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + Math.random() * 400;
      bp.Q.value = 0.8;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 600;
      src.connect(bp);
      bp.connect(hp);
      hp.connect(gainNode);
      src.start();
    } catch(e) {}
  }

  function playSound() {
    if (soundType === 'pencil') playPencilSound();
    else playPenSound();
  }

  function onMove(e) {
    if (!enabled) return;
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    if (!ui.isDrawing) return;
    if (ui.tool !== 'pen' && ui.tool !== 'pencil') return;
    const now = performance.now();
    // สร้างเสียงทุก 35ms ขณะเคลื่อนปากกา
    const interval = soundType === 'pencil' ? 28 : 38;
    if (now - _lastSoundTime > interval) {
      _lastSoundTime = now;
      // ปรับ volume ตาม pressure
      if (gainNode && e.pressure) gainNode.gain.value = volume * (0.5 + e.pressure * 0.7);
      playSound();
    }
  }

  function start() {
    enabled = true;
    document.addEventListener('pointermove', onMove, { passive: true });
  }

  function stop() {
    enabled = false;
    document.removeEventListener('pointermove', onMove);
    if (ctx) { try { ctx.close(); } catch(e){} ctx = null; gainNode = null; }
    const modal = document.getElementById('writing-sound-modal');
    if (modal) modal.style.display = 'none';
  }

  function open() {
    let modal = document.getElementById('writing-sound-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'writing-sound-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:600;display:flex;align-items:center;justify-content:center;';
      modal.innerHTML = `
        <div style="background:var(--surface);border-radius:18px;padding:28px 24px;min-width:280px;max-width:340px;width:90vw;box-shadow:var(--shadow-lg);display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:17px;font-weight:700;">✏️ เสียงขีดเขียน</span>
            <button id="ws-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text);">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <label style="font-size:13px;font-weight:600;color:var(--text-muted);">ชนิดเสียง</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button class="ws-type-btn ${soundType==='pen'?'ws-active':''}" data-type="pen" style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--surface);cursor:pointer;font-size:13px;">🖊️ ปากกา</button>
              <button class="ws-type-btn ${soundType==='pencil'?'ws-active':''}" data-type="pencil" style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--surface);cursor:pointer;font-size:13px;">✏️ ดินสอ</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="font-size:13px;font-weight:600;color:var(--text-muted);">ระดับเสียง</label>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:16px;">🔈</span>
              <input type="range" id="ws-volume" min="0" max="100" value="${Math.round(volume*100)}" style="flex:1;accent-color:#667eea;">
              <span style="font-size:16px;">🔊</span>
            </div>
            <div style="text-align:center;font-size:12px;color:var(--text-muted);" id="ws-vol-label">${Math.round(volume*100)}%</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--accent-soft);border-radius:10px;">
            <span style="font-size:13px;font-weight:600;">เปิดใช้งาน</span>
            <label style="position:relative;width:44px;height:24px;cursor:pointer;">
              <input type="checkbox" id="ws-toggle" ${enabled?'checked':''} style="opacity:0;width:0;height:0;">
              <span id="ws-toggle-track" style="position:absolute;inset:0;border-radius:12px;background:${enabled?'#667eea':'var(--border)'};transition:background .2s;"></span>
              <span id="ws-toggle-thumb" style="position:absolute;top:2px;left:${enabled?'22px':'2px'};width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);transition:left .2s;"></span>
            </label>
          </div>
          <button id="ws-test" style="padding:10px;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;cursor:pointer;font-size:13px;font-weight:600;">🎵 ทดสอบเสียง</button>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#ws-close').onclick = () => { modal.style.display = 'none'; };
      modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

      modal.querySelectorAll('.ws-type-btn').forEach(btn => {
        btn.onclick = () => {
          soundType = btn.dataset.type;
          modal.querySelectorAll('.ws-type-btn').forEach(b => {
            b.style.borderColor = 'var(--border)';
            b.style.background = 'var(--surface)';
          });
          btn.style.borderColor = '#667eea';
          btn.style.background = 'rgba(102,126,234,0.12)';
        };
      });
      // Init active button style
      modal.querySelector(`.ws-type-btn[data-type="${soundType}"]`).style.borderColor = '#667eea';
      modal.querySelector(`.ws-type-btn[data-type="${soundType}"]`).style.background = 'rgba(102,126,234,0.12)';

      modal.querySelector('#ws-volume').oninput = e => {
        volume = parseInt(e.target.value) / 100;
        if (gainNode) gainNode.gain.value = volume;
        modal.querySelector('#ws-vol-label').textContent = Math.round(volume * 100) + '%';
      };

      modal.querySelector('#ws-toggle').onchange = e => {
        const on = e.target.checked;
        const track = modal.querySelector('#ws-toggle-track');
        const thumb = modal.querySelector('#ws-toggle-thumb');
        track.style.background = on ? '#667eea' : 'var(--border)';
        thumb.style.left = on ? '22px' : '2px';
        if (on) { enabled = true; start(); } else { enabled = false; document.removeEventListener('pointermove', onMove); }
      };

      modal.querySelector('#ws-test').onclick = () => {
        for (let i = 0; i < 5; i++) setTimeout(playSound, i * 60);
      };
    }
    modal.style.display = 'flex';
    if (!enabled) { enabled = true; start(); }
  }

  return { open, stop, start,
    _onMove: onMove, // exposed for initExtensions
  };
})();

function stopAllExtensions() {
  try { petSystem.stop(); } catch(e) {}
  try { WeatherSystem.stop(); } catch(e) {}
  try { MusicSystem.stop(); } catch(e) {}
  try { BgThemeSystem.reset(); } catch(e) {}
  try { WritingSoundSystem.stop(); } catch(e) {}
  // Music minibar
  const bar = document.getElementById('music-minibar');
  if (bar) bar.classList.remove('active');
  document.body.classList.remove('minibar-on');
  // Theme FAB
  const themeFab = document.getElementById('theme-fab-btn');
  if (themeFab) themeFab.classList.remove('visible');
  // Weather FAB
  const weatherFab = document.getElementById('weather-fab-btn');
  if (weatherFab) weatherFab.classList.remove('visible');
  // Pet FAB
  const petFab = document.getElementById('pet-fab');
  if (petFab) petFab.classList.remove('visible');
  // Reset minibar init flag so it re-inits next login
  window._musicMiniBarInited = false;
}

// ─── DARK MODE TOGGLE ─────────────────────────────────
(function() {
  const btn = document.getElementById('btn-dark-toggle');
  const saved = localStorage.getItem('fayeFuse_dark');
  if (saved === '1') { document.body.classList.add('dark-home'); btn.textContent = '☀️'; }
  btn.onclick = () => {
    const on = document.body.classList.toggle('dark-home');
    btn.textContent = on ? '☀️' : '🌙';
    localStorage.setItem('fayeFuse_dark', on ? '1' : '0');
  };
})();

// ─── THEME FAB ───────────────────────────────────────
function initThemeFab() {
  const btn = document.getElementById('theme-fab-btn');
  const ring = document.getElementById('theme-ring');
  const THEME_ACCENTS = {
    'default':   '#2c2c2a',
    'cream':     '#b89050',
    'blush':     '#d47070',
    'mint':      '#3a9e6a',
    'lavender':  '#8a5fd4',
    'sand':      '#c89848',
    'slate':     '#4a5878',
    'dark-warm': '#c8b880',
  };
  function updateRing() {
    if (!ring) return;
    const id = localStorage.getItem('fayeFuse_bg_theme') || 'default';
    ring.style.borderColor = THEME_ACCENTS[id] || '#667eea';
  }
  updateRing();
  if (btn) {
    btn.classList.add('visible');
    btn.onclick = () => { BgThemeSystem.open(); setTimeout(updateRing, 600); };
  }
  window._updateThemeRing = updateRing;
}

// ─── SCREENS ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
}

// ─── HOME ─────────────────────────────────────────────
function getItemsAt(path) {
  const d = getUserData();
  if (!path.length) return d.items;
  let cur = d.items;
  for (const id of path) {
    const folder = cur.find(i => i.id === id && i.type === 'folder');
    if (!folder) return [];
    cur = folder.children || [];
  }
  return cur;
}
function getParentItems(path) {
  if (!path.length) return getUserData().items;
  return getItemsAt(path.slice(0, -1));
}

function renderBreadcrumb() {
  const el = document.getElementById('breadcrumb');
  const d = getUserData();
  let html = '<span class="breadcrumb-item" data-idx="-1">หน้าหลัก</span>';
  let cur = d.items;
  ui.currentPath.forEach((id, i) => {
    const folder = cur.find(x => x.id === id);
    if (folder) {
      html += '<span class="breadcrumb-sep">›</span>';
      html += `<span class="breadcrumb-item" data-idx="${i}">${folder.name}</span>`;
      cur = folder.children || [];
    }
  });
  el.innerHTML = html;
  el.querySelectorAll('.breadcrumb-item').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      if (idx === -1) ui.currentPath = [];
      else ui.currentPath = ui.currentPath.slice(0, idx+1);
      renderHome();
    };
  });
}

function renderHome() {
  renderBreadcrumb();
  const items = getItemsAt(ui.currentPath);
  const grid = document.getElementById('items-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>ยังไม่มีไฟล์ สร้างใหม่ได้เลย!</p></div>';
    return;
  }
  grid.innerHTML = '';
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.id = item.id;
    card.draggable = true;

    let thumbHtml = '';
    if (item.type === 'folder') {
      const childCount = (item.children||[]).length;
      thumbHtml = `<div class="item-thumb item-thumb-folder-wrap">
        <div class="folder-icon">📁</div>
        <div class="folder-count">${childCount} รายการ</div>
      </div>`;
    } else {
      // วาด paper bg บน offscreen canvas
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 240; thumbCanvas.height = 160;
      const tctx = thumbCanvas.getContext('2d');
      drawPaperBg(tctx, 240, 160, item.paperType || 'blank', item.paperTheme || 'light', true);

      if (item.pages && item.pages[0]) {
        // ใช้ placeholder ก่อน แล้ว async โหลด stroke image ทับ
        const bgDataUrl = thumbCanvas.toDataURL('image/png', 0.6);
        thumbHtml = `<div class="item-thumb"><img class="thumb-img" id="thumb-${item.id}" src="${bgDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`;

        // โหลด stroke image แล้ว composite ทับ bg
        const strokeImg = new Image();
        strokeImg.onload = () => {
          tctx.drawImage(strokeImg, 0, 0, 240, 160);
          const finalUrl = thumbCanvas.toDataURL('image/png', 0.7);
          const el = document.getElementById('thumb-'+item.id);
          if (el) el.src = finalUrl;
        };
        strokeImg.src = item.pages[0];
      } else {
        // ไม่มี stroke — แค่แสดง paper bg
        const bgDataUrl = thumbCanvas.toDataURL('image/png', 0.6);
        thumbHtml = `<div class="item-thumb"><img src="${bgDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>`;
      }
    }

    // สร้าง date string
    const createdDate = item.created ? new Date(item.created).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '';
    const pageCount = (item.pages||[]).length;
    const hasContent = item.pages && item.pages.some(p => p);

    card.innerHTML = thumbHtml + `
      <div class="item-info">
        <div class="item-name" id="name-${item.id}">${item.name}</div>
        ${item.type === 'file' ? `
        <div class="item-tags">
          <span class="item-tag">${item.paperType||'blank'}</span>
          <span class="item-tag">${pageCount} หน้า</span>
          ${hasContent ? '<span class="item-tag item-tag-active">✍️ มีเนื้อหา</span>' : '<span class="item-tag item-tag-empty">ว่าง</span>'}
        </div>
        <div class="item-meta">${createdDate}</div>` : ''}
      </div>
      <div class="item-actions">
        <button class="item-action-btn item-delete-btn" data-id="${item.id}" title="ลบ">🗑</button>
        <button class="item-menu-btn" data-id="${item.id}" title="เพิ่มเติม">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>`;

    card.onclick = (e) => {
      if (e.target.closest('.item-menu-btn')) return;
      if (item.type === 'folder') {
        ui.currentPath = [...ui.currentPath, item.id];
        renderHome();
      } else {
        openFile(item);
      }
    };

    // Quick delete button
    card.querySelector('.item-delete-btn').onclick = (e) => {
      e.stopPropagation();
      openModal(`
        <h3>ลบ "${item.name}"?</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">ลบแล้วกู้คืนไม่ได้</p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel" id="modal-cancel">ยกเลิก</button>
          <button class="modal-btn modal-btn-danger" id="modal-confirm-delete">ลบเลย</button>
        </div>
      `);
      document.getElementById('modal-confirm-delete').onclick = () => { closeModal(); deleteItem(item); };
    };

    // Context menu
    card.querySelector('.item-menu-btn').onclick = (e) => {
      e.stopPropagation();
      showContextMenu(e, item);
    };

    // Drag & Drop
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', item.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', e => {
      if (item.type === 'folder') { e.preventDefault(); card.classList.add('drag-over'); }
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const dragId = e.dataTransfer.getData('text/plain');
      if (dragId !== item.id && item.type === 'folder') {
        moveItemToFolder(dragId, item.id);
      }
    });

    grid.appendChild(card);
  });
}

function showContextMenu(e, item) {
  const menu = document.getElementById('context-menu');
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth-160)+'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight-150)+'px';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="rename">✏️ เปลี่ยนชื่อ</div>
    <div class="context-menu-item" data-action="move">📂 ย้ายไปโฟลเดอร์</div>
    <div class="context-menu-item danger" data-action="delete">🗑 ลบ</div>`;
  menu.querySelector('[data-action=rename]').onclick = () => { hideContextMenu(); startRename(item); };
  menu.querySelector('[data-action=move]').onclick = () => { hideContextMenu(); showMoveModal(item); };
  menu.querySelector('[data-action=delete]').onclick = () => { hideContextMenu(); deleteItem(item); };
}
function hideContextMenu() { document.getElementById('context-menu').style.display = 'none'; }
document.addEventListener('click', e => { if (!e.target.closest('.context-menu')) hideContextMenu(); });

function startRename(item) {
  const nameEl = document.getElementById('name-'+item.id);
  if (!nameEl) return;
  const input = document.createElement('input');
  input.className = 'item-name-input';
  input.value = item.name;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    const val = input.value.trim() || item.name;
    item.name = val;
    save();
    renderHome();
  };
  input.onblur = commit;
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
}

function deleteItem(item) {
  const items = getItemsAt(ui.currentPath);
  const idx = items.findIndex(i => i.id === item.id);
  if (idx >= 0) { items.splice(idx, 1); save(); renderHome(); }
}

function moveItemToFolder(dragId, targetFolderId) {
  const items = getItemsAt(ui.currentPath);
  const dragIdx = items.findIndex(i => i.id === dragId);
  if (dragIdx < 0) return;
  const dragItem = items[dragIdx];
  items.splice(dragIdx, 1);
  const targetFolder = items.find(i => i.id === targetFolderId);
  if (!targetFolder) return;
  if (!targetFolder.children) targetFolder.children = [];
  targetFolder.children.push(dragItem);
  save(); renderHome();
}

function showMoveModal(item) {
  // Collect all folders
  const allFolders = [];
  function collect(arr, path) {
    arr.forEach(i => {
      if (i.type === 'folder' && i.id !== item.id) {
        allFolders.push({ ...i, _path: path });
        collect(i.children || [], path+'/'+i.name);
      }
    });
  }
  collect(getUserData().items, '');
  let html = `<h3>ย้ายไปที่...</h3>`;
  if (!allFolders.length) { html += '<p style="color:var(--text-muted);font-size:13px">ไม่มีโฟลเดอร์ให้ย้าย</p>'; }
  allFolders.forEach(f => {
    html += `<div class="context-menu-item" data-fid="${f.id}">📁 ${f._path}/${f.name}</div>`;
  });
  html += `<div class="modal-actions"><button class="modal-btn modal-btn-cancel" id="modal-cancel">ยกเลิก</button></div>`;
  openModal(html);
  document.querySelectorAll('[data-fid]').forEach(el => {
    el.onclick = () => {
      moveItemToFolder(item.id, el.dataset.fid);
      closeModal();
    };
  });
}

// New folder
document.getElementById('btn-new-folder').onclick = () => {
  openModal(`<h3>โฟลเดอร์ใหม่</h3>
    <input class="modal-input" id="modal-name" placeholder="ชื่อโฟลเดอร์" value="โฟลเดอร์ไม่มีชื่อ">
    <div class="modal-actions">
      <button class="modal-btn modal-btn-cancel" id="modal-cancel">ยกเลิก</button>
      <button class="modal-btn modal-btn-ok" id="modal-ok">สร้าง</button>
    </div>`);
  const inp = document.getElementById('modal-name');
  inp.focus(); inp.select();
  document.getElementById('modal-ok').onclick = () => {
    const name = inp.value.trim() || 'โฟลเดอร์ไม่มีชื่อ';
    getItemsAt(ui.currentPath).push({ id: uid(), type: 'folder', name, children: [] });
    save(); closeModal(); renderHome();
  };
};

// New file — paper type selector
document.getElementById('btn-new-file').onclick = () => showNewFileModal();
function showNewFileModal() {
  const paperTypes = ['lined', 'blank', 'grid'];
  const paperLabels = { lined: 'ลายเส้น', blank: 'ว่างเปล่า', grid: 'ตาราง' };
  const themes = ['light','cream','blush','mint','slate','dark','dark-blue','dark-green','dark-vscode','dark-sea','dark-purple','dark-red','dark-amber'];
  const themeLabels = { light:'☀️ ขาว', cream:'🧈 ครีม', blush:'🌸 ชมพู', mint:'🌿 มิ้นต์', slate:'🪸 สเลต', dark:'🌙 มืด', 'dark-blue':'🌊 มืดน้ำเงิน', 'dark-green':'🌲 มืดเขียว', 'dark-vscode':'💻 VS Code', 'dark-sea':'🌊 Dark Sea', 'dark-purple':'🔮 มืดม่วง', 'dark-red':'🔥 มืดแดง', 'dark-amber':'🟡 มืดเหลือง' };
  const themeColors = { light:'#ffffff', cream:'#fdf6e3', blush:'#fff0f0', mint:'#f0faf5', slate:'#f0f2f5', dark:'#1a1a1a', 'dark-blue':'#0d1b2a', 'dark-green':'#0d1a12', 'dark-vscode':'#1e1e1e', 'dark-sea':'#0d1f2d', 'dark-purple':'#1a1030', 'dark-red':'#1e0f0f', 'dark-amber':'#1a1400' };
  let selType = 'lined', selTheme = 'light';
  let useCustomSize = false;

  function buildPaperPreview(type, theme) {
    const c = document.createElement('canvas');
    c.width=90; c.height=120;
    const ctx = c.getContext('2d');
    drawPaperBg(ctx, 90, 120, type, theme, true);
    return c.toDataURL();
  }

  function render() {
    const box = document.getElementById('modal-box');
    box.innerHTML = `<h3>ไฟล์ใหม่</h3>
      <input class="modal-input" id="modal-fname" placeholder="ชื่อไฟล์" value="ไฟล์ไม่มีชื่อ" style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">รูปแบบกระดาษ</div>
      <div class="paper-grid">
        ${paperTypes.map(t=>`
          <div class="paper-opt ${t===selType?'selected':''}" data-type="${t}">
            <div class="paper-thumb"><img src="${buildPaperPreview(t,selTheme)}" style="width:100%;height:100%;object-fit:cover"></div>
            <div class="paper-label">${paperLabels[t]}</div>
          </div>`).join('')}
      </div>
      ${selType!=='blank'?`
        <div class="theme-label">ธีมกระดาษ</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;max-height:220px;overflow-y:auto;padding-right:2px;">
          ${themes.map(th=>`
            <div data-theme="${th}" style="cursor:pointer;border-radius:10px;border:2px solid ${th===selTheme?'#667eea':'var(--border)'};overflow:hidden;transition:border-color .15s;">
              <div style="height:28px;background:${themeColors[th]};"></div>
              <div style="padding:4px 2px;text-align:center;font-size:10px;background:var(--surface);color:var(--text);">${themeLabels[th]}</div>
            </div>`).join('')}
        </div>`:''}
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="custom-size-toggle" ${useCustomSize?'checked':''} style="accent-color:var(--accent)">
            ปรับขนาดกระดาษเอง
          </label>
          <span style="font-size:11px;color:var(--text-muted)">(มาตรฐาน: 1536 × 2048 px)</span>
        </div>
        ${useCustomSize ? `
        <div style="display:flex;gap:10px;align-items:center;">
          <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:11px;color:var(--text-muted)">ความกว้าง (px)</label>
            <input class="modal-input" id="custom-w" type="number" value="1536" min="400" max="4096" style="padding:8px 10px;font-size:13px">
          </div>
          <div style="font-size:18px;color:var(--text-muted);padding-top:16px">×</div>
          <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:11px;color:var(--text-muted)">ความยาว (px)</label>
            <input class="modal-input" id="custom-h" type="number" value="2048" min="400" max="4096" style="padding:8px 10px;font-size:13px">
          </div>
        </div>` : ''}
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-cancel" id="modal-cancel">ยกเลิก</button>
        <button class="modal-btn modal-btn-ok" id="modal-ok">สร้าง</button>
      </div>`;

    box.querySelectorAll('.paper-opt').forEach(el => {
      el.onclick = () => { selType = el.dataset.type; render(); };
    });
    box.querySelectorAll('[data-theme]').forEach(el => {
      el.onclick = () => { selTheme = el.dataset.theme; render(); };
    });
    document.getElementById('custom-size-toggle').onchange = e => {
      useCustomSize = e.target.checked; render();
    };
    document.getElementById('modal-ok').onclick = () => {
      const name = document.getElementById('modal-fname').value.trim() || 'ไฟล์ไม่มีชื่อ';
      let pw = 1536, ph = 2048;
      if (useCustomSize) {
        pw = Math.max(400, Math.min(4096, parseInt(document.getElementById('custom-w').value) || 1536));
        ph = Math.max(400, Math.min(4096, parseInt(document.getElementById('custom-h').value) || 2048));
      }
      const newFile = { id:uid(), type:'file', name, paperType:selType, paperTheme:selTheme, paperW:pw, paperH:ph, pages:[], created:Date.now() };
      getItemsAt(ui.currentPath).push(newFile);
      save(); closeModal(); renderHome();
      openFile(newFile);
    };
  }
  openModal(''); render();
}

// Modal helpers
function openModal(html) {
  const ov = document.getElementById('modal-overlay');
  document.getElementById('modal-box').innerHTML = html;
  ov.classList.add('open');
  const cancel = document.getElementById('modal-cancel');
  if (cancel) cancel.onclick = closeModal;
  ov.onclick = e => { if(e.target===ov) closeModal(); };
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

// Export / Import
document.getElementById('btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 2, data: state.data })], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fayeFuse-backup.fayeFuse';
  a.click();
};
document.getElementById('btn-import').onclick = () => document.getElementById('import-input').click();
document.getElementById('import-input').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      // Support both old format (d.data[username]) and new format (d.data.items)
      let importedData;
      if (d.version === 2 && d.data && d.data.items) {
        importedData = d.data;
      } else if (d.data) {
        // Old format: find first user's data
        const keys = Object.keys(d.data);
        if (keys.length > 0) importedData = d.data[keys[0]];
      }
      if (!importedData) throw new Error('ไม่พบข้อมูล');
      // Merge items
      if (!state.data.items) state.data.items = [];
      state.data.items = [...state.data.items, ...(importedData.items || [])];
      cloudSave();
      renderHome();
      alert('Import สำเร็จ! ' + (importedData.items||[]).length + ' รายการ');
    } catch(err) { alert('ไฟล์ไม่ถูกต้อง: ' + err.message); }
  };
  r.readAsText(file);
  e.target.value = '';
};

// ─── EDITOR ──────────────────────────────────────────
function openFile(file) {
  ui.currentFile = file;
  ui.currentPageIdx = 0;
  pages = (file.pages || []).map(p => p || null);
  if (!pages.length) pages.push(null);
  ui.undoStack = [];
  ui.redoStack = [];
  ui.zoom = 1;
  ui.panX = 0; ui.panY = 0;
  document.getElementById('editor-title').textContent = file.name;
  showScreen('editor');
  // รอให้ editor screen แสดงแล้วค่อย init
  let _initAttempts = 0;
  function doInit() {
    const wrap = document.getElementById('canvas-wrap');
    const editorEl = document.getElementById('screen-editor');
    _initAttempts++;
    if (_initAttempts > 60) { console.warn('doInit timeout'); return; }
    if (!wrap || wrap.clientWidth < 10 || wrap.clientHeight < 10 ||
        !editorEl || editorEl.style.display === 'none') {
      requestAnimationFrame(doInit); return;
    }
    initEditor();
    buildToolbar();
    renderPageTabs();
    loadPage(ui.currentPageIdx);
    const PW = getPaperW(), PH = getPaperH();
    const ww = wrap.clientWidth;
    const wh = wrap.clientHeight;
    const scale = Math.min((ww - 24) / PW, (wh - 24) / PH, 1);
    ui.zoom = Math.max(0.05, scale);
    ui.panX = 0; ui.panY = 0;
    applyTransform();
    updateZoomIndicator();
  }
  requestAnimationFrame(doInit);
}

let bgCtx, mainCtx, lassoCtx, overlayCtx;
function getPaperW() { return ui.currentFile?.paperW || 1536; }
function getPaperH() { return ui.currentFile?.paperH || 2048; }

function initEditor() {
  const PW = getPaperW(), PH = getPaperH();
  const dpr = window.devicePixelRatio || 1;
  const bgC = document.getElementById('canvas-bg');
  const mainC = document.getElementById('canvas-main');
  const lassoC = document.getElementById('canvas-lasso');
  const overlayC = document.getElementById('canvas-overlay');

  // ตั้ง DPR: canvas จริงใหญ่กว่า แต่ CSS size เท่าเดิม => เส้นคมชัดบน Retina/High-DPI
  [bgC, mainC, lassoC, overlayC].forEach(c => {
    c.width  = PW * dpr;
    c.height = PH * dpr;
    c.style.width  = PW + 'px';
    c.style.height = PH + 'px';
  });

  bgCtx      = bgC.getContext('2d');
  mainCtx    = mainC.getContext('2d');
  lassoCtx   = lassoC.getContext('2d');
  overlayCtx = overlayC.getContext('2d');

  // scale ทุก context ด้วย DPR ให้พิกเซลตรงกับหน้าจอ
  [bgCtx, mainCtx, lassoCtx, overlayCtx].forEach(ctx => {
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  });

  drawPaperBg(bgCtx, PW, PH, ui.currentFile.paperType, ui.currentFile.paperTheme, false);
  setupEditorEvents();
}

function fitCanvas() {
  const PW = getPaperW(), PH = getPaperH();
  const wrap = document.getElementById('canvas-wrap');
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const scale = Math.min((ww-40)/PW, (wh-40)/PH);
  ui.zoom = scale;
  ui.panX = 0; ui.panY = 0;
  applyTransform();
  updateZoomIndicator();
}

function applyTransform() {
  const cont = document.getElementById('canvas-container');
  const PW = getPaperW(), PH = getPaperH();
  cont.style.width = PW+'px';
  cont.style.height = PH+'px';
  const wrap = document.getElementById('canvas-wrap');
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const tx = ww/2 - PW*ui.zoom/2 + ui.panX;
  const ty = wh/2 - PH*ui.zoom/2 + ui.panY;
  cont.style.transform = `translate(${tx}px,${ty}px) scale(${ui.zoom})`;
  cont.style.transformOrigin = '0 0';
  // Image objects layer inherits scale from container (it's a child)
  const layer = document.getElementById('image-objects-layer');
  if (layer) { layer.style.width = PW+'px'; layer.style.height = PH+'px'; }
}
function updateZoomIndicator() {
  const pct = Math.round(ui.zoom*100);
  const ind = document.getElementById('zoom-indicator');
  if (ind) ind.textContent = pct+'%';
  const sl = document.getElementById('zoom-slider');
  if (sl) sl.value = pct;
}

// ─── PAPER BACKGROUND ─────────────────────────────────
function drawPaperBg(ctx, w, h, type, theme, small) {
  const bgColors = {
    light:'#ffffff', soft:'#fdf6e3', cream:'#fdf6e3', blush:'#fff0f0',
    mint:'#f0faf5', slate:'#f0f2f5',
    dark:'#1a1a1a', 'dark-blue':'#0d1b2a', 'dark-green':'#0d1a12',
    'dark-vscode':'#1e1e1e', 'dark-sea':'#0d1f2d',
    'dark-purple':'#1a1030', 'dark-red':'#1e0f0f', 'dark-amber':'#1a1400',
  };
  const lineColors = {
    light:'rgba(0,0,0,0.12)', soft:'rgba(80,60,20,0.18)', cream:'rgba(120,80,20,0.15)',
    blush:'rgba(180,60,60,0.15)', mint:'rgba(20,120,60,0.15)', slate:'rgba(40,60,100,0.15)',
    dark:'rgba(255,255,255,0.10)', 'dark-blue':'rgba(100,160,255,0.15)', 'dark-green':'rgba(80,200,100,0.13)',
    'dark-vscode':'rgba(80,150,255,0.18)', 'dark-sea':'rgba(60,200,220,0.18)',
    'dark-purple':'rgba(180,100,255,0.18)', 'dark-red':'rgba(255,80,80,0.18)', 'dark-amber':'rgba(255,200,60,0.20)',
  };
  // canvas-wrap bg (area around paper) for dark themes
  const wrapColors = {
    'dark-vscode':'#252526', 'dark-sea':'#0a1820', 'dark-purple':'#120820',
    'dark-red':'#160808', 'dark-amber':'#110e00',
    dark:'#111111', 'dark-blue':'#080f18', 'dark-green':'#070f05',
  };
  if (!small) {
    const wrap = document.getElementById('canvas-wrap');
    if (wrap) wrap.style.background = wrapColors[theme] || '#d0cfc9';
  }
  ctx.fillStyle = bgColors[theme] || '#fff';
  ctx.fillRect(0, 0, w, h);
  if (type === 'blank') return;
  ctx.strokeStyle = lineColors[theme] || 'rgba(0,0,0,0.12)';
  ctx.lineWidth = small ? 0.5 : 1.2;
  if (type === 'lined') {
    const spacing = small ? 12 : 52;
    for (let y = spacing; y < h; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  } else if (type === 'grid') {
    const spacing = small ? 12 : 52;
    for (let y = spacing; y < h; y += spacing) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let x = spacing; x < w; x += spacing) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  }
}

// ─── PAGES ────────────────────────────────────────────
function renderPageTabs() {
  const tabs = document.getElementById('pages-tabs');
  tabs.innerHTML = '';
  pages.forEach((p, i) => {
    const tab = document.createElement('div');
    tab.className = 'page-tab' + (i===ui.currentPageIdx?' active':'');
    tab.innerHTML = `หน้า ${i+1}`;
    if (pages.length > 1) {
      const close = document.createElement('span');
      close.className = 'page-tab-close';
      close.innerHTML = '×';
      close.onclick = e => { e.stopPropagation(); removePage(i); };
      tab.appendChild(close);
    }
    tab.onclick = () => { switchPage(i); };
    tabs.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'page-tab-add';
  addBtn.textContent = '+';
  addBtn.onclick = addPage;
  tabs.appendChild(addBtn);
}

function switchPage(idx) {
  saveCurrentPageCanvas();
  ui.currentPageIdx = idx;
  ui.undoStack = []; ui.redoStack = [];
  loadPage(idx);
  renderPageTabs();
}

function addPage() {
  saveCurrentPageCanvas();
  pages.push(null);
  ui.currentPageIdx = pages.length - 1;
  ui.undoStack = []; ui.redoStack = [];
  loadPage(ui.currentPageIdx);
  renderPageTabs();
  triggerAutoSave();
}

function removePage(idx) {
  if (pages.length <= 1) return;
  pages.splice(idx, 1);
  if (ui.currentPageIdx >= pages.length) ui.currentPageIdx = pages.length-1;
  loadPage(ui.currentPageIdx);
  renderPageTabs();
  triggerAutoSave();
}

function saveCurrentPageCanvas() {
  if (!mainCtx) return;
  pages[ui.currentPageIdx] = document.getElementById('canvas-main').toDataURL('image/png', 0.85);
  saveImageObjectsToPage();
}

function saveCurrentPageToFile() {
  if (!ui.currentFile || !mainCtx) return;
  saveCurrentPageCanvas();
  ui.currentFile.pages = [...pages];
  triggerAutoSave();
}

function loadPage(idx) {
  mainCtx.clearRect(0, 0, getPaperW(), getPaperH());
  lassoCtx.clearRect(0, 0, getPaperW(), getPaperH());
  clearLassoSelection();
  const pageData = pages[idx];
  if (pageData) {
    const img = new Image();
    img.onload = () => { mainCtx.drawImage(img, 0, 0); };
    img.src = pageData;
  }
  loadImageObjectsForPage(idx);
}

// ─── UNDO/REDO ────────────────────────────────────────
function pushUndo() {
  ui.undoStack.push(document.getElementById('canvas-main').toDataURL('image/png', 0.85));
  if (ui.undoStack.length > 40) ui.undoStack.shift();
  ui.redoStack = [];
}

// ─── AUTO SAVE ────────────────────────────────────────
function triggerAutoSave() {
  clearTimeout(ui.autoSaveTimer);
  ui.autoSaveTimer = setTimeout(() => {
    cloudSave();
  }, 2000);
}

// ─── BACK ─────────────────────────────────────────────
document.getElementById('editor-back').onclick = () => {
  saveCurrentPageToFile();
  clearAllImageObjects();
  showScreen('home');
  renderHome();
};

// ─── TOOLBAR ──────────────────────────────────────────
const COLORS = ['#1a1915','#e63946','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6','#ffffff','#888','#5d4037','#ff6b9d','#00bcd4'];

function buildToolbar() {
  const tb = document.getElementById('editor-toolbar');
  tb.innerHTML = `
    <button class="tool-btn active" id="tool-pen" title="ปากกา">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 3a2.828 2.828 0 014 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      <span class="tool-color-dot" id="dot-pen" style="background:${ui.penColor}"></span>
    </button>
    <button class="tool-btn" id="tool-pencil" title="ดินสอ">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      <span class="tool-color-dot" id="dot-pencil" style="background:${ui.pencilColor}"></span>
    </button>
    <button class="tool-btn" id="tool-highlight" title="ไฮไลท์">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="8" width="18" height="8" rx="2"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
      <span class="tool-color-dot" id="dot-highlight" style="background:rgba(255,220,0,0.8)"></span>
    </button>
    <button class="tool-btn" id="tool-eraser" title="ยางลบ">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 20H7L3 16l13-13 7 7-3 10zM6.66 16l2-2"/></svg>
    </button>
    <button class="tool-btn" id="tool-lasso" title="Lasso">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2C6.48 2 2 5.35 2 9.5c0 2.44 1.49 4.62 3.82 6.05L5 22l4.64-3.25C10.4 18.92 11.19 19 12 19c5.52 0 10-3.35 10-7.5S17.52 2 12 2z"/></svg>
    </button>
    <button class="tool-btn" id="tool-hand" title="เลื่อน (ปากกาเลื่อนได้)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 11V7a2 2 0 00-4 0v4"/><path d="M14 11V5a2 2 0 00-4 0v6"/><path d="M10 11V7a2 2 0 00-4 0v8l-.5 2.5A3.5 3.5 0 009 21h6a4 4 0 004-4v-4a2 2 0 00-4 0z"/></svg>
    </button>
    <div style="width:1px;height:24px;background:var(--border);margin:0 2px;flex-shrink:0;"></div>
    <button class="tool-btn" id="btn-shape-recog" title="Shape Recognition — แปลงเส้นเป็นรูปทรง">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M3 7h3l2-3h8l2 3h3v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" stroke-linejoin="round"/><path d="M5 17l3.5-4.5 2.5 3 2-2.5L17 17"/></svg>
    </button>
    <div class="tool-sep"></div>
    <input type="range" class="tool-size-slider" id="size-slider" min="1" max="120" value="${ui.penSize}" title="ขนาด">
    <canvas id="size-preview" width="40" height="40" style="pointer-events:none;flex-shrink:0;" title="ขนาดปัจจุบัน"></canvas>
    <div class="tool-sep"></div>
    <button class="tool-btn" id="tool-image" title="เพิ่มรูปภาพ">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </button>
    <div class="tool-sep"></div>
    <button class="tool-btn" id="btn-undo" title="Undo (⌘Z)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>
    </button>
    <button class="tool-btn" id="btn-redo" title="Redo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 014-4h12"/></svg>
    </button>
    <div class="tool-sep"></div>
    <button class="tool-btn" id="btn-zoom-out" title="ซูมออก" style="min-width:28px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
    </button>
    <input type="range" id="zoom-slider" min="5" max="300" value="100" step="5"
      style="width:70px;accent-color:var(--accent);cursor:pointer" title="Zoom">
    <button class="tool-btn" id="btn-zoom-in" title="ซูมเข้า" style="min-width:28px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
    </button>
    <span class="zoom-indicator" id="zoom-indicator" style="margin-left:2px;cursor:pointer" title="กดเพื่อ fit" id="zoom-indicator">100%</span>
    <!-- Color picker popup -->
    <div class="color-picker-popup" id="color-picker-popup">
      <div class="color-swatches" id="color-swatches"></div>
      <input type="color" class="color-custom" id="color-custom">
    </div>
    <!-- Eraser popup -->
    <div class="eraser-popup" id="eraser-popup">
      <div style="font-size:12px;font-weight:500;margin-bottom:4px">โหมดยางลบ</div>
      <label class="eraser-opt"><input type="radio" name="emode" value="normal" ${ui.eraserMode==='normal'?'checked':''}> ลบแบบปกติ</label>
      <label class="eraser-opt"><input type="radio" name="emode" value="stroke" ${ui.eraserMode==='stroke'?'checked':''}> ลบเส้นล่าสุด</label>
    </div>
  `;

  // Image input
  const imgInput = document.createElement('input');
  imgInput.type='file'; imgInput.accept='image/*'; imgInput.style.display='none';
  imgInput.id='img-file-input';
  tb.appendChild(imgInput);

  // Tool buttons
  // Lasso & image tool onclick
  document.getElementById('tool-lasso').onclick = (e) => { e.stopPropagation(); setTool('lasso'); };
  document.getElementById('tool-hand').onclick  = (e) => { e.stopPropagation(); setTool('hand'); };
  document.getElementById('btn-shape-recog').onclick = (e) => {
    e.stopPropagation();
    ui.shapeRecog = !ui.shapeRecog;
    document.getElementById('btn-shape-recog').classList.toggle('active', ui.shapeRecog);
  };
  ['pen','pencil','highlight'].forEach(t => {
    document.getElementById('tool-'+t).onclick = (e) => {
      e.stopPropagation();
      if (ui.tool === t) {
        openColorPicker(t); // already active → open settings
      } else {
        setTool(t);
      }
    };
  });
  // Eraser: tap again → toggle eraser popup
  document.getElementById('tool-eraser').onclick = (e) => {
    e.stopPropagation();
    if (ui.tool === 'eraser') {
      toggleEraserPopup();
    } else {
      setTool('eraser');
    }
  };

  let sizeTooltipTimer = null;
  function showSizeTooltip(slider, size) {
    let tip = document.getElementById('size-tooltip-popup');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'size-tooltip-popup';
      tip.className = 'size-tooltip';
      document.body.appendChild(tip);
    }
    const rect = slider.getBoundingClientRect();
    const pct = (size - parseInt(slider.min)) / (parseInt(slider.max) - parseInt(slider.min));
    const thumbX = rect.left + pct * rect.width;
    tip.textContent = size + ' px';
    tip.style.left = thumbX + 'px';
    tip.style.top = (rect.top - 36) + 'px';
    tip.classList.add('show');
    clearTimeout(sizeTooltipTimer);
    sizeTooltipTimer = setTimeout(() => tip.classList.remove('show'), 900);
  }

  function drawSizePreview(size, color) {
    const c = document.getElementById('size-preview');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 40, 40);
    const r = Math.min(size / 2, 18);
    ctx.beginPath();
    ctx.arc(20, 20, Math.max(r, 1), 0, Math.PI * 2);
    ctx.strokeStyle = color || getComputedStyle(document.body).getPropertyValue('--text') || '#333';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (size > 8) {
      ctx.fillStyle = (color || '#333') + '22';
      ctx.fill();
    }
  }

  document.getElementById('size-slider').oninput = e => {
    const v = parseInt(e.target.value);
    if (ui.tool==='pen') { ui.penSize=v; drawSizePreview(v, ui.penColor); }
    else if (ui.tool==='pencil') { ui.pencilSize=v; drawSizePreview(v, ui.pencilColor); }
    else if (ui.tool==='highlight') { ui.highlightSize=v; drawSizePreview(v, ui.highlightColor); }
    else if (ui.tool==='eraser') { ui.eraserSize=v; drawSizePreview(v, '#aaa'); }
    showSizeTooltip(e.target, v);
  };
  // Draw preview on tool switch (called in setTool too)
  window._drawSizePreview = drawSizePreview;

  const imageBtn = document.getElementById('tool-image');
  function triggerImagePicker() {
    // สร้าง input ใหม่ทุกครั้งเพื่อหลีกเลี่ยงปัญหา iOS ไม่ fire
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = e => {
      const file = e.target.files[0];
      if (!file) { inp.remove(); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(600/img.width, 400/img.height, 1);
          const w = img.width*scale, h = img.height*scale;
          const x = (getPaperW()-w)/2, y = (getPaperH()-h)/2;
          addImageObject(img.src, x, y, w, h);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      inp.remove();
    };
    inp.click();
  }
  imageBtn.onclick = (e) => { e.stopPropagation(); triggerImagePicker(); };
  imageBtn.addEventListener('pointerup', e => { e.stopPropagation(); }, { passive: true });

  // Undo / Redo — wired here because buttons are created in this function
  document.getElementById('btn-undo').onclick = () => {
    if (!ui.undoStack.length) return;
    ui.redoStack.push(document.getElementById('canvas-main').toDataURL('image/png', 0.85));
    const prev = ui.undoStack.pop();
    mainCtx.clearRect(0,0,getPaperW(),getPaperH());
    const img = new Image();
    img.onload = () => mainCtx.drawImage(img,0,0);
    img.src = prev;
  };
  document.getElementById('btn-redo').onclick = () => {
    if (!ui.redoStack.length) return;
    ui.undoStack.push(document.getElementById('canvas-main').toDataURL('image/png', 0.85));
    const next = ui.redoStack.pop();
    mainCtx.clearRect(0,0,getPaperW(),getPaperH());
    const img = new Image();
    img.onload = () => mainCtx.drawImage(img,0,0);
    img.src = next;
  };
  // Image picker — handled by triggerImagePicker() above

  // Color swatches
  const swatches = document.getElementById('color-swatches');
  COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className='color-swatch';
    s.style.background=c;
    if (c==='#ffffff') s.style.border='2px solid #ccc';
    s.onclick = () => applyColor(c);
    swatches.appendChild(s);
  });
  document.getElementById('color-custom').oninput = e => applyColor(e.target.value);

  // Eraser radio
  document.querySelectorAll('input[name=emode]').forEach(r => {
    r.onchange = () => { ui.eraserMode = r.value; };
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#color-picker-popup') && !e.target.closest('#tool-pen') && !e.target.closest('#tool-pencil') && !e.target.closest('#tool-highlight'))
      document.getElementById('color-picker-popup').classList.remove('open');
    if (!e.target.closest('#eraser-popup') && !e.target.closest('#tool-eraser'))
      document.getElementById('eraser-popup').classList.remove('open');
  });

  setTool('pen');
  initZoomControls();
}

// ─── INTERACTIVE IMAGE OBJECTS ────────────────────────
let imageObjects = []; // { id, src, x, y, w, h, locked, el }

function addImageObject(src, x, y, w, h) {
  const id = uid();
  const obj = { id, src, x, y, w, h, locked: false, el: null };
  imageObjects.push(obj);
  renderImageObject(obj);
  triggerAutoSave();
}

function renderImageObject(obj) {
  const layer = document.getElementById('image-objects-layer');
  if (!layer) return;
  // Remove old element if any
  if (obj.el) obj.el.remove();

  const wrap = document.createElement('div');
  wrap.dataset.imgId = obj.id;
  wrap.style.cssText = `
    position:absolute;
    left:${obj.x}px; top:${obj.y}px;
    width:${obj.w}px; height:${obj.h}px;
    touch-action:none;
    pointer-events:auto;
    cursor:${obj.locked ? 'not-allowed' : 'grab'};
    user-select:none;
    -webkit-user-select:none;
    outline: ${obj.locked ? '3px dashed rgba(255,165,0,0.9)' : '2px solid rgba(52,152,219,0.7)'};
    border-radius:3px;
  `;

  const imgEl = document.createElement('img');
  imgEl.src = obj.src;
  imgEl.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;border-radius:3px;pointer-events:none;';
  imgEl.draggable = false;

  // Resize handle (bottom-right corner)
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position:absolute; bottom:-8px; right:-8px;
    width:22px; height:22px;
    background:${obj.locked ? 'rgba(255,165,0,0.9)' : 'rgba(52,152,219,0.9)'};
    border-radius:50%;
    cursor:${obj.locked ? 'not-allowed' : 'nwse-resize'};
    touch-action:none;
    display:flex; align-items:center; justify-content:center;
    color:#fff; font-size:12px; font-weight:bold;
    border:2px solid #fff;
  `;
  resizeHandle.textContent = '⤡';

  wrap.appendChild(imgEl);
  wrap.appendChild(resizeHandle);
  layer.appendChild(wrap);
  obj.el = wrap;

  // ── LONG PRESS for delete/lock menu ──
  let longPressTimer = null;
  let longPressFired = false;
  const LONG_MS = 500;

  function startLongPress(e) {
    if (e.touches && e.touches.length > 1) return;
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      showImageMenu(obj, e);
    }, LONG_MS);
  }
  function cancelLongPress() { clearTimeout(longPressTimer); }

  wrap.addEventListener('touchstart', startLongPress, { passive: true });
  wrap.addEventListener('touchend', cancelLongPress, { passive: true });
  wrap.addEventListener('touchmove', cancelLongPress, { passive: true });

  // ── FINGER DRAG (move) — touch only, no pen ──
  let dragStartX, dragStartY, dragObjX, dragObjY;
  let isDragging = false;

  wrap.addEventListener('touchstart', e => {
    if (obj.locked) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    // reject stylus
    if (t.touchType === 'stylus') return;
    e.stopPropagation();
    dragStartX = t.clientX; dragStartY = t.clientY;
    dragObjX = obj.x; dragObjY = obj.y;
    isDragging = true;
    wrap.style.cursor = 'grabbing';
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (!isDragging || obj.locked) return;
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const t = e.touches[0];
    if (t.touchType === 'stylus') return;
    const dx = (t.clientX - dragStartX) / ui.zoom;
    const dy = (t.clientY - dragStartY) / ui.zoom;
    obj.x = Math.max(0, Math.min(getPaperW() - obj.w, dragObjX + dx));
    obj.y = Math.max(0, Math.min(getPaperH() - obj.h, dragObjY + dy));
    wrap.style.left = obj.x + 'px';
    wrap.style.top = obj.y + 'px';
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    if (isDragging) { isDragging = false; wrap.style.cursor = obj.locked ? 'not-allowed' : 'grab'; triggerAutoSave(); }
  }, { passive: true });

  // ── PINCH RESIZE — 2 fingers on the image ──
  let pinchStartDist = null, pinchStartW, pinchStartH;

  wrap.addEventListener('touchstart', e => {
    if (obj.locked) return;
    if (e.touches.length === 2) {
      e.stopPropagation();
      const t1 = e.touches[0], t2 = e.touches[1];
      pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      pinchStartW = obj.w; pinchStartH = obj.h;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (obj.locked) return;
    if (e.touches.length === 2 && pinchStartDist) {
      e.stopPropagation();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scale = dist / pinchStartDist;
      const newW = Math.max(50, pinchStartW * scale);
      const newH = Math.max(50, pinchStartH * scale);
      obj.w = newW; obj.h = newH;
      wrap.style.width = newW + 'px';
      wrap.style.height = newH + 'px';
    }
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) { pinchStartDist = null; triggerAutoSave(); }
  }, { passive: true });

  // ── RESIZE HANDLE drag (single finger) ──
  let resizeDragging = false, resizeStartX, resizeStartY, resizeStartW, resizeStartH;

  resizeHandle.addEventListener('touchstart', e => {
    if (obj.locked) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.touchType === 'stylus') return;
    e.stopPropagation();
    resizeDragging = true;
    resizeStartX = t.clientX; resizeStartY = t.clientY;
    resizeStartW = obj.w; resizeStartH = obj.h;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!resizeDragging || obj.locked) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = (t.clientX - resizeStartX) / ui.zoom;
    const dy = (t.clientY - resizeStartY) / ui.zoom;
    obj.w = Math.max(50, resizeStartW + dx);
    obj.h = Math.max(50, resizeStartH + dy);
    wrap.style.width = obj.w + 'px';
    wrap.style.height = obj.h + 'px';
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (resizeDragging) { resizeDragging = false; triggerAutoSave(); }
  }, { passive: true });
}

function showImageMenu(obj, e) {
  // Build a popup near the touch
  const existing = document.getElementById('img-action-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'img-action-menu';
  const touch = e.touches ? e.touches[0] : e;
  const tx = touch ? touch.clientX : window.innerWidth/2;
  const ty = touch ? touch.clientY : window.innerHeight/2;
  menu.style.cssText = `
    position:fixed; z-index:2000;
    left:${Math.min(tx, window.innerWidth-160)}px;
    top:${Math.min(ty, window.innerHeight-120)}px;
    background:var(--surface); border:1px solid var(--border);
    border-radius:12px; padding:6px; box-shadow:var(--shadow-lg);
    min-width:150px;
    font-family:var(--font-body); font-size:14px;
  `;

  const lockLabel = obj.locked ? '🔓 ปลดล็อค' : '🔒 ล็อค';
  menu.innerHTML = `
    <div id="img-menu-lock" style="padding:10px 14px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px;">${lockLabel}</div>
    <div id="img-menu-flatten" style="padding:10px 14px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px;">🖼 วางลงกระดาษ</div>
    <div id="img-menu-delete" style="padding:10px 14px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px;color:var(--danger);">🗑 ลบรูป</div>
  `;
  document.body.appendChild(menu);

  menu.querySelector('#img-menu-lock').ontouchstart = () => {
    obj.locked = !obj.locked;
    menu.remove();
    renderImageObject(obj);
  };
  menu.querySelector('#img-menu-flatten').ontouchstart = () => {
    flattenImageObject(obj);
    menu.remove();
  };
  menu.querySelector('#img-menu-delete').ontouchstart = () => {
    deleteImageObject(obj);
    menu.remove();
  };

  // Close on outside tap
  setTimeout(() => {
    document.addEventListener('touchstart', function closeFn(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('touchstart', closeFn); }
    }, { passive: true });
  }, 100);
}

function flattenImageObject(obj) {
  // Bake image onto the main canvas
  const img = new Image();
  img.onload = () => {
    pushUndo();
    mainCtx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    triggerAutoSave();
  };
  img.src = obj.src;
  deleteImageObject(obj);
}

function deleteImageObject(obj) {
  if (obj.el) obj.el.remove();
  imageObjects = imageObjects.filter(o => o.id !== obj.id);
  triggerAutoSave();
}

function clearAllImageObjects() {
  const layer = document.getElementById('image-objects-layer');
  if (layer) layer.innerHTML = '';
  imageObjects = [];
}

function saveImageObjectsToPage() {
  // Store image objects meta with page
  if (!ui.currentFile) return;
  if (!ui.currentFile.imageObjectsByPage) ui.currentFile.imageObjectsByPage = {};
  ui.currentFile.imageObjectsByPage[ui.currentPageIdx] = imageObjects.map(o => ({
    id: o.id, src: o.src, x: o.x, y: o.y, w: o.w, h: o.h, locked: o.locked
  }));
}

function loadImageObjectsForPage(idx) {
  clearAllImageObjects();
  const data = ui.currentFile?.imageObjectsByPage?.[idx];
  if (!data) return;
  data.forEach(o => {
    const obj = { ...o, el: null };
    imageObjects.push(obj);
    renderImageObject(obj);
  });
}

function setTool(t) {
  ui.tool = t;
  ui.lassoActive = (t === 'lasso');
  _penPanActive = false; // always cancel active pen pan when switching tool
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-'+t);
  if (btn) btn.classList.add('active');
  const slider = document.getElementById('size-slider');
  if (slider) {
    if (t==='pen') slider.value=ui.penSize;
    else if (t==='pencil') slider.value=ui.pencilSize;
    else if (t==='highlight') slider.value=ui.highlightSize;
    else if (t==='eraser') slider.value=ui.eraserSize;
  }
  if (t !== 'lasso') clearLassoSelection();
  // Update cursor on canvas
  const mainC = document.getElementById('canvas-main');
  if (mainC) mainC.style.cursor = t === 'hand' ? 'grab' : 'crosshair';
  // Image objects: always allow finger interaction regardless of tool
  const layer = document.getElementById('image-objects-layer');
  if (layer) layer.style.pointerEvents = 'none';
  // Update size slider range + preview
  const sl = document.getElementById('size-slider');
  if (sl) {
    if (t === 'eraser') sl.max = 120;
    else sl.max = 40;
  }
  if (window._drawSizePreview) {
    if (t==='pen') window._drawSizePreview(ui.penSize, ui.penColor);
    else if (t==='pencil') window._drawSizePreview(ui.pencilSize, ui.pencilColor);
    else if (t==='highlight') window._drawSizePreview(ui.highlightSize, ui.highlightColor);
    else if (t==='eraser') window._drawSizePreview(ui.eraserSize, '#aaa');
    else { const c = document.getElementById('size-preview'); if(c) c.getContext('2d').clearRect(0,0,40,40); }
  }
}

function openColorPicker(target) {
  ui.colorPickerTarget = target;
  const popup = document.getElementById('color-picker-popup');
  const btn = document.getElementById('tool-'+target);
  popup.classList.toggle('open');
  // Position near button
  const rect = btn.getBoundingClientRect();
  popup.style.left = rect.left + 'px';
  popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  popup.style.transform = 'none';
}

function applyColor(c) {
  const t = ui.colorPickerTarget || ui.tool;
  if (t==='pen') { ui.penColor=c; const d=document.getElementById('dot-pen'); if(d) d.style.background=c; }
  else if (t==='pencil') { ui.pencilColor=c; const d=document.getElementById('dot-pencil'); if(d) d.style.background=c; }
  else if (t==='highlight') {
    const r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);
    ui.highlightColor=`rgba(${r},${g},${b},0.4)`;
    const d=document.getElementById('dot-highlight'); if(d) d.style.background=`rgba(${r},${g},${b},0.8)`;
  }
  document.getElementById('color-picker-popup').classList.remove('open');
}

function toggleEraserPopup() {
  document.getElementById('eraser-popup').classList.toggle('open');
}

// ─── DRAWING EVENTS ───────────────────────────────────
let strokeHistory = []; // for stroke-mode eraser

function setupEditorEvents() {
  const wrap = document.getElementById('canvas-wrap');
  // touch-action:none บน wrap ให้ browser ไม่ขัด pointer events
  wrap.style.touchAction = 'none';
  // Pointer Events อย่างเดียว — ทั้งปากกาและนิ้วใช้ stream เดียวกัน
  wrap.addEventListener('pointerdown',   onPointerDown, { passive: false });
  wrap.addEventListener('pointermove',   onPointerMove, { passive: false });
  wrap.addEventListener('pointerup',     onPointerUp,   { passive: false });
  wrap.addEventListener('pointercancel', onPointerUp,   { passive: false });
}

function canvasPoint(e) {
  const mainC = document.getElementById('canvas-main');
  const rect = mainC.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / ui.zoom * (rect.width / mainC.offsetWidth) + 0,
    y: (e.clientY - rect.top) / ui.zoom * (rect.height / mainC.offsetHeight) + 0,
  };
}
function canvasPointRaw(e) {
  const mainC = document.getElementById('canvas-main');
  const rect = mainC.getBoundingClientRect();
  const scaleX = getPaperW() / rect.width;
  const scaleY = getPaperH() / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

// Global flag: set true when a pet is being dragged
window._petIsDragging = false;
function isPencilInput(e) {
  return e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.buttons > 0);
}

// Smooth drawing
let drawPoints = [];
let fullStrokePoints = [];
ui.shapeRecog = false;
let _lastPressure = 0.5;

// ── Multi-pointer tracking ─────────────────────────────────────────────────
// ปากกา/mouse → วาด   (1 pointer, track ด้วย _penPointerId)
// นิ้ว         → pan 1 นิ้ว / pinch-zoom 2 นิ้ว (Map: pointerId→{x,y})
// ทั้งสองทำงานพร้อมกันได้ ไม่ cancel กัน
// ─────────────────────────────────────────────────────────────────────────
let _penPointerId   = null;
let _penPanActive = false, _penPanStartX=0, _penPanStartY=0, _penPanOriginX=0, _penPanOriginY=0;
let _fingerPointers = new Map();
let _pinchStartDist = null, _pinchStartZoom = 1;
let _panStartX = 0, _panStartY = 0, _panOriginX = 0, _panOriginY = 0;

function onPointerDown(e) {
  e.preventDefault();

  // ── ปากกา / Mouse ──────────────────────────────
  if (isPencilInput(e)) {
    if (window._petIsDragging) return;
    if (_penPointerId !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    _penPointerId = e.pointerId;

    if (ui.tool === 'hand') {
      _penPanActive = true;
      _penPanStartX = e.clientX; _penPanStartY = e.clientY;
      _penPanOriginX = ui.panX;  _penPanOriginY = ui.panY;
      return;
    }

    const p = canvasPointRaw(e);
    ui.isDrawing = true;
    ui.lastX = p.x; ui.lastY = p.y;
    drawPoints = [p]; fullStrokePoints = [p];
    _lastPressure = e.pressure > 0 ? e.pressure : 0.5;

    if (ui.tool === 'lasso') {
      if (ui.lassoSelection && pointInRect(p, ui.lassoSelection)) {
        ui.lassoDragging = true;
        ui.lassoOffX = p.x - ui.lassoSelection.x;
        ui.lassoOffY = p.y - ui.lassoSelection.y;
      } else {
        commitLasso();
        ui.lassoPoints = [p];
        lassoCtx.clearRect(0,0,getPaperW(),getPaperH());
      }
      return;
    }

    if (ui.eraserMode === 'stroke' && ui.tool === 'eraser') {
      const now = Date.now();
      if (ui._lastStrokeErase && now - ui._lastStrokeErase < 200) { ui.isDrawing = false; return; }
      ui._lastStrokeErase = now;
      if (strokeHistory.length > 0) {
        const current = document.getElementById('canvas-main').toDataURL('image/png', 0.85);
        ui.undoStack.push(current);
        if (ui.undoStack.length > 40) ui.undoStack.shift();
        ui.redoStack = [];
        const prev = strokeHistory.pop();
        const img = new Image();
        img.onload = () => { mainCtx.clearRect(0,0,getPaperW(),getPaperH()); mainCtx.drawImage(img,0,0); };
        img.src = prev;
      }
      ui.isDrawing = false;
      return;
    }

    pushUndo();
    if (ui.tool !== 'eraser') {
      strokeHistory.push(document.getElementById('canvas-main').toDataURL('image/png', 0.7));
      if (strokeHistory.length > 30) strokeHistory.shift();
    }
    setDrawStyle(e.pressure > 0 ? e.pressure : 0.5);
    mainCtx.beginPath();
    mainCtx.moveTo(p.x, p.y);
    return;
  }

  // ── นิ้ว (touch) ────────────────────────────────
  if (e.pointerType === 'touch') {
    e.currentTarget.setPointerCapture(e.pointerId);
    _fingerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const fingers = Array.from(_fingerPointers.values());
    if (fingers.length === 1) {
      _panStartX = e.clientX; _panStartY = e.clientY;
      _panOriginX = ui.panX;  _panOriginY = ui.panY;
    } else if (fingers.length === 2) {
      const [a, b] = fingers;
      _pinchStartDist = Math.hypot(b.x-a.x, b.y-a.y);
      _pinchStartZoom = ui.zoom;
    }
  }
}

function onPointerMove(e) {
  e.preventDefault();

  // ── ปากกา / Mouse ──────────────────────────────
  if (isPencilInput(e)) {
    if (e.pointerId !== _penPointerId) return;

    if (ui.tool === 'hand' && _penPanActive) {
      ui.panX = _penPanOriginX + (e.clientX - _penPanStartX);
      ui.panY = _penPanOriginY + (e.clientY - _penPanStartY);
      applyTransform(); return;
    }

    const p = canvasPointRaw(e);

    if (ui.tool === 'lasso') {
      if (ui.lassoDragging && ui.lassoSelection) {
        const dx = (p.x - ui.lassoOffX) - ui.lassoSelection.x;
        const dy = (p.y - ui.lassoOffY) - ui.lassoSelection.y;
        ui.lassoPoints = ui.lassoPoints.map(pt => ({ x: pt.x+dx, y: pt.y+dy }));
        moveLassoSelection(dx, dy);
      } else if (ui.isDrawing) {
        ui.lassoPoints.push(p);
        lassoCtx.clearRect(0,0,getPaperW(),getPaperH());
        lassoCtx.strokeStyle='rgba(52,152,219,0.8)'; lassoCtx.lineWidth=2; lassoCtx.setLineDash([6,4]);
        lassoCtx.beginPath();
        ui.lassoPoints.forEach((pt,i)=>i===0?lassoCtx.moveTo(pt.x,pt.y):lassoCtx.lineTo(pt.x,pt.y));
        lassoCtx.closePath(); lassoCtx.stroke(); lassoCtx.setLineDash([]);
      }
      return;
    }

    if (!ui.isDrawing) return;

    const rawP = e.pressure > 0 ? e.pressure : 0.5;
    _lastPressure += (rawP - _lastPressure) * 0.3;

    const STAB = 0.72;
    const sp = {
      x: ui.lastX + (p.x - ui.lastX) * (1 - STAB),
      y: ui.lastY + (p.y - ui.lastY) * (1 - STAB),
    };
    drawPoints.push(sp); fullStrokePoints.push(sp);
    if (drawPoints.length > 8) drawPoints.shift();

    setDrawStyle(_lastPressure);
    const n = drawPoints.length;
    if (n >= 4) {
      const p0=drawPoints[n-4],p1=drawPoints[n-3],p2=drawPoints[n-2],p3=drawPoints[n-1];
      const m01={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2};
      const m23={x:(p2.x+p3.x)/2,y:(p2.y+p3.y)/2};
      mainCtx.beginPath(); mainCtx.moveTo(m01.x,m01.y);
      mainCtx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,m23.x,m23.y); mainCtx.stroke();
    } else if (n >= 3) {
      const p0=drawPoints[n-3],p1=drawPoints[n-2],p2=drawPoints[n-1];
      const m0={x:(p0.x+p1.x)/2,y:(p0.y+p1.y)/2};
      const m1={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
      mainCtx.beginPath(); mainCtx.moveTo(m0.x,m0.y);
      mainCtx.quadraticCurveTo(p1.x,p1.y,m1.x,m1.y); mainCtx.stroke();
    } else {
      mainCtx.beginPath(); mainCtx.moveTo(ui.lastX,ui.lastY);
      mainCtx.lineTo(sp.x,sp.y); mainCtx.stroke();
    }
    ui.lastX = sp.x; ui.lastY = sp.y;
    triggerAutoSave();
    return;
  }

  // ── นิ้ว (touch) ────────────────────────────────
  if (e.pointerType === 'touch') {
    if (!_fingerPointers.has(e.pointerId)) return;
    _fingerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const fingers = Array.from(_fingerPointers.values());
    if (fingers.length === 1) {
      ui.panX = _panOriginX + (e.clientX - _panStartX);
      ui.panY = _panOriginY + (e.clientY - _panStartY);
      applyTransform();
    } else if (fingers.length >= 2 && _pinchStartDist) {
      const [a,b] = fingers;
      const dist = Math.hypot(b.x-a.x, b.y-a.y);
      ui.zoom = Math.max(0.2, Math.min(5, _pinchStartZoom * (dist/_pinchStartDist)));
      applyTransform(); updateZoomIndicator();
    }
  }
}

function onPointerUp(e) {
  e.preventDefault();

  // ── ปากกา / Mouse ──────────────────────────────
  if (isPencilInput(e)) {
    if (e.pointerId !== _penPointerId) return;
    _penPointerId = null;
    if (ui.tool === 'hand') { _penPanActive = false; return; }
    if (ui.tool === 'lasso') {
      if (ui.lassoDragging) { ui.lassoDragging = false; triggerAutoSave(); }
      else if (ui.isDrawing && ui.lassoPoints.length > 3) { finishLasso(); }
      ui.isDrawing = false; return;
    }
    mainCtx.globalAlpha = 1;
    mainCtx.globalCompositeOperation = 'source-over';
    ui.isDrawing = false;
    if (ui.shapeRecog && (ui.tool==='pen'||ui.tool==='pencil') && fullStrokePoints.length > 4) {
      recognizeAndRedraw(fullStrokePoints);
    }
    return;
  }

  // ── นิ้ว (touch) ────────────────────────────────
  if (e.pointerType === 'touch') {
    _fingerPointers.delete(e.pointerId);
    const fingers = Array.from(_fingerPointers.values());
    if (fingers.length < 2) _pinchStartDist = null;
    if (fingers.length === 1) {
      // กลับมาเป็น pan ด้วยนิ้วที่เหลือ
      _panStartX = fingers[0].x; _panStartY = fingers[0].y;
      _panOriginX = ui.panX;     _panOriginY = ui.panY;
    }
  }
}

// ─────────────────────────────────────────────────────
// ═══════════ SHAPE RECOGNITION ENGINE ════════════════
// ─────────────────────────────────────────────────────
function recognizeAndRedraw(pts) {
  const shape = classifyStroke(pts);
  if (!shape) return;

  // ลบ stroke เดิมก่อน (undo snapshot มีแล้วจาก pushUndo)
  const snap = strokeHistory[strokeHistory.length - 1];
  if (snap) {
    const img = new Image();
    img.onload = () => {
      mainCtx.clearRect(0, 0, getPaperW(), getPaperH());
      mainCtx.drawImage(img, 0, 0);
      drawShape(shape);
      triggerAutoSave();
    };
    img.src = snap;
  } else {
    drawShape(shape);
    triggerAutoSave();
  }
}

function drawShape(s) {
  setDrawStyle(0.6);
  mainCtx.beginPath();
  if (s.type === 'line') {
    mainCtx.moveTo(s.x1, s.y1);
    mainCtx.lineTo(s.x2, s.y2);
  } else if (s.type === 'rect') {
    mainCtx.rect(s.x, s.y, s.w, s.h);
  } else if (s.type === 'circle') {
    mainCtx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
  } else if (s.type === 'triangle') {
    mainCtx.moveTo(s.p1.x, s.p1.y);
    mainCtx.lineTo(s.p2.x, s.p2.y);
    mainCtx.lineTo(s.p3.x, s.p3.y);
    mainCtx.closePath();
  } else if (s.type === 'arrow') {
    drawArrow(s.x1, s.y1, s.x2, s.y2);
    return;
  }
  mainCtx.stroke();
}

function drawArrow(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(16, Math.hypot(x2-x1, y2-y1) * 0.12);
  mainCtx.beginPath();
  mainCtx.moveTo(x1, y1);
  mainCtx.lineTo(x2, y2);
  mainCtx.stroke();
  mainCtx.beginPath();
  mainCtx.moveTo(x2, y2);
  mainCtx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/7), y2 - headLen * Math.sin(angle - Math.PI/7));
  mainCtx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/7), y2 - headLen * Math.sin(angle + Math.PI/7));
  mainCtx.closePath();
  mainCtx.fill();
}

function classifyStroke(pts) {
  if (pts.length < 4) return null;

  // Downsample to ~32 points
  const ds = downsample(pts, 32);
  const bbox = getBBox(ds);
  const W = bbox.maxX - bbox.minX;
  const H = bbox.maxY - bbox.minY;
  const totalLen = strokeLength(ds);
  const diagonal = Math.hypot(W, H);

  if (totalLen < 8 || diagonal < 8) return null;

  // ── LINE ─────────────────────────────────────────
  const lineScore = linearity(ds);
  if (lineScore > 0.90 && totalLen / diagonal < 1.25) {
    // Check arrow: sharp direction change near end
    const arrowTip = detectArrow(ds);
    if (arrowTip) return arrowTip;
    const first = ds[0], last = ds[ds.length - 1];
    return { type: 'line', x1: first.x, y1: first.y, x2: last.x, y2: last.y };
  }

  // ── CIRCLE / ELLIPSE ─────────────────────────────
  const closedness = Math.hypot(ds[0].x - ds[ds.length-1].x, ds[0].y - ds[ds.length-1].y) / totalLen;
  if (closedness < 0.18) {
    const circleness = measureCircleness(ds);
    if (circleness > 0.82) {
      const cx = (bbox.minX + bbox.maxX) / 2;
      const cy = (bbox.minY + bbox.maxY) / 2;
      const r  = (W + H) / 4;
      return { type: 'circle', cx, cy, r };
    }
  }

  // ── RECTANGLE ────────────────────────────────────
  if (closedness < 0.18) {
    const rectness = measureRectness(ds);
    if (rectness > 0.78) {
      return { type: 'rect', x: bbox.minX, y: bbox.minY, w: W, h: H };
    }
  }

  // ── TRIANGLE ─────────────────────────────────────
  if (closedness < 0.20) {
    const tri = measureTriangle(ds);
    if (tri) return tri;
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────
function downsample(pts, n) {
  if (pts.length <= n) return pts;
  const out = [];
  const step = (pts.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

function getBBox(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function strokeLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  return l;
}

function linearity(pts) {
  const dx = pts[pts.length-1].x - pts[0].x;
  const dy = pts[pts.length-1].y - pts[0].y;
  const len = Math.hypot(dx, dy) || 1;
  let maxDev = 0;
  for (const p of pts) {
    const t = ((p.x - pts[0].x) * dx + (p.y - pts[0].y) * dy) / (len * len);
    const cx = pts[0].x + t * dx, cy = pts[0].y + t * dy;
    maxDev = Math.max(maxDev, Math.hypot(p.x - cx, p.y - cy));
  }
  const bbox = getBBox(pts);
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) || 1;
  return 1 - (maxDev / diag);
}

function measureCircleness(pts) {
  const bbox = getBBox(pts);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const radii = pts.map(p => Math.hypot(p.x - cx, p.y - cy));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const variance = radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length;
  const stdDev = Math.sqrt(variance);
  return 1 - (stdDev / (mean || 1));
}

function measureRectness(pts) {
  // Find corners: ทิศทาง gradient เปลี่ยนอย่างกะทันหัน
  const corners = findCorners(pts);
  if (corners.length < 3 || corners.length > 6) return 0;
  // Check angles near 90°
  let rightAngles = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[(i - 1 + corners.length) % corners.length];
    const b = corners[i];
    const c = corners[(i + 1) % corners.length];
    const ab = Math.atan2(b.y - a.y, b.x - a.x);
    const bc = Math.atan2(c.y - b.y, c.x - b.x);
    let diff = Math.abs(ab - bc) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (Math.abs(diff - Math.PI / 2) < 0.45) rightAngles++;
  }
  return rightAngles / Math.max(corners.length, 1);
}

function measureTriangle(pts) {
  const corners = findCorners(pts);
  if (corners.length < 2 || corners.length > 4) return null;
  // Use bbox corners to build a triangle
  const bbox = getBBox(pts);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const p1 = { x: cx, y: bbox.minY };
  const p2 = { x: bbox.minX, y: bbox.maxY };
  const p3 = { x: bbox.maxX, y: bbox.maxY };
  // Check that stroke roughly covers this triangle
  let covered = 0;
  for (const p of pts) {
    if (Math.hypot(p.x - p1.x, p.y - p1.y) < 40 ||
        Math.hypot(p.x - p2.x, p.y - p2.y) < 40 ||
        Math.hypot(p.x - p3.x, p.y - p3.y) < 40 ||
        pointNearSegment(p, p1, p2, 25) || pointNearSegment(p, p2, p3, 25) || pointNearSegment(p, p1, p3, 25))
      covered++;
  }
  if (covered / pts.length > 0.6) return { type: 'triangle', p1, p2, p3 };
  return null;
}

function findCorners(pts) {
  const corners = [];
  const win = 4;
  for (let i = win; i < pts.length - win; i++) {
    const a = pts[i - win], b = pts[i], c = pts[i + win];
    const ab = Math.atan2(b.y - a.y, b.x - a.x);
    const bc = Math.atan2(c.y - b.y, c.x - b.x);
    let diff = Math.abs(ab - bc) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > 0.55) corners.push(b);
  }
  // ลด corners ที่อยู่ชิดกันเกินไป
  const merged = [];
  for (const c of corners) {
    if (!merged.length || Math.hypot(c.x - merged[merged.length-1].x, c.y - merged[merged.length-1].y) > 20)
      merged.push(c);
  }
  return merged;
}

function detectArrow(pts) {
  // มองหา V-shape ที่ปลาย stroke
  const tail = pts.slice(-Math.floor(pts.length * 0.25));
  const headDir = Math.atan2(pts[pts.length-1].y - pts[0].y, pts[pts.length-1].x - pts[0].x);
  const corners = findCorners(tail);
  if (corners.length >= 1) {
    return { type: 'arrow', x1: pts[0].x, y1: pts[0].y, x2: pts[pts.length-1].x, y2: pts[pts.length-1].y };
  }
  return null;
}

function pointNearSegment(p, a, b, tol) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y) < tol;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < tol;
}

// ─── LASSO ────────────────────────────────────────────
function finishLasso() {
  const pts = ui.lassoPoints;
  if (pts.length < 3) return;
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  const minX=Math.max(0,Math.floor(Math.min(...xs))), minY=Math.max(0,Math.floor(Math.min(...ys)));
  const maxX=Math.min(getPaperW(),Math.ceil(Math.max(...xs))), maxY=Math.min(getPaperH(),Math.ceil(Math.max(...ys)));
  const w=maxX-minX, h=maxY-minY;
  if (w<2||h<2) return;
  // Extract region
  const imageData = mainCtx.getImageData(minX, minY, w, h);
  pushUndo();
  mainCtx.clearRect(minX, minY, w, h);
  ui.lassoSelection = { x:minX, y:minY, w, h, imageData };
  // Draw selection outline
  lassoCtx.clearRect(0,0,getPaperW(),getPaperH());
  lassoCtx.strokeStyle='rgba(52,152,219,0.9)'; lassoCtx.lineWidth=2; lassoCtx.setLineDash([6,4]);
  lassoCtx.beginPath();
  pts.forEach((p,i)=>i===0?lassoCtx.moveTo(p.x,p.y):lassoCtx.lineTo(p.x,p.y));
  lassoCtx.closePath(); lassoCtx.stroke(); lassoCtx.setLineDash([]);
  // Draw preview on overlay
  const tmpC = document.createElement('canvas'); tmpC.width=getPaperW(); tmpC.height=getPaperH();
  const tctx = tmpC.getContext('2d');
  tctx.putImageData(imageData, minX, minY);
  overlayCtx.clearRect(0,0,getPaperW(),getPaperH());
  overlayCtx.drawImage(tmpC,0,0);
  ui.isDrawing = false;
}

function moveLassoSelection(dx, dy) {
  if (!ui.lassoSelection) return;
  const s = ui.lassoSelection;
  // อัพเดต position ก่อน
  s.x = Math.max(0, Math.min(getPaperW()-s.w, s.x + dx));
  s.y = Math.max(0, Math.min(getPaperH()-s.h, s.y + dy));
  // วาด overlay ที่ตำแหน่งใหม่
  overlayCtx.clearRect(0, 0, getPaperW(), getPaperH());
  const tmpC = document.createElement('canvas');
  tmpC.width = s.w; tmpC.height = s.h;
  tmpC.getContext('2d').putImageData(s.imageData, 0, 0);
  overlayCtx.drawImage(tmpC, s.x, s.y);
  // อัพเดต lasso outline
  lassoCtx.clearRect(0,0,getPaperW(),getPaperH());
  lassoCtx.strokeStyle='rgba(52,152,219,0.9)';
  lassoCtx.lineWidth=2; lassoCtx.setLineDash([6,4]);
  lassoCtx.beginPath();
  ui.lassoPoints.forEach((p,i) => i===0 ? lassoCtx.moveTo(p.x,p.y) : lassoCtx.lineTo(p.x,p.y));
  lassoCtx.closePath(); lassoCtx.stroke(); lassoCtx.setLineDash([]);
}

function commitLasso() {
  if (!ui.lassoSelection) return;
  const s = ui.lassoSelection;
  // วาด imageData ที่ตำแหน่งปัจจุบัน (s.x, s.y หลัง drag)
  const tmpC = document.createElement('canvas');
  tmpC.width = s.w; tmpC.height = s.h;
  tmpC.getContext('2d').putImageData(s.imageData, 0, 0);
  mainCtx.drawImage(tmpC, s.x, s.y);
  overlayCtx.clearRect(0,0,getPaperW(),getPaperH());
  lassoCtx.clearRect(0,0,getPaperW(),getPaperH());
  ui.lassoSelection = null;
  triggerAutoSave();
}

function clearLassoSelection() {
  if (ui.lassoSelection) commitLasso();
  ui.lassoPoints = [];
  if (lassoCtx) lassoCtx.clearRect(0,0,getPaperW(),getPaperH());
  if (overlayCtx) overlayCtx.clearRect(0,0,getPaperW(),getPaperH());
  ui.lassoSelection = null;
}

function pointInRect(p, r) {
  return p.x>=r.x && p.x<=r.x+r.w && p.y>=r.y && p.y<=r.y+r.h;
}

// ─────────────────────────────────────────────────────────────────
// ═══════════════════ WEATHER SYSTEM ═════════════════════════════
// ─────────────────────────────────────────────────────────────────
const WeatherSystem = (() => {
  // ── State ──────────────────────────────────────────────────────
  let currentWeather = 'clear'; // 'clear' | 'cloudy' | 'rain' | 'snow'
  let weatherMode = 'auto';     // 'auto' | 'manual'
  let animRaf = null;
  let drops = [];
  let flakes = [];
  let snowAudio = null;
  let rainAudio = null;
  let audioCtx = null;
  let gainNode = null;
  let oscillators = [];

  // ── Canvas ─────────────────────────────────────────────────────
  const canvas = document.getElementById('weather-canvas');
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ── Audio (Web Audio API) ──────────────────────────────────────
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function startRainSound() {
    stopAllSounds();
    try {
      const ac = getAudioCtx();
      gainNode = ac.createGain();
      gainNode.gain.value = 0.06;
      gainNode.connect(ac.destination);
      // Pink noise for rain
      const bufLen = ac.sampleRate * 3;
      const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
      const data = buf.getChannelData(0);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i=0; i<bufLen; i++) {
        const w = Math.random()*2-1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
        b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
        b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        data[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)* 0.11;
        b6=w*0.115926;
      }
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      // Low pass to make it sound like rain
      const lpf = ac.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 900;
      src.connect(lpf); lpf.connect(gainNode);
      src.start();
      oscillators.push(src);
    } catch(e) { console.warn('Rain sound error', e); }
  }

  function startSnowSound() {
    stopAllSounds();
    try {
      const ac = getAudioCtx();
      gainNode = ac.createGain();
      gainNode.gain.value = 0.04;
      gainNode.connect(ac.destination);
      // Wind: filtered noise with slow LFO
      const bufLen = ac.sampleRate * 4;
      const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i=0; i<bufLen; i++) data[i] = Math.random()*2-1;
      const src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      const bpf = ac.createBiquadFilter();
      bpf.type = 'bandpass'; bpf.frequency.value = 300; bpf.Q.value = 0.3;
      // LFO on gain for howling wind effect
      const lfoGain = ac.createGain();
      lfoGain.gain.value = 0.025;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 0.15;
      lfo.connect(lfoGain); lfoGain.connect(gainNode.gain);
      lfo.start();
      src.connect(bpf); bpf.connect(gainNode);
      src.start();
      oscillators.push(src, lfo);
    } catch(e) { console.warn('Snow sound error', e); }
  }

  function stopAllSounds() {
    oscillators.forEach(o => { try { o.stop(); } catch(e){} });
    oscillators = [];
    if (gainNode) { gainNode.disconnect(); gainNode = null; }
  }

  // ── Rain particles ─────────────────────────────────────────────
  function initRain() {
    drops = [];
    const count = Math.floor(window.innerWidth / 12); // ไม่เยอะ
    for (let i=0; i<count; i++) {
      drops.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        len: 10 + Math.random() * 14,
        speed: 6 + Math.random() * 6,
        opacity: 0.25 + Math.random() * 0.3,
        width: 0.7 + Math.random() * 0.8,
      });
    }
  }

  function drawRain() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    drops.forEach(d => {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(170,200,255,${d.opacity})`;
      ctx.lineWidth = d.width;
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 2, d.y + d.len);
      ctx.stroke();
      d.y += d.speed;
      d.x -= 1.5;
      if (d.y > canvas.height) {
        d.y = -d.len;
        d.x = Math.random() * canvas.width;
      }
    });
    ctx.restore();
  }

  // ── Snow particles ─────────────────────────────────────────────
  const FLAKE_CHARS = ['❄','❅'];

  function initSnow() {
    flakes = [];
    const count = 28; // แค่ 2 แบบ, จำนวนน้อย
    for (let i=0; i<count; i++) {
      flakes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: 12 + Math.random() * 10,
        speed: 0.5 + Math.random() * 1,
        drift: (Math.random() - 0.5) * 0.5,
        opacity: 0.5 + Math.random() * 0.4,
        char: FLAKE_CHARS[Math.floor(Math.random() * FLAKE_CHARS.length)],
        angle: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.02,
      });
    }
  }

  function drawSnow() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    flakes.forEach(f => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      ctx.globalAlpha = f.opacity;
      ctx.font = `${f.size}px serif`;
      ctx.fillStyle = '#e8f4ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.char, 0, 0);
      ctx.restore();
      f.y += f.speed;
      f.x += f.drift;
      f.angle += f.rotSpeed;
      if (f.y > canvas.height + 20) {
        f.y = -20;
        f.x = Math.random() * canvas.width;
      }
      if (f.x < -20) f.x = canvas.width + 20;
      if (f.x > canvas.width + 20) f.x = -20;
    });
    ctx.restore();
  }

  // ── Animation loop ─────────────────────────────────────────────
  function tick() {
    if (currentWeather === 'rain') drawRain();
    else if (currentWeather === 'snow') drawSnow();
    else ctx.clearRect(0,0,canvas.width,canvas.height);
    animRaf = requestAnimationFrame(tick);
  }

  function stopAnim() {
    if (animRaf) { cancelAnimationFrame(animRaf); animRaf = null; }
    ctx.clearRect(0,0,canvas.width,canvas.height);
  }

  // ── Apply weather ──────────────────────────────────────────────
  function applyWeather(type) {
    currentWeather = type;
    stopAnim();
    stopAllSounds();
    canvas.classList.add('hidden');

    if (type === 'rain') {
      canvas.classList.remove('hidden');
      initRain();
      tick();
      startRainSound();
    } else if (type === 'snow') {
      canvas.classList.remove('hidden');
      initSnow();
      tick();
      startSnowSound();
    }
    updateFab(type);
    updateInfoPanel(type);
  }

  // ── Emoji per weather ─────────────────────────────────────────
  const WEATHER_EMO = {
    clear: '☀️', cloudy: '☁️', rain: '🌧️', snow: '❄️',
    mist: '🌫️', drizzle: '🌦️', storm: '⛈️', wind: '💨',
  };
  function typeFromCode(code) {
    if (!code) return 'clear';
    if (code >= 200 && code < 300) return 'rain';
    if (code >= 300 && code < 400) return 'rain';
    if (code >= 500 && code < 600) return 'rain';
    if (code >= 600 && code < 700) return 'snow';
    if (code >= 700 && code < 800) return 'cloudy';
    if (code === 800) return 'clear';
    return 'cloudy';
  }

  function updateFab(type) {
    const fab = document.getElementById('weather-fab');
    const emo = {clear:'☀️',cloudy:'☁️',rain:'🌧️',snow:'❄️'};
    if (fab) fab.textContent = emo[type] || '🌤️';
  }

  let lastAPIData = null;

  function updateInfoPanel(type, apiData) {
    if (apiData) lastAPIData = apiData;
    const d = lastAPIData;
    const info = document.getElementById('weather-info');
    const icon = document.getElementById('weather-icon');
    const temp = document.getElementById('weather-temp');
    const desc = document.getElementById('weather-desc');
    const loc = document.getElementById('weather-loc');
    const eff = document.getElementById('weather-effect-label');

    if (!info) return;
    info.classList.add('show');

    const emo = {clear:'☀️',cloudy:'☁️',rain:'🌧️',snow:'❄️'};
    icon.textContent = emo[type] || '🌤️';

    if (d) {
      temp.textContent = Math.round(d.main.temp) + '°C';
      desc.textContent = d.weather[0].description;
      loc.textContent = '📍 ' + d.name + ', ' + d.sys.country;
    } else {
      const manualDesc = {clear:'แดดจัด',cloudy:'มีเมฆ',rain:'ฝนตก',snow:'หิมะตก'};
      desc.textContent = manualDesc[type] || '';
      loc.textContent = '✏️ กำหนดเอง';
      temp.textContent = '--°C';
    }

    const effLabel = {
      rain: '🌧️ เอฟเฟกต์ฝนตก + เสียงฝน',
      snow: '❄️ เอฟเฟกต์หิมะตก + เสียงลม',
      clear: 'ท้องฟ้าแจ่มใส ไม่มีเอฟเฟกต์',
      cloudy: 'ท้องฟ้ามีเมฆ ไม่มีเอฟเฟกต์',
    };
    eff.textContent = effLabel[type] || '';
  }

  // ── Fetch weather from Open-Meteo (free, no key) ───────────────
  async function fetchWeatherByCity(city) {
    const searchBtn = document.getElementById('weather-search-btn');
    if (searchBtn) searchBtn.textContent = '...';
    try {
      // 1. Geocoding
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=th&format=json`);
      const geoData = await geoRes.json();
      if (!geoData.results || !geoData.results.length) {
        alert('ไม่พบเมือง "' + city + '" ลองพิมพ์ชื่อภาษาอังกฤษดูนะ');
        return;
      }
      const { latitude, longitude, name, country } = geoData.results[0];

      // 2. Weather (WMO code)
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode&timezone=auto`);
      const wData = await wRes.json();
      const wcode = wData.current.weathercode;
      const tempC = Math.round(wData.current.temperature_2m);

      // Map WMO code to type
      let type = 'clear';
      if (wcode <= 3) type = wcode <= 1 ? 'clear' : 'cloudy';
      else if (wcode <= 49) type = 'cloudy';
      else if (wcode <= 69) type = 'rain';
      else if (wcode <= 79) type = 'snow';
      else if (wcode <= 82) type = 'rain';
      else if (wcode <= 86) type = 'snow';
      else if (wcode >= 95) type = 'rain';

      // Fake apiData shape for panel
      const fakeData = {
        main: { temp: tempC },
        weather: [{ description: wmoDesc(wcode) }],
        name: name,
        sys: { country: country || '' }
      };

      applyWeather(type);
      updateInfoPanel(type, fakeData);
    } catch(e) {
      alert('โหลดข้อมูลอากาศไม่ได้ ตรวจสอบอินเทอร์เน็ตด้วยนะ');
      console.error(e);
    } finally {
      if (searchBtn) searchBtn.textContent = 'ค้นหา';
    }
  }

  function wmoDesc(code) {
    if (code === 0) return 'ท้องฟ้าแจ่มใส';
    if (code <= 3) return 'มีเมฆบ้างส่วน';
    if (code <= 49) return 'หมอก/ละออง';
    if (code <= 59) return 'ฝนปรอยๆ';
    if (code <= 69) return 'ฝนตก';
    if (code <= 79) return 'หิมะ';
    if (code <= 82) return 'ฝนตกหนัก';
    if (code <= 86) return 'หิมะตกหนัก';
    if (code >= 95) return 'พายุฝนฟ้าคะนอง';
    return 'อากาศไม่แน่นอน';
  }

  // ── Modal UI (opened from Extensions) ────────────────────────
  function openModal() {
    const html = `
      <h3>🌤️ สภาพอากาศ</h3>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <button id="wm-auto" class="weather-mode-btn active" style="flex:1;padding:7px;border-radius:8px;font-size:12px;font-weight:500;border:1.5px solid #3498db;background:#3498db;color:#fff;cursor:pointer;">📡 อัตโนมัติ</button>
        <button id="wm-manual" class="weather-mode-btn" style="flex:1;padding:7px;border-radius:8px;font-size:12px;font-weight:500;border:1.5px solid var(--border);background:var(--surface);color:var(--text-muted);cursor:pointer;">✏️ กำหนดเอง</button>
      </div>
      <div id="weather-auto-section">
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input id="weather-city-input" placeholder="ชื่อเมือง เช่น ห้วยเม็ก, Bangkok" style="flex:1;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;background:var(--bg);color:var(--text);outline:none;font-family:var(--font-body);">
          <button id="weather-search-btn" style="padding:8px 14px;border-radius:8px;background:#3498db;color:#fff;font-size:12px;font-weight:500;border:none;cursor:pointer;">ค้นหา</button>
        </div>
      </div>
      <div id="weather-manual-section" style="display:none;">
        <select id="weather-manual-select" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;background:var(--bg);color:var(--text);outline:none;margin-bottom:8px;">
          <option value="clear">☀️ แดดจัด</option>
          <option value="cloudy">☁️ มีเมฆ</option>
          <option value="rain">🌧️ ฝนตก</option>
          <option value="snow">❄️ หิมะตก</option>
        </select>
      </div>
      <div id="weather-info" style="background:var(--accent-soft);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:none;">
        <div id="weather-loc" style="font-size:11px;color:var(--text-muted);margin-bottom:4px;"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <span id="weather-icon" style="font-size:28px;">🌤️</span>
          <span id="weather-temp" style="font-size:20px;font-weight:700;font-family:var(--font-mono);">--°C</span>
        </div>
        <div id="weather-desc" style="font-size:11px;color:var(--text-muted);"></div>
        <div id="weather-effect-label" style="font-size:11px;color:var(--text-muted);margin-top:4px;"></div>
      </div>
      <div class="modal-actions"><button class="modal-btn modal-btn-cancel" id="modal-cancel">ปิด</button></div>`;
    
    // Use the app's openModal
    window.openModal(html);

    const wmAuto = document.getElementById('wm-auto');
    const wmManual = document.getElementById('wm-manual');
    const autoSec = document.getElementById('weather-auto-section');
    const manualSec = document.getElementById('weather-manual-section');
    const searchBtn = document.getElementById('weather-search-btn');
    const cityInput = document.getElementById('weather-city-input');
    const manualSelect = document.getElementById('weather-manual-select');

    // Show existing weather info if any
    if (lastAPIData || currentWeather !== 'clear') updateInfoPanel(currentWeather, lastAPIData);

    wmAuto.onclick = () => {
      wmAuto.style.cssText = 'flex:1;padding:7px;border-radius:8px;font-size:12px;font-weight:500;border:1.5px solid #3498db;background:#3498db;color:#fff;cursor:pointer;';
      wmManual.style.cssText = 'flex:1;padding:7px;border-radius:8px;font-size:12px;font-weight:500;border:1.5px solid var(--border);background:var(--surface);color:var(--text-muted);cursor:pointer;';
      autoSec.style.display = ''; manualSec.style.display = 'none';
    };
    wmManual.onclick = () => {
      wmManual.style.cssText = 'flex:1;padding:7px;border-radius:8px;font-size:12px;font-weight:500;border:1.5px solid #3498db;background:#3498db;color:#fff;cursor:pointer;';
      wmAuto.style.cssText = 'flex:1;padding:7px;border-radius:8px;font-size:12px;font-weight:500;border:1.5px solid var(--border);background:var(--surface);color:var(--text-muted);cursor:pointer;';
      autoSec.style.display = 'none'; manualSec.style.display = '';
    };
    searchBtn.onclick = () => {
      const city = cityInput.value.trim();
      if (!city) return;
      fetchWeatherByCity(city);
    };
    cityInput.onkeydown = e => { if (e.key === 'Enter') searchBtn.click(); };
    manualSelect.onchange = () => {
      lastAPIData = null;
      applyWeather(manualSelect.value);
    };
  }

  function initFab() {
    const fab = document.getElementById('weather-fab-btn');
    if (!fab) return;
    fab.classList.add('visible');
    fab.onclick = () => openModal();
  }

  return {
    init() { initFab(); },
    open() { openModal(); initFab(); },
    apply(type) { applyWeather(type); },
    stop() {
      stopAnim(); stopAllSounds(); canvas.classList.add('hidden'); currentWeather = 'clear';
      const fab = document.getElementById('weather-fab-btn');
      if (fab) { fab.classList.remove('visible'); fab.onclick = null; }
    },
  };
})();


// ─────────────────────────────────────────────────────────────────
// ═══════════════════ BACKGROUND THEME SYSTEM ════════════════════
// ─────────────────────────────────────────────────────────────────
const BgThemeSystem = (() => {
  const THEMES = [
    { id: 'default',   label: 'ค่าเริ่มต้น', bg: '#f7f6f3', surface: '#ffffff', text: '#1a1915', border: '#e8e6e0' },
    { id: 'cream',     label: '🧈 ครีม',      bg: '#fdf6e3', surface: '#fffdf5', text: '#2c2317', border: '#e8ddc0' },
    { id: 'blush',     label: '🌸 ชมพูอ่อน',  bg: '#fdf0f0', surface: '#fff5f5', text: '#2a1515', border: '#e8c8c8' },
    { id: 'mint',      label: '🌿 มิ้นต์',    bg: '#f0faf5', surface: '#f5fff9', text: '#152a1e', border: '#c0e8d0' },
    { id: 'lavender',  label: '💜 ลาเวนเดอร์', bg: '#f5f0ff', surface: '#faf5ff', text: '#1e1530', border: '#d0c0e8' },
    { id: 'sand',      label: '🏖️ ทราย',      bg: '#f5f0e8', surface: '#fffdf5', text: '#2a200e', border: '#d8c8a0' },
    { id: 'slate',     label: '🪨 สเลต',      bg: '#f0f2f5', surface: '#f8f9fb', text: '#1a1e28', border: '#c8ccd8' },
    { id: 'dark-warm', label: '🌙 มืดอบอุ่น', bg: '#1a1610', surface: '#26221a', text: '#e8dfc8', border: '#3a3428' },
  ];

  const KEY = 'fayeFuse_bg_theme';

  function getSavedTheme() { return localStorage.getItem(KEY) || 'default'; }

  function apply(id) {
    const theme = THEMES.find(t => t.id === id) || THEMES[0];
    const root = document.documentElement;
    if (id === 'default') {
      // Remove all overrides — let CSS vars and dark-mode class handle it
      ['--bg','--surface','--text','--border'].forEach(v => root.style.removeProperty(v));
    } else if (id === 'dark-warm') {
      ['--bg','--surface','--text','--border'].forEach(v => root.style.removeProperty(v));
      document.body.classList.add('dark-home');
      // patch a few vars on top
      root.style.setProperty('--bg', theme.bg);
      root.style.setProperty('--surface', theme.surface);
      root.style.setProperty('--text', theme.text);
      root.style.setProperty('--border', theme.border);
    } else {
      document.body.classList.remove('dark-home');
      root.style.setProperty('--bg', theme.bg);
      root.style.setProperty('--surface', theme.surface);
      root.style.setProperty('--text', theme.text);
      root.style.setProperty('--border', theme.border);
    }
    localStorage.setItem(KEY, id);
    if (window._updateThemeRing) window._updateThemeRing();
  }

  function reset() {
    ['--bg','--surface','--text','--border'].forEach(v =>
      document.documentElement.style.removeProperty(v)
    );
    localStorage.removeItem(KEY);
  }

  function open() {
    const current = getSavedTheme();
    const swatches = THEMES.map(t => `
      <div data-themeid="${t.id}" style="
        display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;
        border:2px solid ${t.id === current ? '#667eea' : 'transparent'};
        background:${t.bg};transition:border-color .15s;margin-bottom:6px;
      ">
        <div style="width:28px;height:28px;border-radius:50%;background:${t.surface};border:2px solid ${t.border};flex-shrink:0;"></div>
        <span style="font-size:13px;color:${t.text};font-weight:500;">${t.label}</span>
        ${t.id === current ? '<span style="margin-left:auto;font-size:11px;color:#667eea;">✓ ใช้อยู่</span>' : ''}
      </div>`).join('');
    
    window.openModal(`
      <h3>🎨 ธีมพื้นหลัง</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:-10px 0 12px">เลือกสีพื้นหลักที่ถนอมสายตา</p>
      <div style="max-height:360px;overflow-y:auto;">${swatches}</div>
      <div class="modal-actions"><button class="modal-btn modal-btn-cancel" id="modal-cancel">ปิด</button></div>
    `);

    document.querySelectorAll('[data-themeid]').forEach(el => {
      el.onclick = () => {
        apply(el.dataset.themeid);
        window.closeModal();
        window.openExtensionsModal(); // re-render ext store if needed
        // reopen theme picker
        open();
      };
    });
  }

  return {
    apply() { apply(getSavedTheme()); },
    open() { open(); },
    reset() { reset(); },
  };
})();
// ─────────────────────────────────────────────────────────────────
// ═══════════════════ MUSIC PLAYER SYSTEM (Supabase) ══════════════
// ─────────────────────────────────────────────────────────────────
const MusicSystem = (() => {
  // ── State ──────────────────────────────────────────────────────
  let playlist = [];       // [{ id, name, url, storage_path }]
  let currentIdx = -1;
  let audio = null;
  let isPlaying = false;
  let turntableAngle = 0;
  let turntableRaf = null;

  // ── Supabase helpers ───────────────────────────────────────────
  const BUCKET = 'music';
  const TABLE  = 'music_playlist';

  async function fetchPlaylist() {
    if (!sbClient) return;
    const { data, error } = await sbClient
      .from(TABLE)
      .select('*')
      .order('sort_order', { ascending: true });
    if (!error && data) playlist = data;
  }

  async function uploadTrack(file, displayName) {
    if (!isOwner()) return null;
    const safeName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = safeName;

    // 1) Upload to Storage
    const { error: upErr } = await sbClient.storage
      .from(BUCKET).upload(path, file, { upsert: false });
    if (upErr) { console.error('upload error', upErr); return null; }

    // 2) Get public URL
    const { data: urlData } = sbClient.storage.from(BUCKET).getPublicUrl(path);
    const url = urlData.publicUrl;

    // 3) Insert row in DB
    const { data: row, error: dbErr } = await sbClient.from(TABLE).insert({
      name: displayName || file.name.replace(/\.[^.]+$/, ''),
      url,
      storage_path: path,
      sort_order: playlist.length,
    }).select().single();

    if (dbErr) { console.error('db insert error', dbErr); return null; }
    playlist.push(row);
    return row;
  }

  async function deleteTrack(id, storagePath) {
    if (!isOwner()) return;
    await sbClient.storage.from(BUCKET).remove([storagePath]);
    await sbClient.from(TABLE).delete().eq('id', id);
    playlist = playlist.filter(t => t.id !== id);
    if (currentIdx >= playlist.length) currentIdx = playlist.length - 1;
  }

  // ── Audio ──────────────────────────────────────────────────────
  function loadTrack(idx) {
    if (!playlist.length) return;
    if (idx < 0) idx = playlist.length - 1;
    if (idx >= playlist.length) idx = 0;
    currentIdx = idx;
    if (audio) { audio.pause(); audio.src = ''; }
    audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = playlist[idx].url;
    audio.volume = (parseInt(document.getElementById('music-volume')?.value || '70')) / 100;
    audio.ontimeupdate = updateProgress;
    audio.onended = () => { loadTrack(currentIdx + 1); playAudio(); };
    audio.onerror = () => {
      const nm = document.getElementById('music-track-name');
      if (nm) nm.textContent = '⚠️ โหลดเพลงไม่ได้';
    };
    updateTrackUI();
  }

  const SVG_PLAY  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const SVG_PAUSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  const SVG_PLAY_SM  = window._SVG_PLAY_SM  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const SVG_PAUSE_SM = window._SVG_PAUSE_SM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  function setPlayIcon(playing) {
    const btn = document.getElementById('music-play');
    if (btn) btn.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    const mb = document.getElementById('mb-play');
    if (mb) mb.innerHTML = playing ? SVG_PAUSE_SM : SVG_PLAY_SM;
  }

  function playAudio() {
    if (!audio) return;
    audio.play().then(() => {
      isPlaying = true;
      setPlayIcon(true);
      const needle = document.getElementById('turntable-needle');
      if (needle) needle.style.transform = 'rotate(5deg)';
    }).catch(e => console.warn('play error', e));
  }

  function pauseAudio() {
    if (audio) audio.pause();
    isPlaying = false;
    setPlayIcon(false);
    const needle = document.getElementById('turntable-needle');
    if (needle) needle.style.transform = 'rotate(-20deg)';
  }

  function updateProgress() {
    if (!audio || !audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    const prog = document.getElementById('music-progress');
    if (prog) prog.value = pct;
    const fmt = s => { const m=Math.floor(s/60), sec=Math.floor(s%60); return m+':'+(sec<10?'0':'')+sec; };
    const cur = document.getElementById('music-time-cur');
    const dur = document.getElementById('music-time-dur');
    if (cur) cur.textContent = fmt(audio.currentTime);
    if (dur) dur.textContent = fmt(audio.duration || 0);
  }

  function updateTrackUI() {
    const nm = document.getElementById('music-track-name');
    const tp = document.getElementById('music-track-type');
    if (!playlist.length) {
      if (nm) nm.textContent = isOwner() ? 'ลาก .mp3 มาวางเพื่อเพิ่มเพลง' : 'ยังไม่มีเพลง';
      if (tp) tp.textContent = '';
      return;
    }
    const t = playlist[currentIdx] || playlist[0];
    if (nm) nm.textContent = t?.name || 'ไม่มีชื่อ';
    if (tp) tp.textContent = (currentIdx + 1) + ' / ' + playlist.length;
  }

  // ── Turntable ──────────────────────────────────────────────────
  function drawTurntable(spinning) {
    const c = document.getElementById('turntable-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const cx = 60, cy = 60, r = 56;
    ctx.clearRect(0, 0, 120, 120);
    ctx.save();
    ctx.translate(cx, cy);
    if (spinning) turntableAngle += 0.9;
    ctx.rotate(turntableAngle * Math.PI / 180);
    // Disc
    const grad = ctx.createRadialGradient(0,0,6,0,0,r);
    grad.addColorStop(0,'#2a2a2a'); grad.addColorStop(0.15,'#111');
    grad.addColorStop(0.5,'#1a1a1a'); grad.addColorStop(1,'#080808');
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
    ctx.fillStyle=grad; ctx.fill();
    // Grooves
    for (let i=18; i<=50; i+=4) {
      ctx.beginPath(); ctx.arc(0,0,i,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.045)'; ctx.lineWidth=1.5; ctx.stroke();
    }
    // Centre label
    ctx.beginPath(); ctx.arc(0,0,17,0,Math.PI*2);
    const lg = ctx.createRadialGradient(0,0,2,0,0,17);
    lg.addColorStop(0,'#764ba2'); lg.addColorStop(1,'#667eea');
    ctx.fillStyle=lg; ctx.fill();
    // Hole
    ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fill();
    ctx.restore();
  }

  function startSpin() {
    function frame() {
      drawTurntable(isPlaying);
      turntableRaf = requestAnimationFrame(frame);
    }
    if (!turntableRaf) frame();
  }
  function stopSpin() {
    if (turntableRaf) { cancelAnimationFrame(turntableRaf); turntableRaf = null; }
  }

  // ── Playlist UI ────────────────────────────────────────────────
  function renderPlaylist() {
    const el = document.getElementById('music-playlist');
    if (!el) return;
    if (!playlist.length) {
      el.innerHTML = `<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-muted);">
        ${isOwner() ? '🎵 ลากไฟล์ .mp3 มาวางที่นี่' : '🎵 ยังไม่มีเพลง'}
      </div>`;
      return;
    }
    el.innerHTML = playlist.map((t, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;
        border-bottom:1px solid var(--border);${i===currentIdx?'background:var(--accent-soft);':''}
        transition:background .15s;" data-plindex="${i}">
        <span style="font-size:14px;width:18px;text-align:center;">${i===currentIdx && isPlaying ? '🎵' : '♪'}</span>
        <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.name}</span>
        ${isOwner() ? `<button data-delid="${t.id}" data-delpath="${t.storage_path}" style="background:none;border:none;color:var(--danger);font-size:13px;cursor:pointer;padding:2px 4px;opacity:.6;">✕</button>` : ''}
      </div>`).join('');

    el.querySelectorAll('[data-plindex]').forEach(row => {
      row.onclick = e => {
        if (e.target.closest('[data-delid]')) return;
        loadTrack(parseInt(row.dataset.plindex));
        playAudio();
        renderPlaylist();
      };
    });

    if (isOwner()) {
      el.querySelectorAll('[data-delid]').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          btn.textContent = '...';
          await deleteTrack(btn.dataset.delid, btn.dataset.delpath);
          if (playlist.length && currentIdx >= 0) loadTrack(currentIdx);
          updateTrackUI();
          renderPlaylist();
        };
      });
    }
  }

  // ── Drop zone ──────────────────────────────────────────────────
  function setupDropZone(el) {
    if (!el || !isOwner()) return;
    el.addEventListener('dragover', e => { e.preventDefault(); el.style.background='var(--accent-soft)'; });
    el.addEventListener('dragleave', () => { el.style.background=''; });
    el.addEventListener('drop', async e => {
      e.preventDefault();
      el.style.background = '';
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/'));
      if (!files.length) return;
      el.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;">⏳ กำลังอัพโหลด...</div>';
      for (const f of files) {
        const row = await uploadTrack(f, f.name.replace(/\.[^.]+$/, ''));
        if (row && currentIdx < 0) loadTrack(0);
      }
      updateTrackUI();
      renderPlaylist();
    });
  }

  // ── File input picker for owner ────────────────────────────────
  function setupFilePicker(btn) {
    if (!btn || !isOwner()) { if (btn) btn.style.display='none'; return; }
    btn.onclick = () => {
      const inp = document.createElement('input');
      inp.type='file'; inp.accept='audio/*'; inp.multiple=true;
      inp.onchange = async () => {
        const files = [...inp.files];
        if (!files.length) return;
        btn.textContent='⏳ อัพโหลด...'; btn.disabled=true;
        for (const f of files) {
          const row = await uploadTrack(f, f.name.replace(/\.[^.]+$/,''));
          if (row && currentIdx<0) loadTrack(0);
        }
        btn.textContent='+ เพิ่มเพลง'; btn.disabled=false;
        updateTrackUI(); renderPlaylist();
      };
      inp.click();
    };
  }

  // ── Modal setup ────────────────────────────────────────────────
  function setupModalEvents() {
    const playBtn  = document.getElementById('music-play');
    const prevBtn  = document.getElementById('music-prev');
    const nextBtn  = document.getElementById('music-next');
    const vol      = document.getElementById('music-volume');
    const prog     = document.getElementById('music-progress');
    const addBtn   = document.getElementById('music-add-btn');
    const plEl     = document.getElementById('music-playlist');

    if (playBtn) playBtn.onclick = () => { isPlaying ? pauseAudio() : playAudio(); };
    if (prevBtn) prevBtn.onclick = () => { loadTrack(currentIdx-1); if(isPlaying) playAudio(); renderPlaylist(); };
    if (nextBtn) nextBtn.onclick = () => { loadTrack(currentIdx+1); if(isPlaying) playAudio(); renderPlaylist(); };
    if (vol) vol.oninput = () => { if(audio) audio.volume = parseInt(vol.value)/100; };
    if (prog) prog.oninput = () => {
      if (audio && audio.duration) audio.currentTime = (parseInt(prog.value)/100)*audio.duration;
    };

    setupFilePicker(addBtn);
    setupDropZone(plEl);
    startSpin();
    updateTrackUI();
    renderPlaylist();
    if (isPlaying && playBtn) setPlayIcon(true);
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    async init() {
      await fetchPlaylist();
      if (playlist.length && currentIdx < 0) currentIdx = 0;
    },
    async open() {
      await fetchPlaylist();
      const modal = document.getElementById('music-modal');
      if (!modal) return;
      modal.style.display = 'flex';
      if (playlist.length && currentIdx < 0) loadTrack(0);
      setupModalEvents();
      document.getElementById('music-close').onclick = () => {
        modal.style.display = 'none';
        stopSpin();
      };
      // Show mini bar once playlist accessed
      const bar = document.getElementById('music-minibar');
      if (bar && playlist.length) { bar.classList.add('active'); document.body.classList.add('minibar-on'); }
      // Init mini bar controls if not done yet
      if (window._musicMiniBarInited !== true) {
        window._musicMiniBarInited = true;
        MusicMiniBar.init();
      }
    },
    stop() {
      pauseAudio(); stopSpin();
      const modal = document.getElementById('music-modal');
      if (modal) modal.style.display = 'none';
    },
    // ── Internal accessors for MusicMiniBar ───────────────────────
    _isPlaying() { return isPlaying; },
    _audio() { return audio; },
    _currentInfo() { return playlist.length && currentIdx >= 0 ? playlist[currentIdx] : null; },
    _play() { playAudio(); },
    _pause() { pauseAudio(); },
    _prev() { loadTrack(currentIdx - 1); if(isPlaying) playAudio(); renderPlaylist(); },
    _next() { loadTrack(currentIdx + 1); if(isPlaying) playAudio(); renderPlaylist(); },
    _setLoop(on) {
      if (audio) audio.loop = false; // will handle manually
      // Override onended to respect loop
      if (audio) {
        audio.onended = on
          ? () => { loadTrack(currentIdx); playAudio(); }
          : () => { loadTrack(currentIdx + 1); playAudio(); };
      }
    },
  };
})();

// ─────────────────────────────────────────────────────────────────
// ═══════════════════ MUSIC MINI BAR ═════════════════════════════
// ─────────────────────────────────────────────────────────────────
const MusicMiniBar = (() => {
  let _loopMode = false;
  let _discAngle = 0;
  let _discRaf = null;

  function drawDisc(spinning) {
    const c = document.getElementById('mb-disc-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const cx = 19, cy = 19, r = 17;
    ctx.clearRect(0, 0, 38, 38);
    ctx.save();
    ctx.translate(cx, cy);
    if (spinning) _discAngle += 1.1;
    ctx.rotate(_discAngle * Math.PI / 180);
    // Disc
    const grad = ctx.createRadialGradient(0,0,4,0,0,r);
    grad.addColorStop(0,'#2a2a2a'); grad.addColorStop(0.18,'#111');
    grad.addColorStop(0.55,'#1a1a1a'); grad.addColorStop(1,'#080808');
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
    ctx.fillStyle=grad; ctx.fill();
    // Grooves
    for (let i=6; i<=14; i+=2.5) {
      ctx.beginPath(); ctx.arc(0,0,i,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1; ctx.stroke();
    }
    // Centre
    ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2);
    const lg = ctx.createRadialGradient(0,0,1,0,0,5);
    lg.addColorStop(0,'#764ba2'); lg.addColorStop(1,'#667eea');
    ctx.fillStyle=lg; ctx.fill();
    ctx.beginPath(); ctx.arc(0,0,1.2,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fill();
    ctx.restore();
  }

  function startDiscSpin() {
    function frame() { drawDisc(MusicSystem._isPlaying()); _discRaf = requestAnimationFrame(frame); }
    if (!_discRaf) frame();
  }
  function stopDiscSpin() {
    if (_discRaf) { cancelAnimationFrame(_discRaf); _discRaf = null; }
  }

  const fmt = s => { const m=Math.floor(s/60), sec=Math.floor(s%60); return m+':'+(sec<10?'0':'')+sec; };

  function updateUI() {
    const info = MusicSystem._currentInfo();
    const bar = document.getElementById('music-minibar');
    const playBtn = document.getElementById('mb-play');
    const nameEl = document.getElementById('mb-track-name');
    const timeEl = document.getElementById('mb-time');
    const progEl = document.getElementById('mb-progress');
    const loopBtn = document.getElementById('mb-loop');
    if (!bar) return;

    if (info) {
      bar.classList.add('active');
      document.body.classList.add('minibar-on');
    }

    if (nameEl) nameEl.textContent = info ? (info.name || 'ไม่มีชื่อ') : 'ไม่มีเพลง';
    if (playBtn) playBtn.innerHTML = MusicSystem._isPlaying() ? (window._SVG_PAUSE_SM||'⏸') : (window._SVG_PLAY_SM||'▶');
    if (loopBtn) loopBtn.className = 'mb-btn' + (_loopMode ? ' mb-loop-on' : '');

    const audio = MusicSystem._audio();
    if (audio && audio.duration) {
      if (progEl) progEl.value = (audio.currentTime / audio.duration) * 100;
      if (timeEl) timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
    } else {
      if (timeEl) timeEl.textContent = '0:00 / 0:00';
    }
  }

  function init() {
    if (window._musicMiniBarInited) return;
    window._musicMiniBarInited = true;
    const bar = document.getElementById('music-minibar');
    if (!bar) return;

    document.getElementById('mb-play').onclick = () => {
      if (MusicSystem._isPlaying()) MusicSystem._pause(); else MusicSystem._play();
      updateUI();
    };
    document.getElementById('mb-prev').onclick = () => { MusicSystem._prev(); updateUI(); };
    document.getElementById('mb-next').onclick = () => { MusicSystem._next(); updateUI(); };
    document.getElementById('mb-loop').onclick = () => {
      _loopMode = !_loopMode;
      MusicSystem._setLoop(_loopMode);
      updateUI();
    };
    document.getElementById('mb-disc-canvas').onclick = () => MusicSystem.open();
    document.getElementById('mb-open-full').onclick = () => MusicSystem.open();

    const prog = document.getElementById('mb-progress');
    if (prog) prog.oninput = () => {
      const audio = MusicSystem._audio();
      if (audio && audio.duration) audio.currentTime = (parseInt(prog.value)/100) * audio.duration;
    };

    // Sync loop: update bar every 250ms
    setInterval(updateUI, 250);
    startDiscSpin();
  }

  return { init, updateUI };
})();

// Init extensions after login — handled inside afterLogin()
