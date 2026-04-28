(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEYS = {
    apiKey: 'apiKey',
    profileName: 'profileName',
    profileRole: 'profileRole',
    profileTone: 'profileTone',
    profileComments: 'profileComments',
    profilePosts: 'profilePosts',
  };
  const DRAFT_KEYS = {
    postText: 'draftPostText',
    gist: 'draftGist',
    output: 'draftOutput',
    mode: 'draftMode',
  };
  let outputText = '';
  let draftTimer = null;

  const showStatus = (text, kind = '') => {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${kind}`.trim();
    if (text) setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3500);
  };

  const setOutput = (text) => {
    outputText = text || '';
    const card = $('outputCard');
    if (!outputText) {
      card.textContent = 'Your one-sentence comment appears here.';
      card.classList.add('empty');
      return;
    }
    card.textContent = outputText;
    card.classList.remove('empty');
  };

  const getMode = () => document.querySelector('.mode-btn--active')?.dataset.mode || 'polish';
  const setMode = (mode) => {
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('mode-btn--active', btn.dataset.mode === mode);
    });
    $('angleWrap').classList.toggle('hide', mode === 'ideate');
  };

  const scrollToComposeStep = () => {
    const target = getMode() === 'ideate' ? $('generate') : $('angleWrap');
    if (!target) return;
    const offset = getMode() === 'ideate' ? 12 : 18;
    const y = Math.max(0, target.offsetTop - offset);
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  const saveDraft = () => {
    chrome.storage.local.set({
      [DRAFT_KEYS.postText]: $('postText').value,
      [DRAFT_KEYS.gist]: $('gist').value,
      [DRAFT_KEYS.output]: outputText,
      [DRAFT_KEYS.mode]: getMode(),
    });
  };
  const scheduleDraft = () => {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 180);
  };

  const parseSamples = (raw) =>
    (raw || '')
      .split(/\n{3,}|(?:^|\n)---+\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);

  const buildSystemPrompt = (profile, mode, toneMode) => {
    const samples = parseSamples(profile.profileComments);
    let voiceBlock = '';
    if (samples.length) {
      voiceBlock += '\n\nUse this voice guidance from real user comments:\n';
      samples.forEach((s, i) => { voiceBlock += `\n[Example ${i + 1}]\n${s}\n`; });
    }
    const who = [profile.profileName && `Name: ${profile.profileName}`, profile.profileRole && `Role: ${profile.profileRole}`].filter(Boolean).join('\n');
    const tone = profile.profileTone ? `\nTone notes: ${profile.profileTone}` : '';
    return (
      'Write one short public comment.\n' +
      'Rules:\n' +
      '- Exactly one sentence, max 35 words.\n' +
      '- Never use an em dash.\n' +
      '- No hashtags. Avoid generic praise.\n' +
      '- Do not invent personal facts.\n' +
      (mode === 'polish'
        ? '- Polish mode: preserve the user angle wording, improve clarity only.\n'
        : '- Ideate mode: produce one concrete, relevant thought from the post.\n') +
      (toneMode === 'direct' ? '- Make it more direct.\n' : '') +
      (who ? `\n${who}` : '') +
      tone +
      voiceBlock
    );
  };

  const sanitize = (s) => (s || '').replace(/\u2014/g, ', ').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
  const weak = (s) => {
    const t = (s || '').toLowerCase();
    if (!t) return true;
    if (t.split(/\s+/).length < 8) return true;
    return ['great post', 'thanks for sharing', 'well said', 'really insightful'].some((p) => t.includes(p));
  };

  const callOpenAI = async (apiKey, system, user) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.85,
        max_tokens: 120,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  };

  const run = async (toneMode = 'normal') => {
    showStatus('');
    const postText = $('postText').value.trim();
    const mode = getMode();
    const gistRaw = $('gist').value.trim();
    const gist = gistRaw || (mode === 'ideate' ? 'I want a thoughtful and specific comment.' : '');
    if (!postText) return showStatus('Paste the post text first.', 'error');
    if (mode === 'polish' && !gistRaw) return showStatus('Add your angle or draft first.', 'error');

    const sync = await chrome.storage.sync.get({
      [STORAGE_KEYS.apiKey]: '',
      [STORAGE_KEYS.profileName]: '',
      [STORAGE_KEYS.profileRole]: '',
      [STORAGE_KEYS.profileTone]: '',
      [STORAGE_KEYS.profileComments]: '',
      [STORAGE_KEYS.profilePosts]: '',
    });
    const apiKey = sync[STORAGE_KEYS.apiKey] || '';
    if (!apiKey) return showStatus('Add API key in Settings.', 'error');

    const profile = {
      profileName: sync[STORAGE_KEYS.profileName],
      profileRole: sync[STORAGE_KEYS.profileRole],
      profileTone: sync[STORAGE_KEYS.profileTone],
      profileComments: sync[STORAGE_KEYS.profileComments],
      profilePosts: sync[STORAGE_KEYS.profilePosts],
    };
    const system = buildSystemPrompt(profile, mode, toneMode);
    const user =
      'POST:\n' + postText +
      '\n\nMY ANGLE:\n' + gist +
      '\n\nWrite the single comment now.';

    ['generate', 'regenerate', 'moreDirect'].forEach((id) => { $(id).disabled = true; });
    setOutput('');
    try {
      let suggestion = sanitize(await callOpenAI(apiKey, system, user));
      if (weak(suggestion)) {
        suggestion = sanitize(await callOpenAI(apiKey, system, user + '\n\nPrevious output was generic. Rewrite with one concrete detail.'));
      }
      setOutput(suggestion);
      saveDraft();
      if (!suggestion) showStatus('Empty response. Try again.', 'error');
    } catch (e) {
      showStatus(e.message || String(e), 'error');
    } finally {
      ['generate', 'regenerate', 'moreDirect'].forEach((id) => { $(id).disabled = false; });
    }
  };

  const restore = async () => {
    const drafts = await chrome.storage.local.get({
      [DRAFT_KEYS.postText]: '',
      [DRAFT_KEYS.gist]: '',
      [DRAFT_KEYS.output]: '',
      [DRAFT_KEYS.mode]: 'polish',
    });
    $('postText').value = drafts[DRAFT_KEYS.postText] || '';
    $('gist').value = drafts[DRAFT_KEYS.gist] || '';
    setOutput(drafts[DRAFT_KEYS.output] || '');
    setMode(drafts[DRAFT_KEYS.mode] || 'polish');
  };

  document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', () => {
    setMode(btn.dataset.mode);
    scheduleDraft();
    setTimeout(scrollToComposeStep, 40);
  }));
  document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    const s = chip.dataset.chip || '';
    const gist = $('gist');
    gist.value = gist.value.trim() ? `${gist.value.trim()} ${s}` : s;
    gist.focus();
    gist.selectionStart = gist.selectionEnd = gist.value.length;
    scheduleDraft();
  }));
  ['postText', 'gist'].forEach((id) => {
    $(id).addEventListener('input', scheduleDraft);
    $(id).addEventListener('blur', saveDraft);
  });
  $('postText').addEventListener('paste', () => {
    setTimeout(() => {
      if ($('postText').value.trim()) scrollToComposeStep();
    }, 40);
  });
  $('generate').addEventListener('click', () => run('normal'));
  $('regenerate').addEventListener('click', () => run('normal'));
  $('moreDirect').addEventListener('click', () => run('direct'));
  $('copyOutput').addEventListener('click', async () => {
    if (!outputText.trim()) return;
    try {
      await navigator.clipboard.writeText(outputText.trim());
      showStatus('Copied', 'success');
    } catch {
      showStatus('Copy failed', 'error');
    }
  });
  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run('normal'); }
    if (e.key.toLowerCase() === 'c' && e.shiftKey) { e.preventDefault(); $('copyOutput').click(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
  restore();
})();
