/* Emit SMTP 桥 · 管理台前端（无构建，原生 JS） */
(() => {
  const state = { csrf: null, user: null };

  const $app = document.getElementById('app');
  const $topbar = document.getElementById('topbar');
  const $whoami = document.getElementById('whoami');

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function api(method, url, body) {
    const headers = {};
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (state.csrf && method !== 'GET') headers['X-CSRF'] = state.csrf;
    const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch { /* 非 JSON */ }
    if (res.status === 401 && !url.endsWith('/login')) {
      state.csrf = null; state.user = null;
      location.hash = '#login';
      throw new Error('未登录');
    }
    return { status: res.status, data };
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ── 登录视图 ────────────────────────────────────────────
  function viewLogin() {
    $topbar.classList.add('hidden');
    $app.innerHTML = `
      <div class="card login-wrap">
        <h1>Emit SMTP 桥</h1>
        <div class="sub">登录管理台</div>
        <label>用户名</label>
        <input id="l-user" autocomplete="username">
        <label style="margin-top:12px">密码</label>
        <input id="l-pass" type="password" autocomplete="current-password">
        <div id="l-msg"></div>
        <button id="l-btn" style="margin-top:16px;width:100%">登录</button>
      </div>`;
    const submit = async () => {
      const user = document.getElementById('l-user').value.trim();
      const pass = document.getElementById('l-pass').value;
      const msg = document.getElementById('l-msg');
      msg.innerHTML = '';
      if (!user || !pass) { msg.innerHTML = '<div class="msg err">请输入用户名和密码</div>'; return; }
      try {
        const { data } = await api('POST', '/api/login', { user, pass });
        if (data.ok) {
          state.user = data.user; state.csrf = data.csrf;
          location.hash = '#compose';
        } else {
          msg.innerHTML = `<div class="msg err">${esc(data.error)}</div>`;
        }
      } catch (e) { msg.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
    };
    document.getElementById('l-btn').onclick = submit;
    document.getElementById('l-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  // ── 发信视图 ────────────────────────────────────────────
  function viewCompose() {
    $topbar.classList.remove('hidden');
    $whoami.textContent = state.user || '';
    $app.innerHTML = `
      <div class="card">
        <h2>发邮件</h2>
        <div class="row">
          <div style="flex:2"><label>发件人</label><input id="c-from" placeholder="名字 <name@example.com>"></div>
        </div>
        <div class="row" style="margin-top:12px">
          <div style="flex:2"><label>收件人（逗号分隔）*</label><input id="c-to" placeholder="a@x.com, b@y.com"></div>
          <div><label>抄送</label><input id="c-cc"></div>
          <div><label>密送</label><input id="c-bcc"></div>
        </div>
        <div style="margin-top:12px"><label>主题</label><input id="c-subject"></div>
        <div style="margin-top:12px"><label>正文（纯文本）</label><textarea id="c-text" style="min-height:140px"></textarea></div>
        <div style="margin-top:12px"><label>HTML 正文（可选，优先于纯文本）</label><textarea id="c-html" style="min-height:80px"></textarea></div>
        <div style="margin-top:12px"><label>附件</label><input id="c-files" type="file" multiple></div>
        <div id="c-msg"></div>
        <button id="c-btn" style="margin-top:16px">发送</button>
      </div>`;

    document.getElementById('c-btn').onclick = async () => {
      const msg = document.getElementById('c-msg');
      msg.innerHTML = '';
      const to = document.getElementById('c-to').value.split(',').map((s) => s.trim()).filter(Boolean);
      const cc = document.getElementById('c-cc').value.split(',').map((s) => s.trim()).filter(Boolean);
      const bcc = document.getElementById('c-bcc').value.split(',').map((s) => s.trim()).filter(Boolean);
      const files = document.getElementById('c-files').files || [];
      if (!to.length) { msg.innerHTML = '<div class="msg err">请填写收件人</div>'; return; }

      const attachments = [];
      for (const f of files) {
        try {
          attachments.push({ filename: f.name, contentType: f.type || 'application/octet-stream', contentBase64: await fileToBase64(f) });
        } catch { /* 忽略读取失败 */ }
      }

      const body = {
        from: document.getElementById('c-from').value.trim(),
        to, cc, bcc,
        subject: document.getElementById('c-subject').value,
        text: document.getElementById('c-text').value,
        html: document.getElementById('c-html').value,
        attachments,
      };

      document.getElementById('c-btn').disabled = true;
      msg.innerHTML = '<div class="msg">发送中…</div>';
      try {
        const { data } = await api('POST', '/api/send', body);
        if (data.ok) {
          msg.innerHTML = `<div class="msg ok">✅ 已受理 · id=${esc(data.id)} · 状态=${esc(data.body?.last_event || 'sent')}</div>`;
        } else {
          msg.innerHTML = `<div class="msg err">❌ ${esc(data.error || JSON.stringify(data.body))}</div>`;
        }
      } catch (e) {
        msg.innerHTML = `<div class="msg err">❌ ${esc(e.message)}</div>`;
      } finally {
        document.getElementById('c-btn').disabled = false;
      }
    };
  }

  // ── 历史视图 ────────────────────────────────────────────
  async function viewHistory() {
    $topbar.classList.remove('hidden');
    $whoami.textContent = state.user || '';
    $app.innerHTML = '<div class="card"><h2>发送历史</h2><div id="h-body">加载中…</div></div>';
    const { data } = await api('GET', '/api/history?limit=200');
    const items = data.items || [];
    const rows = items.map((it) => `
      <tr>
        <td class="mono">${esc(new Date(it.t).toLocaleString('zh-CN'))}</td>
        <td>${esc(it.to?.join(', ') || '')}</td>
        <td>${esc(it.subject || '')}</td>
        <td><span class="badge ${it.status === 'sent' ? 'sent' : 'failed'}">${esc(it.status)}</span></td>
        <td class="mono">${esc(it.id || it.error || '')}</td>
      </tr>`).join('');
    document.getElementById('h-body').innerHTML = items.length
      ? `<table><thead><tr><th>时间</th><th>收件人</th><th>主题</th><th>状态</th><th>id / 错误</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="msg">暂无记录</div>';
  }

  // ── SMTP 设置视图 ───────────────────────────────────────
  async function viewSmtp() {
    $topbar.classList.remove('hidden');
    $whoami.textContent = state.user || '';
    $app.innerHTML = `
      <div class="card">
        <h2>SMTP 设置</h2>
        <div id="s-status" class="msg">读取中…</div>
        <div class="row" style="margin-top:14px">
          <div><label>监听地址</label><input id="s-host"></div>
          <div><label>端口</label><input id="s-port" type="number"></div>
          <div style="flex:0 0 auto;padding-top:26px"><label><input id="s-secure" type="checkbox" style="width:auto"> 隐式 TLS</label></div>
        </div>
        <div class="row" style="margin-top:12px">
          <div><label>SMTP 用户名</label><input id="s-user"></div>
          <div><label>SMTP 密码</label><input id="s-pass" type="text"></div>
          <div><label>每 IP 每小时限速</label><input id="s-rate" type="number"></div>
        </div>
        <div id="s-msg"></div>
        <div style="margin-top:16px;display:flex;gap:10px">
          <button id="s-save">保存并重启</button>
          <button id="s-restart" class="secondary">仅重启服务</button>
        </div>

        <h3>系统日志</h3>
        <div id="s-logs" class="logbox">加载中…</div>
        <button id="s-logs-refresh" class="secondary" style="margin-top:10px">刷新日志</button>

        <h3>修改登录密码</h3>
        <div class="row">
          <div><label>旧密码</label><input id="w-old" type="password"></div>
          <div><label>新密码（6-128 位）</label><input id="w-new" type="password"></div>
        </div>
        <div id="w-msg"></div>
        <button id="w-btn" class="danger" style="margin-top:12px">修改密码</button>
      </div>`;

    const loadEnv = async () => {
      const { data } = await api('GET', '/api/smtp');
      if (data.ok) {
        document.getElementById('s-host').value = data.data.EMIT_SMTP_HOST || '';
        document.getElementById('s-port').value = data.data.EMIT_SMTP_PORT || '';
        document.getElementById('s-secure').checked = data.data.EMIT_SMTP_SECURE === '1';
        document.getElementById('s-user').value = data.data.EMIT_SMTP_USER || '';
        document.getElementById('s-pass').value = data.data.EMIT_SMTP_PASS || '';
        document.getElementById('s-rate').value = data.data.EMIT_RATE_PER_HOUR || '';
      } else {
        document.getElementById('s-status').innerHTML = `<div class="msg err">无法读取配置：${esc(data.error)}</div>`;
      }
    };
    const loadStatus = async () => {
      const { data } = await api('GET', '/api/status');
      const box = document.getElementById('s-status');
      if (data.ok) {
        const running = data.data.active === 'active';
        box.className = 'status-badge ' + (running ? 'running' : 'dead');
        box.textContent = `服务状态：${data.data.active}`;
      } else {
        box.innerHTML = `<div class="msg err">状态不可用：${esc(data.error)}</div>`;
      }
    };
    const loadLogs = async () => {
      const { data } = await api('GET', '/api/logs?n=200');
      document.getElementById('s-logs').textContent = data.ok ? (data.data || '（空）') : ('错误：' + data.error);
    };

    document.getElementById('s-save').onclick = async () => {
      const msg = document.getElementById('s-msg');
      msg.innerHTML = '';
      const body = {
        EMIT_SMTP_HOST: document.getElementById('s-host').value.trim(),
        EMIT_SMTP_PORT: document.getElementById('s-port').value,
        EMIT_SMTP_SECURE: document.getElementById('s-secure').checked ? '1' : '0',
        EMIT_SMTP_USER: document.getElementById('s-user').value.trim(),
        EMIT_SMTP_PASS: document.getElementById('s-pass').value,
        EMIT_RATE_PER_HOUR: document.getElementById('s-rate').value,
      };
      const { data } = await api('POST', '/api/smtp', body);
      msg.innerHTML = data.ok
        ? '<div class="msg ok">✅ 已保存并重启</div>'
        : `<div class="msg err">❌ ${esc(data.error)}</div>`;
      setTimeout(loadStatus, 3000);
    };
    document.getElementById('s-restart').onclick = async () => {
      const { data } = await api('POST', '/api/smtp/restart');
      const msg = document.getElementById('s-msg');
      msg.innerHTML = data.ok ? '<div class="msg ok">✅ 已重启</div>' : `<div class="msg err">❌ ${esc(data.error)}</div>`;
      setTimeout(loadStatus, 3000);
    };
    document.getElementById('s-logs-refresh').onclick = loadLogs;

    document.getElementById('w-btn').onclick = async () => {
      const msg = document.getElementById('w-msg');
      msg.innerHTML = '';
      const { data } = await api('POST', '/api/webpass', {
        oldPass: document.getElementById('w-old').value,
        newPass: document.getElementById('w-new').value,
      });
      msg.innerHTML = data.ok
        ? '<div class="msg ok">✅ 密码已修改，即将重新登录</div>'
        : `<div class="msg err">❌ ${esc(data.error)}</div>`;
      if (data.ok) setTimeout(() => { state.csrf = null; location.hash = '#login'; }, 1500);
    };

    await loadEnv(); await loadStatus(); await loadLogs();
  }

  // ── 路由 ────────────────────────────────────────────────
  function route() {
    const h = location.hash.replace(/^#/, '') || 'compose';
    document.querySelectorAll('#topbar nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + h);
    });
    switch (h) {
      case 'login': viewLogin(); break;
      case 'history': viewHistory(); break;
      case 'smtp': viewSmtp(); break;
      default: viewCompose();
    }
  }

  document.getElementById('logout-btn').onclick = async () => {
    try { await api('POST', '/api/logout'); } catch { /* 忽略 */ }
    state.csrf = null; state.user = null;
    location.hash = '#login';
  };

  // 启动：先探测登录态
  (async () => {
    try {
      const { data } = await api('GET', '/api/me');
      if (data.ok) { state.user = data.user; }
    } catch { /* 未登录 */ }
    window.addEventListener('hashchange', route);
    route();
  })();
})();
