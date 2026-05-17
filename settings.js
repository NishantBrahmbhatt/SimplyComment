(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEYS = {
    apiKey: 'apiKey',
    profileName: 'profileName',
    profileRole: 'profileRole',
    linkedinUrl: 'linkedinUrl',
    profileTone: 'profileTone',
    profileComments: 'profileComments',
    profilePosts: 'profilePosts',
  };
  const LOCAL_KEYS = {
    styleProfileCache: 'styleProfileCache',
  };
  const SEPARATOR = '\n\n---\n\n';
  const state = {
    comments: [''],
    posts: [''],
  };

  /**
   * Large text fields (comment/post samples) must live in chrome.storage.local.
   * chrome.storage.sync limits each value to 8192 bytes; big pastes fail to save
   * and appear to "reset" after restart.
   */
  const showSaveError = (err) => {
    const msg = err?.message || String(err);
    $('status').textContent = `Save failed: ${msg}`;
  };

  const parseEntries = (raw) =>
    (raw || '')
      .split(/\n{3,}|(?:^|\n)---+\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);

  const serializeEntries = (entries) =>
    (entries || [])
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(SEPARATOR);

  const ensureOneEntry = (arr) => (arr.length ? arr : ['']);

  const getCollectionConfig = (kind) => {
    if (kind === 'comments') {
      return {
        select: $('commentSelect'),
        text: $('commentText'),
        addLabel: 'Comment',
      };
    }
    return {
      select: $('postSelect'),
      text: $('postText'),
      addLabel: 'Post',
    };
  };

  const getSelectedIndex = (kind) => {
    const { select } = getCollectionConfig(kind);
    const parsed = Number(select.value);
    if (!Number.isInteger(parsed) || parsed < 0) return 0;
    return Math.min(parsed, state[kind].length - 1);
  };

  const writeCurrentEntry = (kind) => {
    const { text } = getCollectionConfig(kind);
    const idx = getSelectedIndex(kind);
    state[kind][idx] = text.value;
  };

  const renderCollection = (kind) => {
    const cfg = getCollectionConfig(kind);
    state[kind] = ensureOneEntry(state[kind]);
    const currentIdx = Math.min(getSelectedIndex(kind), state[kind].length - 1);
    cfg.select.innerHTML = state[kind]
      .map((_, i) => `<option value="${i}">${cfg.addLabel} ${i + 1}</option>`)
      .join('');
    cfg.select.value = String(currentIdx);
    cfg.text.value = state[kind][currentIdx] || '';
  };

  const addEntry = (kind) => {
    writeCurrentEntry(kind);
    state[kind].push('');
    renderCollection(kind);
    const cfg = getCollectionConfig(kind);
    cfg.select.value = String(state[kind].length - 1);
    cfg.text.value = '';
    cfg.text.focus();
  };

  const save = () => {
    const apiKey = $('apiKey').value.trim();
    const linkedinUrl = $('linkedinUrl').value.trim();
    writeCurrentEntry('comments');
    writeCurrentEntry('posts');
    const comments = serializeEntries(state.comments);
    const posts = serializeEntries(state.posts);
    if (linkedinUrl && !/^https:\/\/(www\.)?linkedin\.com\/(in|company)\//i.test(linkedinUrl)) {
      $('status').textContent = 'Use a valid LinkedIn profile URL (linkedin.com/in/... or /company/...)';
      return;
    }
    if (!comments) {
      $('status').textContent = 'Add comment samples (required)';
      return;
    }
    if (!posts) {
      $('status').textContent = 'Add post samples (required)';
      return;
    }

    const syncPayload = {
      [KEYS.apiKey]: apiKey,
      [KEYS.profileName]: $('profileName').value.trim(),
      [KEYS.profileRole]: $('profileRole').value.trim(),
      [KEYS.linkedinUrl]: linkedinUrl,
      [KEYS.profileTone]: $('profileTone').value.trim(),
    };

    const localPayload = {
      [KEYS.profileComments]: comments,
      [KEYS.profilePosts]: posts,
    };

    chrome.storage.local.set(localPayload, () => {
      if (chrome.runtime.lastError) {
        showSaveError(chrome.runtime.lastError);
        return;
      }
      chrome.storage.sync.set(syncPayload, () => {
        if (chrome.runtime.lastError) {
          showSaveError(chrome.runtime.lastError);
          return;
        }
        chrome.storage.sync.remove([KEYS.profileComments, KEYS.profilePosts], () => {
          if (chrome.runtime.lastError) {
            showSaveError(chrome.runtime.lastError);
            return;
          }
          $('status').textContent = 'Saved';
          setTimeout(() => { $('status').textContent = ''; }, 2000);
        });
      });
    });
  };

  const restore = () => {
    chrome.storage.local.get([KEYS.profileComments, KEYS.profilePosts], (localItems) => {
      chrome.storage.sync.get({
        [KEYS.apiKey]: '',
        [KEYS.profileName]: '',
        [KEYS.profileRole]: '',
        [KEYS.linkedinUrl]: '',
        [KEYS.profileTone]: '',
        [KEYS.profileComments]: '',
        [KEYS.profilePosts]: '',
      }, (syncItems) => {
        const comments =
          localItems[KEYS.profileComments] !== undefined
            ? localItems[KEYS.profileComments]
            : (syncItems[KEYS.profileComments] || '');
        const posts =
          localItems[KEYS.profilePosts] !== undefined
            ? localItems[KEYS.profilePosts]
            : (syncItems[KEYS.profilePosts] || '');

        $('apiKey').value = syncItems[KEYS.apiKey] || '';
        $('profileName').value = syncItems[KEYS.profileName] || '';
        $('profileRole').value = syncItems[KEYS.profileRole] || '';
        $('linkedinUrl').value = syncItems[KEYS.linkedinUrl] || '';
        $('profileTone').value = syncItems[KEYS.profileTone] || '';
        state.comments = ensureOneEntry(parseEntries(comments));
        state.posts = ensureOneEntry(parseEntries(posts));
        renderCollection('comments');
        renderCollection('posts');

        if (
          localItems[KEYS.profileComments] === undefined &&
          localItems[KEYS.profilePosts] === undefined &&
          (syncItems[KEYS.profileComments] || syncItems[KEYS.profilePosts])
        ) {
          chrome.storage.local.set({
            [KEYS.profileComments]: syncItems[KEYS.profileComments] || '',
            [KEYS.profilePosts]: syncItems[KEYS.profilePosts] || '',
          });
          chrome.storage.sync.remove([KEYS.profileComments, KEYS.profilePosts]);
        }
      });
    });
  };

  const rebuildStyleProfile = () => {
    chrome.storage.local.remove(LOCAL_KEYS.styleProfileCache, () => {
      $('status').textContent = 'Style profile cache cleared. It will rebuild on next generation.';
      setTimeout(() => { $('status').textContent = ''; }, 2600);
    });
  };

  const toggleApiHelp = () => {
    const panel = $('apiHelpPanel');
    const isOpen = panel.classList.toggle('open');
    panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  };

  $('save').addEventListener('click', save);
  $('rebuildStyle').addEventListener('click', rebuildStyleProfile);
  $('apiHelpToggle').addEventListener('click', toggleApiHelp);
  $('commentSelect').addEventListener('change', () => {
    writeCurrentEntry('comments');
    renderCollection('comments');
  });
  $('postSelect').addEventListener('change', () => {
    writeCurrentEntry('posts');
    renderCollection('posts');
  });
  $('commentText').addEventListener('input', () => writeCurrentEntry('comments'));
  $('postText').addEventListener('input', () => writeCurrentEntry('posts'));
  $('addComment').addEventListener('click', () => addEntry('comments'));
  $('addPost').addEventListener('click', () => addEntry('posts'));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restore);
  } else {
    restore();
  }
})();
