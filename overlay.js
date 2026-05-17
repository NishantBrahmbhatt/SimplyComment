(() => {
  'use strict';

  const HOST_ID = 'simplycomment-extension-host';

  if (document.getElementById(HOST_ID)) return;

  const ICON_URL = chrome.runtime.getURL('icon48.png');
  const STYLE_URL = chrome.runtime.getURL('overlay.css');

  const hostEl = document.createElement('div');
  hostEl.id = HOST_ID;
  document.documentElement.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: 'open' });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_URL;
  shadow.appendChild(link);

  const tmpl = document.createElement('template');
  tmpl.innerHTML = `
<div class="sc-shell" id="scShell">
  <div class="sc-panel-slide">
    <div class="sc-panel-inner">
      <div class="sc-header-row">
        <div class="brand">
          <img src="${ICON_URL}" alt="" />
          <h1>SimplyComment</h1>
        </div>
        <div class="header-actions">
          <button type="button" class="close-btn" id="collapsePanel" aria-label="Close panel">×</button>
          <button type="button" class="settings-btn" id="openSettings">Settings</button>
        </div>
      </div>

      <div class="mode-switch">
        <button type="button" class="mode-btn mode-btn--active" data-mode="polish">Polish my draft</button>
        <button type="button" class="mode-btn" data-mode="ideate">Help me ideate</button>
      </div>

      <label for="postText">Source post</label>
      <textarea id="postText" placeholder="Paste the full post you want to reply to."></textarea>

      <div id="angleWrap">
        <label for="gist">Your take</label>
        <textarea id="gist" placeholder="Write rough thoughts. We refine into one strong comment."></textarea>
        <div class="chip-row">
          <button type="button" class="chip" data-chip="I agree, because">Agree and why</button>
          <button type="button" class="chip" data-chip="I respectfully disagree, because">Respectful pushback</button>
          <button type="button" class="chip" data-chip="Curious what you think about">Ask a smart question</button>
          <button type="button" class="chip" data-chip="One practical takeaway is">Practical takeaway</button>
        </div>
      </div>

      <label>Generate</label>
      <button type="button" class="primary" id="generate">Generate comment</button>

      <label>Generated comment</label>
      <div id="outputCard" class="empty">Your one-sentence comment appears here.</div>
      <div class="actions-row">
        <button type="button" class="secondary" id="copyOutput">Copy</button>
        <button type="button" class="secondary" id="regenerate">Regenerate</button>
        <button type="button" class="secondary" id="moreDirect">More direct</button>
      </div>
      <div id="status" class="status"></div>
    </div>
  </div>
  <button type="button" class="sc-tab-btn" id="scTabToggle" aria-expanded="false" aria-label="SimplyComment" title="SimplyComment">
    <img src="${ICON_URL}" alt="" />
    <span class="sc-tab-label">SC</span>
  </button>
</div>
`;

  shadow.appendChild(tmpl.content.cloneNode(true));

  const $ = (id) => shadow.getElementById(id);

  let panelOpen = false;
  const shell = $('scShell');

  const setPanelOpen = (open) => {
    panelOpen = Boolean(open);
    shell.classList.toggle('sc-shell--open', panelOpen);
    $('scTabToggle').setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
  };

  $('scTabToggle').addEventListener('click', () => setPanelOpen(!panelOpen));
  $('collapsePanel').addEventListener('click', () => setPanelOpen(false));

  const tabImg = $('scTabToggle')?.querySelector('img');
  if (tabImg) {
    tabImg.addEventListener('error', () => {
      $('scTabToggle').classList.add('sc-tab-btn--fallback');
    });
  }

  const STORAGE_KEYS = {
    apiKey: 'apiKey',
    profileName: 'profileName',
    profileRole: 'profileRole',
    linkedinUrl: 'linkedinUrl',
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
  const LOCAL_KEYS = {
    styleProfileCache: 'styleProfileCache',
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

  const getMode = () => shadow.querySelector('.mode-btn--active')?.dataset.mode || 'polish';
  const setMode = (mode) => {
    shadow.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('mode-btn--active', btn.dataset.mode === mode);
    });
    $('angleWrap').classList.toggle('hide', mode === 'ideate');
  };

  const scrollToComposeStep = () => {
    const target = getMode() === 'ideate' ? $('generate') : $('angleWrap');
    if (!target || !panelInnerEl) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  const stableHash = (text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };

  const tokenize = (text) =>
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const toBigrams = (tokens) => {
    const out = [];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      out.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return out;
  };

  const punctuationProfile = (text) => ({
    question: (text.match(/\?/g) || []).length,
    exclaim: (text.match(/!/g) || []).length,
    colon: (text.match(/:/g) || []).length,
    ellipsis: (text.match(/\.\.\./g) || []).length,
  });

  const punctuationDistance = (a, b) =>
    Math.abs(a.question - b.question) +
    Math.abs(a.exclaim - b.exclaim) +
    Math.abs(a.colon - b.colon) +
    Math.abs(a.ellipsis - b.ellipsis);

  const rankSamplesByRelevance = (samples, queryText, targetWordHint = 24) => {
    const queryTokens = tokenize(queryText);
    const querySet = new Set(queryTokens);
    const queryBigrams = new Set(toBigrams(queryTokens));
    const queryPunc = punctuationProfile(queryText);
    if (!samples.length) return [];

    const coarseRanked = samples
      .map((sample) => {
        const tokens = tokenize(sample);
        const unique = new Set(tokens);
        let overlap = 0;
        unique.forEach((t) => { if (querySet.has(t)) overlap += 1; });
        const sampleBigrams = toBigrams(tokens);
        let bigramOverlap = 0;
        sampleBigrams.forEach((bg) => { if (queryBigrams.has(bg)) bigramOverlap += 1; });
        const density = unique.size ? overlap / unique.size : 0;
        const lengthBonus = Math.min(sample.length, 450) / 450;
        const wordCount = tokens.length || 1;
        const lengthDistance = Math.abs(wordCount - targetWordHint);
        const puncDistance = punctuationDistance(queryPunc, punctuationProfile(sample));
        const score =
          overlap * 2 +
          density * 8 +
          bigramOverlap * 2.8 +
          lengthBonus -
          lengthDistance * 0.08 -
          puncDistance * 0.5;
        return { sample, score, overlap, bigramOverlap, lengthDistance, puncDistance };
      })
      .sort((a, b) => b.score - a.score);

    return coarseRanked
      .slice(0, 10)
      .map((item) => {
        const styleTieBreaker =
          item.bigramOverlap * 1.2 +
          item.overlap * 0.4 -
          item.lengthDistance * 0.05 -
          item.puncDistance * 0.2;
        return { ...item, finalScore: item.score + styleTieBreaker };
      })
      .sort((a, b) => b.finalScore - a.finalScore)
      .map((x) => x.sample);
  };

  const selectRelevantSamples = (profile, postText, gist) => {
    const query = `${postText} ${gist}`.trim();
    const commentSamples = parseSamples(profile.profileComments);
    const postSamples = parseSamples(profile.profilePosts);

    const targetWordHint = Math.min(30, Math.max(12, tokenize(query).length || 18));
    const rankedComments = rankSamplesByRelevance(commentSamples, query, targetWordHint);
    const rankedPosts = rankSamplesByRelevance(postSamples, query, targetWordHint);

    return {
      comments: rankedComments.slice(0, 4),
      posts: rankedPosts.slice(0, 2),
    };
  };

  const deriveStyleFingerprint = (commentsRaw, postsRaw) => {
    const comments = parseSamples(commentsRaw);
    const posts = parseSamples(postsRaw);
    const corpus = [...comments, ...posts].map((s) => s.trim()).filter(Boolean);
    if (!corpus.length) return '';

    const sentenceLikePieces = corpus
      .flatMap((s) => s.split(/[.!?]\s+/))
      .map((s) => s.trim())
      .filter((s) => s.length >= 8);

    const avgWords =
      sentenceLikePieces.length
        ? Math.round(
          sentenceLikePieces.reduce((sum, s) => sum + s.split(/\s+/).filter(Boolean).length, 0) /
            sentenceLikePieces.length
        )
        : 14;

    const punctuationCounts = {
      exclaim: (corpus.join(' ').match(/!/g) || []).length,
      question: (corpus.join(' ').match(/\?/g) || []).length,
      ellipsis: (corpus.join(' ').match(/\.\.\./g) || []).length,
      colon: (corpus.join(' ').match(/:/g) || []).length,
      semicolon: (corpus.join(' ').match(/;/g) || []).length,
      parens: (corpus.join(' ').match(/[()]/g) || []).length,
    };

    const emojiCount = (corpus.join(' ').match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length;
    const firstPersonCount =
      (corpus.join(' ').match(/\b(i|i'm|ive|i've|my|me|we|our|us)\b/gi) || []).length;
    const corpusWordCount = corpus.join(' ').split(/\s+/).filter(Boolean).length || 1;

    const firstPersonDensity = firstPersonCount / corpusWordCount;
    const exclaimDensity = punctuationCounts.exclaim / corpusWordCount;
    const questionDensity = punctuationCounts.question / corpusWordCount;
    const emojiDensity = emojiCount / corpusWordCount;

    const styleBullets = [];
    styleBullets.push(
      `- Typical sentence length is around ${avgWords} words; stay near that unless clarity requires shorter.`
    );

    if (firstPersonDensity > 0.018) {
      styleBullets.push(
        '- First-person voice is common; use it naturally when it fits the user angle.'
      );
    } else {
      styleBullets.push('- First-person voice is less common; avoid overusing "I" statements.');
    }

    if (questionDensity > 0.008) {
      styleBullets.push('- Questions are part of this voice; asking one concise question is acceptable.');
    } else {
      styleBullets.push(
        '- Questions are less common; prefer statements unless the user angle clearly asks a question.'
      );
    }

    if (exclaimDensity > 0.008) {
      styleBullets.push('- Light enthusiasm punctuation can appear occasionally, but keep it controlled.');
    } else {
      styleBullets.push('- Keep punctuation restrained; avoid exclamation-heavy phrasing.');
    }

    if (emojiDensity > 0.002) {
      styleBullets.push('- Emoji can be used sparingly if it feels natural to this user.');
    } else {
      styleBullets.push('- Avoid emoji unless explicitly present in the user angle.');
    }

    if (punctuationCounts.ellipsis > 0) {
      styleBullets.push('- Ellipses appear in samples; use only if it feels natural and not excessive.');
    }
    if (punctuationCounts.colon > 0) {
      styleBullets.push('- Colon usage appears in samples; concise colon structures are acceptable.');
    }
    if (punctuationCounts.semicolon === 0) styleBullets.push('- Avoid semicolons.');
    if (punctuationCounts.parens === 0) {
      styleBullets.push('- Avoid parenthetical asides unless necessary for clarity.');
    }

    return styleBullets.join('\n');
  };

  const getCachedStyleFingerprint = async (commentsRaw, postsRaw) => {
    const source = `${commentsRaw || ''}\n\n${postsRaw || ''}`;
    const sourceHash = stableHash(source);
    const cached = await chrome.storage.local.get({ [LOCAL_KEYS.styleProfileCache]: null });
    const existing = cached[LOCAL_KEYS.styleProfileCache];
    if (existing && existing.hash === sourceHash && existing.fingerprint) {
      return existing.fingerprint;
    }

    const fingerprint = deriveStyleFingerprint(commentsRaw, postsRaw);
    await chrome.storage.local.set({
      [LOCAL_KEYS.styleProfileCache]: {
        hash: sourceHash,
        fingerprint,
        updatedAt: Date.now(),
      },
    });
    return fingerprint;
  };

  const buildSystemPrompt = (profile, mode, toneMode, selectedSamples, cachedFingerprint) => {
    const samples = selectedSamples?.comments || [];
    const postSamples = selectedSamples?.posts || [];
    let voiceBlock = '';
    if (samples.length) {
      voiceBlock += '\n\nUse these most relevant voice examples from the user comments:\n';
      samples.forEach((s, i) => { voiceBlock += `\n[Example ${i + 1}]\n${s}\n`; });
    }
    if (postSamples.length) {
      voiceBlock += '\n\nUse these most relevant voice examples from user posts:\n';
      postSamples.forEach((s, i) => { voiceBlock += `\n[Post ${i + 1}]\n${s}\n`; });
    }
    const styleFingerprint =
      cachedFingerprint || deriveStyleFingerprint(profile.profileComments, profile.profilePosts);
    const who = [
      profile.profileName && `Name: ${profile.profileName}`,
      profile.profileRole && `Role: ${profile.profileRole}`,
      profile.linkedinUrl && `LinkedIn profile URL: ${profile.linkedinUrl}`,
    ].filter(Boolean).join('\n');
    const tone = profile.profileTone ? `\nTone notes: ${profile.profileTone}` : '';
    return (
      'Write one short public comment.\n' +
      'Rules:\n' +
      '- Exactly one sentence, max 35 words.\n' +
      '- Never use an em dash.\n' +
      '- No hashtags. Avoid generic praise.\n' +
      '- Do not invent personal facts.\n' +
      '- Match the user voice from examples: sentence rhythm, punctuation habits, directness, and level of specificity.\n' +
      '- Do not copy any sample sentence verbatim. Mimic style, not exact wording.\n' +
      '- Prefer concrete wording over vague praise.\n' +
      '- Prioritize style cues from the most relevant examples for this post context.\n' +
      '- Keep wording natural and human. Avoid template-like openings and closings.\n' +
      '- Anchor at least one phrase to a specific detail from the post text.\n' +
      (mode === 'polish'
        ? '- Polish mode: preserve the user angle wording, improve clarity only.\n'
        : '- Ideate mode: produce one concrete, relevant thought from the post.\n') +
      (toneMode === 'direct' ? '- Make it more direct.\n' : '') +
      (styleFingerprint ? `\nDerived style fingerprint:\n${styleFingerprint}\n` : '') +
      (who ? `\n${who}` : '') +
      tone +
      voiceBlock
    );
  };

  const sanitize = (s) =>
    (s || '').replace(/\u2014/g, ', ').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
  const weak = (s) => {
    const t = (s || '').toLowerCase();
    if (!t) return true;
    if (t.split(/\s+/).length < 8) return true;
    return ['great post', 'thanks for sharing', 'well said', 'really insightful'].some((p) =>
      t.includes(p)
    );
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
    if (mode === 'polish' && !gistRaw) {
      return showStatus('Polish mode needs a quick draft first.', 'error');
    }

    const sync = await chrome.storage.sync.get({
      [STORAGE_KEYS.apiKey]: '',
      [STORAGE_KEYS.profileName]: '',
      [STORAGE_KEYS.profileRole]: '',
      [STORAGE_KEYS.linkedinUrl]: '',
      [STORAGE_KEYS.profileTone]: '',
      [STORAGE_KEYS.profileComments]: '',
      [STORAGE_KEYS.profilePosts]: '',
    });
    const localSamples = await chrome.storage.local.get([
      STORAGE_KEYS.profileComments,
      STORAGE_KEYS.profilePosts,
    ]);
    const commentsRaw =
      localSamples[STORAGE_KEYS.profileComments] !== undefined
        ? localSamples[STORAGE_KEYS.profileComments]
        : (sync[STORAGE_KEYS.profileComments] || '');
    const postsRaw =
      localSamples[STORAGE_KEYS.profilePosts] !== undefined
        ? localSamples[STORAGE_KEYS.profilePosts]
        : (sync[STORAGE_KEYS.profilePosts] || '');
    const apiKey = sync[STORAGE_KEYS.apiKey] || '';
    if (!apiKey) return showStatus('Add API key in Settings.', 'error');

    const profile = {
      profileName: sync[STORAGE_KEYS.profileName],
      profileRole: sync[STORAGE_KEYS.profileRole],
      linkedinUrl: sync[STORAGE_KEYS.linkedinUrl],
      profileTone: sync[STORAGE_KEYS.profileTone],
      profileComments: commentsRaw,
      profilePosts: postsRaw,
    };
    const hasCommentContext = parseSamples(profile.profileComments).length > 0;
    const hasPostContext = (profile.profilePosts || '').trim().length > 0;
    if (!hasCommentContext || !hasPostContext) {
      return showStatus('Add comment samples and post samples in Settings before generating.', 'error');
    }
    const selectedSamples = selectRelevantSamples(profile, postText, gist);
    const cachedFingerprint = await getCachedStyleFingerprint(
      profile.profileComments,
      profile.profilePosts
    );
    const system = buildSystemPrompt(profile, mode, toneMode, selectedSamples, cachedFingerprint);
    const userMsg =
      'POST:\n' +
      postText +
      '\n\nMY ANGLE:\n' +
      gist +
      '\n\nWrite the single comment now.';

    ['generate', 'regenerate', 'moreDirect'].forEach((id) => {
      $(id).disabled = true;
    });
    setOutput('');
    try {
      let suggestion = sanitize(await callOpenAI(apiKey, system, userMsg));
      if (weak(suggestion)) {
        suggestion = sanitize(
          await callOpenAI(
            apiKey,
            system,
            userMsg + '\n\nPrevious output was generic. Rewrite with one concrete detail.'
          )
        );
      }
      setOutput(suggestion);
      saveDraft();
      if (!suggestion) showStatus('Empty response. Try again.', 'error');
    } catch (e) {
      showStatus(e.message || String(e), 'error');
    } finally {
      ['generate', 'regenerate', 'moreDirect'].forEach((id) => {
        $(id).disabled = false;
      });
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

  shadow.querySelectorAll('.mode-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
      scheduleDraft();
      setTimeout(scrollToComposeStep, 40);
    })
  );
  shadow.querySelectorAll('.chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      const s = chip.dataset.chip || '';
      const gistEl = $('gist');
      gistEl.value = gistEl.value.trim() ? `${gistEl.value.trim()} ${s}` : s;
      gistEl.focus();
      gistEl.selectionStart = gistEl.selectionEnd = gistEl.value.length;
      scheduleDraft();
    })
  );
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

  /** Hotkeys mirror popup while the LinkedIn overlay is open */
  document.addEventListener(
    'keydown',
    (e) => {
      if (!panelOpen) return;
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        run('normal');
      }
      if (e.key.toLowerCase() === 'c' && e.shiftKey) {
        e.preventDefault();
        $('copyOutput').click();
      }
    },
    true
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDraft();
  });

  restore();
})();
