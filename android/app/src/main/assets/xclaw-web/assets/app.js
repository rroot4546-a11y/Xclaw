(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ICONS = {
    opencode: 'O', openclaw: 'L', claude: 'A',
  };
  const LABELS = {
    opencode: 'OpenCode', openclaw: 'OpenClaw', claude: 'Claude',
  };

  let agents = [];
  let activeTool = null;
  let streamOpen = false;

  const els = {
    grid: $('agentsGrid'),
    version: $('appVersion'),
    banner: $('updateBanner'),
    summary: $('updateSummary'),
    updatesList: $('updatesList'),
    checkedText: $('checkedText'),
    scanBtn: $('scanBtn'),
    console: $('console'),
    consoleTitle: $('consoleTitle'),
    consoleBody: $('consoleBody'),
    prompt: $('promptInput'),
    form: $('consoleForm'),
    sendBtn: $('sendBtn'),
    clearBtn: $('clearBtn'),
    close: $('closeConsole'),
    viewUpdatesBtn: $('viewUpdatesBtn'),
    footStatus: $('footStatus'),
  };

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  async function getJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function loadStatus() {
    const data = await getJson('/api/status');
    agents = data.agents || [];
    els.version.textContent = 'v' + (data.app ? data.app.version : '1.0.0');
    renderAgents();
    renderUpdates(data.updates || []);
    els.checkedText.textContent = data.checkedAt ? 'آخر فحص: ' + fmtDate(data.checkedAt) : '';
  }

  function renderAgents() {
    const tpl = $('agentCardTpl');
    els.grid.innerHTML = '';
    agents.forEach(function (a, idx) {
      const node = tpl.content.cloneNode(true);
      const card = node.querySelector('.agent-card');
      card.style.animationDelay = idx * 60 + 'ms';
      node.querySelector('.agent-icon').textContent = ICONS[a.key] || a.label[0];
      node.querySelector('.agent-name').textContent = a.label;
      const ver = node.querySelector('.agent-ver');
      const dot = node.querySelector('.agent-dot');
      if (a.installed) {
        ver.textContent = 'مثبّت | ' + a.installed.split('\n')[0];
        dot.classList.add('ok');
      } else {
        ver.textContent = 'غير مثبّت';
        dot.classList.add('miss');
      }
      const runBtn = node.querySelector('.run-btn');
      runBtn.addEventListener('click', function () { openConsole(a.key); });
      node.querySelector('.agent-card').addEventListener('click', function (ev) {
        if (!ev.target.closest('button')) openConsole(a.key);
      });
      els.grid.appendChild(node);
    });
  }

  function renderUpdates(updates) {
    const avail = updates.filter(function (u) { return u.available; });
    els.banner.classList.toggle('hidden', avail.length === 0);
    if (avail.length) {
      els.summary.textContent = avail.map(function (u) { return u.label + ' → ' + u.latest; }).join(' · ');
    }
    els.updatesList.innerHTML = '';
    updates.forEach(function (u) {
      const row = document.createElement('div');
      row.className = 'update-row';
      const name = document.createElement('div');
      name.innerHTML = '<div class="u-name">' + u.label + '</div><div class="u-vers">الحالي ' +
        (u.current || '—') + ' · الأحدث ' + (u.latest || '؟') + '</div>';
      const state = document.createElement('span');
      if (u.available) {
        state.className = 'u-state avail';
        state.textContent = 'تحديث متاح';
        const btn = document.createElement('button');
        btn.className = 'btn primary small';
        btn.textContent = 'تحديث';
        btn.addEventListener('click', function () { runUpdate(u.key, u.pkg); });
        row.appendChild(name);
        row.appendChild(btn);
        row.appendChild(state);
      } else {
        state.className = 'u-state current';
        state.textContent = 'أحدث إصدار';
        row.appendChild(name);
        row.appendChild(state);
      }
      els.updatesList.appendChild(row);
    });
    if (!updates.length) {
      els.updatesList.innerHTML = '<p class="muted">اضغط زر الفحص بالأعلى للتحقق من آخر الإصدارات.</p>';
    }
  }

  async function scan() {
    els.scanBtn.classList.add('spinning', 'active');
    els.footStatus.textContent = 'جارٍ الفحص…';
    try {
      const data = await getJson('/api/check', { method: 'POST' });
      const avail = (data.payload && data.payload.updates || []).filter(function (u) { return u.available; });
      renderUpdates(data.payload ? data.payload.updates : []);
      els.checkedText.textContent = 'آخر فحص: ' + fmtDate(new Date().toISOString());
      if (avail.length) notify('تحديثات متاحة', avail.map(function (u) { return u.label + ' → ' + u.latest; }).join('، '));
    } catch (e) {
      els.footStatus.textContent = 'فشل الفحص';
    } finally {
      els.scanBtn.classList.remove('spinning', 'active');
    }
  }

  function notify(title, body) {
    try {
      if (window.XclawAndroid && typeof window.XclawAndroid.notify === 'function') {
        window.XclawAndroid.notify(String(title), String(body));
      }
    } catch (e) {}
  }

  function openConsole(key) {
    activeTool = key;
    els.consoleTitle.textContent = LABELS[key] || key;
    els.consoleBody.innerHTML = '';
    els.console.classList.remove('hidden');
    appendLine('p-start', 'وضع التشغيل: ' + (LABELS[key] || key) + ' — اكتب طلبك وأرسله.');
    els.prompt.focus();
  }

  function appendLine(cls, text) {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    els.consoleBody.appendChild(div);
    els.consoleBody.scrollTop = els.consoleBody.scrollHeight;
  }

  async function runPrompt(text) {
    if (streamOpen) return;
    appendLine('p-start', '► ' + text);
    streamOpen = true;
    els.sendBtn.disabled = true;
    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: activeTool, prompt: text }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        parts.forEach(function (chunk) {
          const line = chunk.replace(/^data: /, '');
          if (!line) return;
          let ev;
          try { ev = JSON.parse(line); } catch (e) { return; }
          if (ev.type === 'out') appendLine('p-out', ev.text);
          else if (ev.type === 'error') appendLine('p-err', ev.text);
          else if (ev.type === 'done') {
            appendLine('p-done', ev.code === 0 ? '✓ اكتمل التنفيذ' : '✗ انتهى برمز ' + ev.code);
            loadStatus();
          }
        });
      }
    } catch (e) {
      appendLine('p-err', 'خطأ: ' + e.message);
    } finally {
      streamOpen = false;
      els.sendBtn.disabled = false;
      els.prompt.value = '';
      els.prompt.focus();
    }
  }

  function runUpdate(key, pkg) {
    els.consoleTitle.textContent = 'تحديث ' + (LABELS[key] || key);
    els.consoleBody.innerHTML = '';
    els.console.classList.remove('hidden');
    appendLine('p-start', 'بدء تحديث ' + pkg + '…');
    fetch('/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkg: pkg }),
    })
      .then(function (r) { return r.body.getReader(); })
      .then(async function (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          text.split('\n\n').forEach(function (chunk) {
            const line = chunk.replace(/^data: /, '');
            if (!line) return;
            let ev; try { ev = JSON.parse(line); } catch (e) { return; }
            if (ev.type === 'out') appendLine('p-out', stripAnsi(ev.text));
            else if (ev.type === 'done') { appendLine('p-done', ev.code === 0 ? '✓ تم التحديث' : '✗ فشل التحديث'); loadStatus(); }
            else if (ev.type === 'error') appendLine('p-err', ev.text);
          });
        }
      })
      .catch(function (e) { appendLine('p-err', 'خطأ: ' + e.message); });
  }

  function stripAnsi(s) {
    return s.replace(/\u001b\[[0-9;]*m/g, '');
  }

  function autoGrow() {
    els.prompt.style.height = 'auto';
    els.prompt.style.height = Math.min(els.prompt.scrollHeight, 120) + 'px';
  }

  els.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    const text = els.prompt.value.trim();
    if (!text || streamOpen) return;
    runPrompt(text);
  });

  els.clearBtn.addEventListener('click', function () { els.consoleBody.innerHTML = ''; });
  els.close.addEventListener('click', function () { els.console.classList.add('hidden'); streamOpen = false; });
  els.scanBtn.addEventListener('click', scan);
  els.viewUpdatesBtn.addEventListener('click', function () {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
  els.prompt.addEventListener('input', autoGrow);
  els.prompt.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      els.form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  loadStatus().catch(function () {
    els.footStatus.textContent = 'تعذّر الاتصال بالخدمة';
  });
})();