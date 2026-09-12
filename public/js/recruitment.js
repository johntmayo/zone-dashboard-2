/**
 * Recruitment Drive — tab visibility, signup forms, and community feeds.
 * Depends on globals from index.html / utils.js (escapeHtml, fetchSheetWrite).
 */
(function (global) {
  'use strict';

  var SHARE_DRIVE_CONFIG = {
    imagePath: '/public/images/recruitment-drive-share.png',
    downloadFilename: 'altagether-recruitment-drive.png',
    defaultPostVariant: 'altagether',
    postVariants: {
      altagether: {
        label: 'Altagether post',
        text: [
          'Altagether is looking for new Neighborhood Captains across Altadena. Captains help keep their neighbors connected, share useful information and resources, and strengthen their neighborhoods as recovery continues.',
          'You don’t need any special expertise, just a willingness to help your neighbors.',
          'Learn more: altagether.org/join'
        ].join('\n\n')
      },
      captain: {
        label: 'Captain post',
        text: 'I’m a Neighborhood Captain with Altagether, and we’re looking for more people to help support neighborhoods across Altadena. If you care about your neighborhood and want a practical way to help your neighbors stay connected, take a look:\naltagether.org/join'
      }
    },
    recruitmentUrl: 'https://altagether.org/join',
    recruitmentUrlLabel: 'altagether.org/join',
    labels: {
      open: 'Share Recruitment Drive',
      download: 'Download image',
      copyPost: 'Copy post',
      copyLink: 'Copy link',
      copied: 'Copied',
      copyFailed: 'Copy failed'
    }
  };

  var CLIENT_ENABLED = true;
  var loaded = false;
  var loading = false;
  var bound = false;
  var shareBound = false;
  var shareLastFocused = null;
  var sharePostVariant = SHARE_DRIVE_CONFIG.defaultPostVariant;
  var config = {
    enabled: CLIENT_ENABLED,
    sheetConfigured: false
  };
  var feed = {
    places: [],
    events: [],
    phoneBank: [],
    links: []
  };

  function escapeLocal(text) {
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function currentZone() {
    try {
      if (typeof currentZoneName === 'string' && currentZoneName) return currentZoneName;
    } catch (err) { /* ignore */ }
    return '';
  }

  function currentCaptainName() {
    try {
      if (typeof ncProfileRowData === 'object' && ncProfileRowData) {
        if (typeof getRowVal === 'function') {
          var fromProfile = getRowVal(ncProfileRowData, 'Name', 'name');
          if (fromProfile) return fromProfile;
        }
        if (ncProfileRowData.Name) return String(ncProfileRowData.Name).trim();
      }
    } catch (err) { /* ignore */ }
    var nameInput = document.getElementById('ncName');
    if (nameInput && nameInput.value) return String(nameInput.value).trim();
    var email = '';
    try {
      if (typeof currentUserEmail === 'string') email = currentUserEmail;
    } catch (err) { /* ignore */ }
    if (!email) return '';
    var local = email.split('@')[0] || '';
    return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, function (ch) {
      return ch.toUpperCase();
    });
  }

  function isEnabled() {
    return Boolean(config.enabled);
  }

  function applyNavVisibility() {
    var show = isEnabled();
    ['navRecruitment', 'mobileMoreRecruitment'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !show);
    });
    if (typeof updateNavigationState === 'function') {
      try { updateNavigationState(); } catch (err) { /* ignore */ }
    }
  }

  function linksForSection(section) {
    return (feed.links || []).filter(function (item) {
      return item.section === section || item.section === 'all';
    });
  }

  function mergeUniqueLinks(primary, secondary) {
    var seen = {};
    return (primary || []).concat(secondary || []).filter(function (item) {
      var key = item.id || item.url;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function renderResourceLinks(containerId, items) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.innerHTML = items.map(function (item) {
      return '<a class="recruitment-resource" href="' + escapeLocal(item.url) +
        '" target="_blank" rel="noopener noreferrer">' + escapeLocal(item.label) + '</a>';
    }).join('');
    el.classList.remove('hidden');
  }

  function renderLinks() {
    var flyerLinks = linksForSection('places');
    var eventLinks = linksForSection('events');
    renderResourceLinks('recruitmentPlaceResources', flyerLinks);
    renderResourceLinks('recruitmentEventResources', mergeUniqueLinks(eventLinks, flyerLinks));
    renderResourceLinks('recruitmentPhoneBankResources', linksForSection('phonebank'));
  }

  function renderSharePost(container, text) {
    if (!container) return;
    container.textContent = '';
    String(text || '').split(/\n{2,}/).forEach(function (paragraph) {
      var p = document.createElement('p');
      p.textContent = paragraph;
      container.appendChild(p);
    });
  }

  function getActiveSharePost() {
    var variant = SHARE_DRIVE_CONFIG.postVariants[sharePostVariant];
    return variant ? variant.text : '';
  }

  function selectSharePostVariant(variantName) {
    if (!SHARE_DRIVE_CONFIG.postVariants[variantName]) return;
    sharePostVariant = variantName;
    var post = document.getElementById('recruitmentSharePost');
    var copyPost = document.getElementById('recruitmentShareCopyPost');
    var status = document.getElementById('recruitmentShareStatus');
    var variantButtons = document.querySelectorAll('[data-recruitment-post-variant]');
    Array.prototype.forEach.call(variantButtons, function (button) {
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-recruitment-post-variant') === sharePostVariant ? 'true' : 'false'
      );
    });
    renderSharePost(post, getActiveSharePost());
    if (copyPost) {
      if (copyPost._recruitmentResetTimer) clearTimeout(copyPost._recruitmentResetTimer);
      copyPost._recruitmentResetTimer = null;
      copyPost.textContent = SHARE_DRIVE_CONFIG.labels.copyPost;
    }
    if (status) status.textContent = '';
  }

  function fallbackCopyText(text) {
    var textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    var copied = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (!copied) throw new Error('Clipboard copy failed');
  }

  async function copyShareText(text) {
    if (navigator.clipboard && global.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (err) {
        // Fall through for browsers that expose Clipboard API but block the call.
      }
    }
    fallbackCopyText(text);
  }

  function showCopyFeedback(button, resetLabel) {
    if (!button) return;
    if (button._recruitmentResetTimer) clearTimeout(button._recruitmentResetTimer);
    button.textContent = SHARE_DRIVE_CONFIG.labels.copied;
    button._recruitmentResetTimer = setTimeout(function () {
      button.textContent = resetLabel;
      button._recruitmentResetTimer = null;
    }, 1800);
  }

  async function handleShareCopy(button, text, resetLabel) {
    var status = document.getElementById('recruitmentShareStatus');
    try {
      await copyShareText(text);
      showCopyFeedback(button, resetLabel);
      if (status) status.textContent = SHARE_DRIVE_CONFIG.labels.copied;
    } catch (err) {
      button.textContent = SHARE_DRIVE_CONFIG.labels.copyFailed;
      if (status) status.textContent = 'Copy failed. Please select and copy the text manually.';
    }
  }

  function closeShareModal() {
    var modal = document.getElementById('recruitmentShareModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    document.body.classList.remove('recruitment-share-open');
    if (shareLastFocused && typeof shareLastFocused.focus === 'function') {
      shareLastFocused.focus();
    }
    shareLastFocused = null;
  }

  function openShareModal() {
    var modal = document.getElementById('recruitmentShareModal');
    var closeButton = document.getElementById('recruitmentShareClose');
    if (!modal) return;
    shareLastFocused = document.activeElement;
    modal.classList.remove('hidden');
    document.body.classList.add('recruitment-share-open');
    if (closeButton) closeButton.focus();
  }

  function handleShareModalKeydown(event) {
    var modal = document.getElementById('recruitmentShareModal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeShareModal();
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(
      modal.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter(function (element) {
      return element.offsetParent !== null;
    });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindShareModal() {
    if (shareBound) return;
    var modal = document.getElementById('recruitmentShareModal');
    var openButton = document.getElementById('recruitmentShareOpen');
    var closeButton = document.getElementById('recruitmentShareClose');
    var image = document.getElementById('recruitmentShareImage');
    var download = document.getElementById('recruitmentShareDownload');
    var post = document.getElementById('recruitmentSharePost');
    var link = document.getElementById('recruitmentShareLink');
    var copyPost = document.getElementById('recruitmentShareCopyPost');
    var copyLink = document.getElementById('recruitmentShareCopyLink');
    if (!modal || !openButton || !closeButton) return;
    var variantButtons = modal.querySelectorAll('[data-recruitment-post-variant]');

    openButton.textContent = SHARE_DRIVE_CONFIG.labels.open;
    if (image) image.src = SHARE_DRIVE_CONFIG.imagePath;
    if (download) {
      download.href = SHARE_DRIVE_CONFIG.imagePath;
      download.download = SHARE_DRIVE_CONFIG.downloadFilename;
      download.textContent = SHARE_DRIVE_CONFIG.labels.download;
    }
    Array.prototype.forEach.call(variantButtons, function (button) {
      var variantName = button.getAttribute('data-recruitment-post-variant');
      var variant = SHARE_DRIVE_CONFIG.postVariants[variantName];
      if (variant) button.textContent = variant.label;
      button.addEventListener('click', function () {
        selectSharePostVariant(variantName);
      });
    });
    selectSharePostVariant(SHARE_DRIVE_CONFIG.defaultPostVariant);
    if (link) link.textContent = SHARE_DRIVE_CONFIG.recruitmentUrlLabel;
    if (copyPost) copyPost.textContent = SHARE_DRIVE_CONFIG.labels.copyPost;
    if (copyLink) copyLink.textContent = SHARE_DRIVE_CONFIG.labels.copyLink;

    openButton.addEventListener('click', openShareModal);
    closeButton.addEventListener('click', closeShareModal);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeShareModal();
    });
    modal.addEventListener('keydown', handleShareModalKeydown);
    if (copyPost) {
      copyPost.addEventListener('click', function () {
        handleShareCopy(copyPost, getActiveSharePost(), SHARE_DRIVE_CONFIG.labels.copyPost);
      });
    }
    if (copyLink) {
      copyLink.addEventListener('click', function () {
        handleShareCopy(copyLink, SHARE_DRIVE_CONFIG.recruitmentUrl, SHARE_DRIVE_CONFIG.labels.copyLink);
      });
    }
    shareBound = true;
  }

  function fillCaptainFields() {
    var name = currentCaptainName();
    ['recruitmentPlaceCaptain', 'recruitmentEventCaptain'].forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.value = name;
    });
  }

  function setStatus(id, message, isError) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', Boolean(isError && message));
  }

  function renderPlaceFeed() {
    var list = document.getElementById('recruitmentPlaceFeed');
    if (!list) return;
    if (!feed.places.length) {
      list.innerHTML = '<li class="recruitment-feed-empty">No places claimed yet. Be the first.</li>';
      return;
    }
    list.innerHTML = feed.places.map(function (item) {
      var meta = [item.captainName, item.zone].filter(Boolean).join(' · ');
      return '<li class="recruitment-feed-item">' +
        '<div class="recruitment-feed-title">' + escapeLocal(item.place) + '</div>' +
        (meta ? '<div class="recruitment-feed-meta">' + escapeLocal(meta) + '</div>' : '') +
        '</li>';
    }).join('');
  }

  function renderEventFeed() {
    var list = document.getElementById('recruitmentEventFeed');
    if (!list) return;
    if (!feed.events.length) {
      list.innerHTML = '<li class="recruitment-feed-empty">No events claimed yet. If you are already going, add it.</li>';
      return;
    }
    list.innerHTML = feed.events.map(function (item) {
      var meta = [item.when, item.captainName, item.zone].filter(Boolean).join(' · ');
      return '<li class="recruitment-feed-item">' +
        '<div class="recruitment-feed-title">' + escapeLocal(item.event) + '</div>' +
        (meta ? '<div class="recruitment-feed-meta">' + escapeLocal(meta) + '</div>' : '') +
        '</li>';
    }).join('');
  }

  function renderPhoneBank() {
    var list = document.getElementById('recruitmentPhoneBankList');
    if (!list) return;
    if (!feed.phoneBank.length) {
      list.innerHTML = '<li class="recruitment-feed-empty">No phone bank sessions posted yet.</li>';
      return;
    }
    list.innerHTML = feed.phoneBank.map(function (item) {
      var when = [item.date, item.time].filter(Boolean).join(' · ');
      var title = item.title || 'Phone bank';
      var attendanceOptions = [];
      if (item.inPersonLocation) {
        attendanceOptions.push(
          '<div class="recruitment-phonebank-option">' +
            '<div class="recruitment-phonebank-label">In person</div>' +
            '<div class="recruitment-phonebank-detail">' + escapeLocal(item.inPersonLocation) + '</div>' +
          '</div>'
        );
      }
      if (item.joinUrl) {
        attendanceOptions.push(
          '<div class="recruitment-phonebank-option">' +
            '<div class="recruitment-phonebank-label">Virtual · Zoom</div>' +
            '<a class="recruitment-resource" href="' + escapeLocal(item.joinUrl) +
              '" target="_blank" rel="noopener noreferrer">Join on Zoom</a>' +
          '</div>'
        );
      }
      return '<li class="recruitment-feed-item recruitment-phonebank-session">' +
        '<div class="recruitment-feed-title">' + escapeLocal(title) + '</div>' +
        (when ? '<div class="recruitment-feed-meta">' + escapeLocal(when) + '</div>' : '') +
        (attendanceOptions.length
          ? '<div class="recruitment-phonebank-options">' + attendanceOptions.join('') + '</div>'
          : '') +
        (item.notes ? '<div class="recruitment-feed-meta">' + escapeLocal(item.notes) + '</div>' : '') +
        '</li>';
    }).join('');
  }

  function applyFeed(data) {
    feed.places = (data && data.places) || [];
    feed.events = (data && data.events) || [];
    feed.phoneBank = (data && data.phoneBank) || [];
    feed.links = (data && data.links) || [];
    if (data && typeof data.sheetConfigured === 'boolean') config.sheetConfigured = data.sheetConfigured;
    renderPlaceFeed();
    renderEventFeed();
    renderPhoneBank();
    renderLinks();
  }

  async function fetchJson(url, options) {
    var fetchFn = typeof fetchSheetWrite === 'function' && options && options.method && options.method !== 'GET'
      ? fetchSheetWrite
      : fetch;
    var response = await fetchFn(url, Object.assign({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }, options || {}));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var err = new Error(payload.message || payload.error || 'Request failed');
      err.status = response.status;
      throw err;
    }
    return payload;
  }

  async function loadConfig() {
    try {
      var data = await fetch('/api/recruitment/config', { credentials: 'include' }).then(function (res) {
        return res.json();
      });
      config.enabled = data && typeof data.enabled === 'boolean' ? data.enabled : CLIENT_ENABLED;
      config.sheetConfigured = Boolean(data && data.sheetConfigured);
    } catch (err) {
      config.enabled = CLIENT_ENABLED;
    }
    applyNavVisibility();
    return config;
  }

  async function loadFeed() {
    if (!isEnabled()) return;
    var placeFeed = document.getElementById('recruitmentPlaceFeed');
    var eventFeed = document.getElementById('recruitmentEventFeed');
    if (!loaded) {
      if (placeFeed) placeFeed.innerHTML = '<li class="recruitment-feed-empty">Loading…</li>';
      if (eventFeed) eventFeed.innerHTML = '<li class="recruitment-feed-empty">Loading…</li>';
    }
    try {
      var data = await fetchJson('/api/recruitment/feed');
      applyFeed(data);
      loaded = true;
    } catch (err) {
      if (placeFeed) {
        placeFeed.innerHTML = '<li class="recruitment-feed-empty">Could not load the feed right now.</li>';
      }
      if (eventFeed) {
        eventFeed.innerHTML = '<li class="recruitment-feed-empty">Could not load the feed right now.</li>';
      }
    }
  }

  async function submitPlace(event) {
    event.preventDefault();
    var input = document.getElementById('recruitmentPlaceName');
    var button = document.getElementById('recruitmentPlaceSubmit');
    var place = input ? String(input.value || '').trim() : '';
    if (!place) {
      setStatus('recruitmentPlaceStatus', 'Enter a business or community space.', true);
      return;
    }
    if (button) button.disabled = true;
    setStatus('recruitmentPlaceStatus', 'Saving…');
    try {
      await fetchJson('/api/recruitment/places', {
        method: 'POST',
        body: JSON.stringify({
          place: place,
          captainName: currentCaptainName(),
          zone: currentZone()
        })
      });
      if (input) input.value = '';
      setStatus('recruitmentPlaceStatus', 'Added. Thank you.');
      await loadFeed();
    } catch (err) {
      setStatus('recruitmentPlaceStatus', err.message || 'Could not save that place.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function submitEvent(event) {
    event.preventDefault();
    var nameInput = document.getElementById('recruitmentEventName');
    var whenInput = document.getElementById('recruitmentEventWhen');
    var button = document.getElementById('recruitmentEventSubmit');
    var name = nameInput ? String(nameInput.value || '').trim() : '';
    var when = whenInput ? String(whenInput.value || '').trim() : '';
    if (!name || !when) {
      setStatus('recruitmentEventStatus', 'Enter the event name and when it happens.', true);
      return;
    }
    if (button) button.disabled = true;
    setStatus('recruitmentEventStatus', 'Saving…');
    try {
      await fetchJson('/api/recruitment/events', {
        method: 'POST',
        body: JSON.stringify({
          event: name,
          when: when,
          captainName: currentCaptainName(),
          zone: currentZone()
        })
      });
      if (nameInput) nameInput.value = '';
      if (whenInput) whenInput.value = '';
      setStatus('recruitmentEventStatus', 'Added. Thank you.');
      await loadFeed();
    } catch (err) {
      setStatus('recruitmentEventStatus', err.message || 'Could not save that event.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindForms() {
    if (bound) return;
    var placeForm = document.getElementById('recruitmentPlaceForm');
    var eventForm = document.getElementById('recruitmentEventForm');
    if (placeForm) placeForm.addEventListener('submit', submitPlace);
    if (eventForm) eventForm.addEventListener('submit', submitEvent);
    bound = true;
  }

  async function loadPage() {
    if (!isEnabled() || loading) return;
    loading = true;
    fillCaptainFields();
    bindForms();
    try {
      await loadFeed();
    } finally {
      loading = false;
    }
  }

  async function boot() {
    bindForms();
    bindShareModal();
    await loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.Recruitment = {
    CLIENT_ENABLED: CLIENT_ENABLED,
    isEnabled: isEnabled,
    applyNavVisibility: applyNavVisibility,
    loadConfig: loadConfig,
    loadPage: loadPage,
    fillCaptainFields: fillCaptainFields
  };
})(window);
