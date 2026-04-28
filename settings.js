(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEYS = {
    apiKey: 'apiKey',
    profileName: 'profileName',
    profileRole: 'profileRole',
    profileTone: 'profileTone',
    profileComments: 'profileComments',
    profilePosts: 'profilePosts',
  };

  const save = () => {
    const apiKey = $('apiKey').value.trim();
    if (apiKey && !apiKey.startsWith('sk-')) {
      $('status').textContent = 'API key should start with sk-';
      return;
    }
    chrome.storage.sync.set({
      [KEYS.apiKey]: apiKey,
      [KEYS.profileName]: $('profileName').value.trim(),
      [KEYS.profileRole]: $('profileRole').value.trim(),
      [KEYS.profileTone]: $('profileTone').value.trim(),
      [KEYS.profileComments]: $('profileComments').value,
      [KEYS.profilePosts]: $('profilePosts').value,
    }, () => {
      $('status').textContent = 'Saved';
      setTimeout(() => { $('status').textContent = ''; }, 2000);
    });
  };

  const restore = () => {
    chrome.storage.sync.get({
      [KEYS.apiKey]: '',
      [KEYS.profileName]: '',
      [KEYS.profileRole]: '',
      [KEYS.profileTone]: '',
      [KEYS.profileComments]: '',
      [KEYS.profilePosts]: '',
    }, (items) => {
      $('apiKey').value = items[KEYS.apiKey] || '';
      $('profileName').value = items[KEYS.profileName] || '';
      $('profileRole').value = items[KEYS.profileRole] || '';
      $('profileTone').value = items[KEYS.profileTone] || '';
      $('profileComments').value = items[KEYS.profileComments] || '';
      $('profilePosts').value = items[KEYS.profilePosts] || '';
    });
  };

  $('save').addEventListener('click', save);
  document.addEventListener('DOMContentLoaded', restore);
})();
