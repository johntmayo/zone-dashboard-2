/**
 * Contact Check-In — client UI + save flow.
 * Depends on globals from index.html / utils.js / address-id.js.
 */
(function (global) {
  'use strict';

  var CHECKIN_DEFAULT_ID = 'contact_check_in_2026';
  var SUCCESSFULLY_CONTACTED_HEADER = 'Successfully Contacted';

  var state = {
    checkInId: CHECKIN_DEFAULT_ID,
    reviewsByAddressId: {},
    queue: [],
    currentIndex: 0,
    activeBranch: null,
    pendingNoOutreach: [],
    pendingNoNotes: [],
    reviewSkippedOnly: false,
    loaded: false,
    loading: false,
    saving: false,
    sessionReviews: 0,
    celebrated: {},
    refreshTimer: null,
    pendingRefreshAddress: null,
    needsViewRefresh: false
  };

  // Bridged from index.html (let/const there are not on window)
  var ctx = {
    accessToken: null,
    currentUserEmail: null,
    currentZoneName: '',
    currentSheetId: null,
    sheetData: null
  };

  function setContext(next) {
    if (!next || typeof next !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(next, 'accessToken')) ctx.accessToken = next.accessToken || null;
    if (Object.prototype.hasOwnProperty.call(next, 'currentUserEmail')) ctx.currentUserEmail = next.currentUserEmail || null;
    if (Object.prototype.hasOwnProperty.call(next, 'currentZoneName')) ctx.currentZoneName = next.currentZoneName || '';
    if (Object.prototype.hasOwnProperty.call(next, 'currentSheetId')) ctx.currentSheetId = next.currentSheetId || null;
    if (Object.prototype.hasOwnProperty.call(next, 'sheetData')) ctx.sheetData = next.sheetData || null;
  }

  function getSheetData() {
    return ctx.sheetData || null;
  }

  function escapeHtmlLocal(text) {
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function toast(msg) {
    showCciNudge({ title: 'Heads up', message: msg, duration: 3200 });
  }

  function showCciError(message) {
    showCciNudge({ title: 'Couldn\u2019t save', message: message, tone: 'error', duration: 5000 });
  }

  // Light confirmation — same family as milestone cards, no confetti.
  function showCciNudge(opts) {
    opts = opts || {};
    var title = opts.title || 'Saved';
    var message = opts.message || '';
    var tone = opts.tone || 'default';
    var duration = opts.duration != null ? opts.duration : 2800;

    var old = document.getElementById('cciNudge');
    if (old) old.remove();

    var el = document.createElement('div');
    el.id = 'cciNudge';
    el.className = 'cci-nudge' + (tone === 'error' ? ' cci-nudge-error' : '');
    el.innerHTML =
      '<div class="cci-nudge-card" role="status">' +
      '  <div class="cci-nudge-accent"></div>' +
      '  <div class="cci-nudge-body">' +
      '    <strong>' + escapeHtmlLocal(title) + '</strong>' +
      (message ? '<span>' + escapeHtmlLocal(message) + '</span>' : '') +
      '  </div>' +
      '</div>';
    document.body.appendChild(el);

    var dismiss = function () {
      el.classList.add('leaving');
      setTimeout(function () { if (el.parentNode) el.remove(); }, 280);
    };
    el.querySelector('.cci-nudge-card').addEventListener('click', dismiss);
    setTimeout(dismiss, duration);
  }

  function truthySheetValue(value) {
    var v = String(value == null ? '' : value).trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === 'y' || v === '1' || v === 'checked' || v === 'x';
  }

  function getCaptainId() {
    return String(ctx.currentUserEmail || '').trim().toLowerCase();
  }

  function getZoneId() {
    return String(ctx.currentZoneName || '').trim() || 'unknown_zone';
  }

  function findHeader(headers, exactName, aliases) {
    if (!Array.isArray(headers)) return null;
    if (headers.includes(exactName)) return exactName;
    var lowerExact = String(exactName || '').toLowerCase();
    var found = headers.find(function (h) { return String(h || '').toLowerCase() === lowerExact; });
    if (found) return found;
    if (typeof findColumn === 'function' && aliases) return findColumn(headers, aliases);
    return null;
  }

  function getPersonName(row, headers) {
    if (typeof getResidentNameColumn === 'function') {
      var col = getResidentNameColumn(headers);
      if (col && row[col]) return String(row[col]).trim();
    }
    var first = findHeader(headers, 'First Name', ['first name', 'firstname']);
    var last = findHeader(headers, 'Last Name', ['last name', 'lastname']);
    var parts = [first ? row[first] : '', last ? row[last] : ''].map(function (p) {
      return String(p || '').trim();
    }).filter(Boolean);
    if (parts.length) return parts.join(' ');
    return 'Unnamed resident';
  }

  function isFormerOrDeceased(row, headers) {
    var formerCol = typeof findColumn === 'function'
      ? findColumn(headers, ['former', 'resident'], ['note'])
      : null;
    var deceasedCol = typeof findColumn === 'function'
      ? findColumn(headers, 'deceased')
      : findHeader(headers, 'Deceased');
    if (formerCol && truthySheetValue(row[formerCol])) return true;
    if (deceasedCol && truthySheetValue(row[deceasedCol])) return true;
    return false;
  }

  function getAddressIdForRows(rows, headers) {
    if (!rows || !rows.length) return '';
    var ids = typeof collectAddressIdsFromRows === 'function'
      ? collectAddressIdsFromRows(rows, headers)
      : [];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) {
      if (typeof reportAddressIdConflict === 'function') {
        reportAddressIdConflict({
          source: 'contact_checkin_queue',
          addressIds: ids.slice(),
          displayAddress: (getSheetData() && getSheetData().getAddressString)
            ? getSheetData().getAddressString(rows[0])
            : ''
        });
      }
      return ids[0];
    }
    // Fallback: synthetic key from display address so Check-In can still run
    // before address_id is fully seeded. Progress will re-key once IDs exist.
    var display = '';
    var sheet = getSheetData();
    if (sheet && typeof sheet.getAddressString === 'function') {
      display = sheet.getAddressString(rows[0]) || '';
    }
    return display ? ('legacy__' + display) : '';
  }

  function buildQueueFromSheet() {
    var sheet = getSheetData();
    if (!sheet || !sheet.addressMap) return [];
    var headers = sheet.headers || [];
    var items = [];
    sheet.addressMap.forEach(function (rows, displayAddress) {
      var activeRows = (rows || []).filter(function (row) {
        return !isFormerOrDeceased(row, headers);
      });
      var useRows = activeRows.length ? activeRows : (rows || []);
      if (!useRows.length) return;
      var addressId = getAddressIdForRows(useRows, headers);
      if (!addressId) return;

      var contactCol = findHeader(headers, SUCCESSFULLY_CONTACTED_HEADER, ['successfully contacted']);
      var outreachDateCol = typeof findOutreachDateColumn === 'function' ? findOutreachDateColumn(headers) : null;
      var outreachLogCol = typeof findOutreachLogColumn === 'function' ? findOutreachLogColumn(headers) : null;
      var apnCol = findHeader(headers, 'APN', ['apn']);

      var residents = useRows.map(function (row, idx) {
        var residentId = row.resident_id != null ? String(row.resident_id).trim() : '';
        return {
          id: residentId || ('row_' + (row.__originalIndex != null ? row.__originalIndex : idx)),
          residentId: residentId,
          row: row,
          name: getPersonName(row, headers),
          contacted: contactCol ? truthySheetValue(row[contactCol]) : false,
          lastOutreach: outreachDateCol ? String(row[outreachDateCol] || '').trim() : '',
          log: outreachLogCol ? String(row[outreachLogCol] || '').trim() : '',
          notes: ''
        };
      });

      var hasOutreach = residents.some(function (r) {
        return Boolean(r.lastOutreach || r.log);
      });

      items.push({
        id: addressId,
        displayAddress: displayAddress,
        apn: apnCol ? String(useRows[0][apnCol] || '').trim() : '',
        rows: useRows,
        residents: residents,
        outreachSummary: hasOutreach
          ? 'Outreach has been logged for this address.'
          : 'No outreach attempts are currently logged.',
        hasOutreach: hasOutreach
      });
    });

    if (typeof sortAddressesByStreetThenNumber === 'function') {
      var order = sortAddressesByStreetThenNumber(items.map(function (i) { return i.displayAddress; }));
      var rank = {};
      order.forEach(function (addr, i) { rank[addr] = i; });
      items.sort(function (a, b) {
        return (rank[a.displayAddress] || 0) - (rank[b.displayAddress] || 0);
      });
    } else {
      items.sort(function (a, b) {
        return String(a.displayAddress).localeCompare(String(b.displayAddress));
      });
    }
    return items;
  }

  function reviewKeyFor(addressId) {
    return [state.checkInId, getZoneId(), getCaptainId(), addressId].join('__');
  }

  function getReview(addressId) {
    return state.reviewsByAddressId[addressId] || null;
  }

  function computeLocalSummary() {
    var total = state.queue.length;
    var reviewed = 0;
    var skipped = 0;
    var reachedFromReviews = 0;
    Object.keys(state.reviewsByAddressId).forEach(function (addressId) {
      var r = state.reviewsByAddressId[addressId];
      if (!r) return;
      if (r.review_status === 'reviewed') {
        reviewed += 1;
        if (r.answer === 'yes_successful_contact') reachedFromReviews += 1;
      } else if (r.review_status === 'skipped') {
        skipped += 1;
      }
    });
    // Also count addresses with Successfully Contacted people even if not yet reviewed in this pass
    var reachedPeople = state.queue.filter(function (a) {
      return a.residents.some(function (r) { return r.contacted; });
    }).length;
    return {
      total: total,
      reviewed: reviewed,
      skipped: skipped,
      remaining: Math.max(0, total - reviewed),
      reached: Math.max(reachedFromReviews, reachedPeople),
      percentReviewed: total > 0 ? Math.round((reviewed / total) * 100) : 0
    };
  }

  async function loadReviews() {
    var captainId = getCaptainId();
    var zoneId = getZoneId();
    if (!captainId || !zoneId) {
      state.reviewsByAddressId = {};
      state.loaded = false;
      return;
    }
    state.loading = true;
    try {
      var configRes = await fetch('/api/contact-checkin/config');
      if (configRes.ok) {
        var config = await configRes.json();
        if (config.checkInId) state.checkInId = config.checkInId;
      }
      var total = state.queue.length;
      var url = '/api/contact-checkin/reviews'
        + '?zone_id=' + encodeURIComponent(zoneId)
        + '&captain_id=' + encodeURIComponent(captainId)
        + '&check_in_id=' + encodeURIComponent(state.checkInId)
        + '&total_addresses=' + encodeURIComponent(String(total));
      var res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load reviews');
      var data = await res.json();
      var map = {};
      (data.reviews || []).forEach(function (row) {
        var aid = String(row.address_id || '').trim();
        if (aid) map[aid] = row;
      });
      state.reviewsByAddressId = map;
      state.loaded = true;
    } catch (err) {
      console.warn('Contact Check-In: could not load reviews', err);
      state.reviewsByAddressId = {};
      state.loaded = false;
    } finally {
      state.loading = false;
    }
  }

  async function saveReviewRecord(addressId, reviewStatus, answer) {
    var res = await fetch('/api/contact-checkin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        check_in_id: state.checkInId,
        zone_id: getZoneId(),
        captain_id: getCaptainId(),
        address_id: addressId,
        review_status: reviewStatus,
        answer: answer || ''
      })
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || err.error || 'Failed to save review');
    }
    var data = await res.json();
    if (data.review) {
      state.reviewsByAddressId[addressId] = data.review;
    }
    return data.review;
  }

  async function batchUpdateResidentFields(updatesByResidentId) {
    if (!updatesByResidentId.length) return;
    if (!ctx.currentSheetId) throw new Error('No sheet loaded');
    var res = await fetch('/api/sheets/batch-update-by-resident-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetId: ctx.currentSheetId,
        sheetName: 'Sheet1',
        valueInputOption: 'USER_ENTERED',
        updates: updatesByResidentId
      })
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.message || err.error || 'Failed to update resident fields');
    }
  }

  // Mirror saved values onto the in-memory sheet rows so the rest of the app
  // (Neighbors tab, Map, details panel) reflects Check-In edits without a reload.
  function applyLocalRowUpdates(address, updates) {
    if (!updates || !updates.length) return;
    var rowsByResidentId = {};
    address.residents.forEach(function (resident) {
      if (resident.residentId && resident.row) rowsByResidentId[resident.residentId] = resident.row;
    });
    updates.forEach(function (u) {
      var row = rowsByResidentId[u.resident_id];
      if (row) row[u.column] = u.value;
    });
  }

  // Re-render Neighbors / Map / Details after in-memory sheet edits.
  // Deferred so Save & Next feels instant during the wizard.
  function refreshLinkedViews(address) {
    try {
      if (typeof syncViewsAfterLocalSheetEdit === 'function') {
        syncViewsAfterLocalSheetEdit({
          displayAddress: address && address.displayAddress ? address.displayAddress : ''
        });
        return;
      }
      var sheet = getSheetData();
      if (!sheet || !sheet.addressMap) return;
      if (typeof displayAddressTable === 'function') displayAddressTable();
      if (typeof displayAddressList === 'function') {
        displayAddressList(Array.from(sheet.addressMap.keys()).sort());
      }
      if (typeof updateMapMarkers === 'function') updateMapMarkers();
    } catch (err) {
      console.warn('Contact Check-In: could not refresh linked views', err);
    }
  }

  function scheduleLinkedViewsRefresh(address) {
    state.pendingRefreshAddress = address;
    state.needsViewRefresh = true;
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    var wizardEl = document.getElementById('contactCheckInWizard');
    if (wizardEl && wizardEl.classList.contains('show')) return;

    state.refreshTimer = setTimeout(function () {
      state.refreshTimer = null;
      flushLinkedViewsRefresh();
    }, 120);
  }

  function flushLinkedViewsRefresh() {
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (!state.needsViewRefresh) return;
    var address = state.pendingRefreshAddress;
    state.needsViewRefresh = false;
    state.pendingRefreshAddress = null;
    refreshLinkedViews(address);
  }

  function setSaveBusy(busy) {
    Array.prototype.forEach.call(document.querySelectorAll('#cciSaveYes, #cciSaveNo, [data-cci-skip]'), function (btn) {
      if (!btn) return;
      btn.disabled = busy;
      if (busy) btn.classList.add('cci-busy');
      else btn.classList.remove('cci-busy');
    });
    var saveYes = document.getElementById('cciSaveYes');
    var saveNo = document.getElementById('cciSaveNo');
    if (saveYes) {
      if (busy && !saveYes.dataset.cciLabel) saveYes.dataset.cciLabel = saveYes.textContent;
      saveYes.textContent = busy ? 'Saving\u2026' : (saveYes.dataset.cciLabel || 'Save & Next');
    }
    if (saveNo) {
      if (busy && !saveNo.dataset.cciLabel) saveNo.dataset.cciLabel = saveNo.textContent;
      saveNo.textContent = busy ? 'Saving\u2026' : (saveNo.dataset.cciLabel || 'Save & Next');
    }
  }

  // ---- Milestones & encouragement -----------------------------------------

  var YES_NUDGES = [
    { title: 'Saved', message: 'Another household connected.' },
    { title: 'Saved', message: 'Great work reaching your neighbors.' },
    { title: 'Saved', message: 'That\u2019s one more household heard from.' },
    { title: 'Saved', message: 'Nicely done — keep going.' }
  ];
  var NO_NUDGES = [
    { title: 'Saved', message: 'Every review helps map the zone.' },
    { title: 'Saved', message: 'Knowing who hasn\u2019t been reached matters too.' },
    { title: 'Saved', message: 'Thanks for keeping the picture accurate.' },
    { title: 'Saved', message: 'Onward to the next address.' }
  ];
  var nudgeCycle = 0;

  function encouragingNudge(list) {
    nudgeCycle += 1;
    showCciNudge(list[nudgeCycle % list.length]);
  }

  function streetOfAddress(displayAddress) {
    if (typeof extractStreet === 'function') {
      return String(extractStreet(displayAddress) || '').trim();
    }
    return String(displayAddress || '').replace(/^\s*\d+\s*/, '').trim();
  }

  function isStreetFullyReviewed(street) {
    if (!street) return false;
    var items = state.queue.filter(function (item) {
      return streetOfAddress(item.displayAddress) === street;
    });
    if (!items.length) return false;
    return items.every(function (item) {
      var review = getReview(item.id);
      return review && review.review_status === 'reviewed';
    });
  }

  function countReviewedOnStreet(street) {
    if (!street) return 0;
    return state.queue.filter(function (item) {
      if (streetOfAddress(item.displayAddress) !== street) return false;
      var review = getReview(item.id);
      return review && review.review_status === 'reviewed';
    }).length;
  }

  // Pick at most one celebration for this save, most significant first.
  function detectMilestone(address, prevSummary, nextSummary) {
    var total = nextSummary.total;
    if (!total) return null;
    var zoneLabel = ctx.currentZoneName ? ('in ' + ctx.currentZoneName) : 'in your zone';

    if (nextSummary.reviewed >= total && prevSummary.reviewed < total) {
      return {
        key: 'zone_complete',
        title: 'Zone complete!',
        message: 'Every address ' + zoneLabel + ' has been reviewed. Incredible work — your neighbors are lucky to have you.',
        tier: 'major'
      };
    }

    var prevPct = (prevSummary.reviewed / total) * 100;
    var nextPct = (nextSummary.reviewed / total) * 100;
    var percentMilestones = [
      { pct: 90, title: 'Almost there!', message: '90% reviewed — you are in the home stretch.' },
      { pct: 75, title: 'Three quarters done!', message: '75% of your zone is reviewed. The finish line is in sight.' },
      { pct: 66, title: 'Two-thirds done!', message: 'You have reviewed two-thirds of your zone. Strong momentum.' },
      { pct: 50, title: 'Halfway there!', message: 'You\u2019ve reviewed half the addresses ' + zoneLabel + '. Keep it rolling.' },
      { pct: 33, title: 'One-third done!', message: 'A third of your zone is reviewed. Nice pace.' },
      { pct: 25, title: 'Great momentum!', message: 'A quarter of your zone is already reviewed. Off to a strong start.' },
      { pct: 20, title: 'Building steam!', message: '20% of your zone reviewed — you are finding your rhythm.' },
      { pct: 10, title: 'Off and running!', message: '10% of your zone is reviewed. Every address helps the picture.' }
    ];
    for (var i = 0; i < percentMilestones.length; i++) {
      var m = percentMilestones[i];
      if (prevPct < m.pct && nextPct >= m.pct && !state.celebrated['pct_' + m.pct]) {
        return { key: 'pct_' + m.pct, title: m.title, message: m.message, tier: 'major' };
      }
    }

    var countMilestones = [
      { count: 1, title: 'First one done!', message: 'Your first address is reviewed. Great way to start.' },
      { count: 5, title: 'Five down!', message: 'Five addresses reviewed. You are on your way.' },
      { count: 10, title: 'Ten reviewed!', message: 'Double digits — ten addresses checked off.' },
      { count: 25, title: 'Twenty-five!', message: 'Twenty-five addresses reviewed. That is real progress.' },
      { count: 50, title: 'Fifty reviewed!', message: 'Fifty addresses — your zone is taking shape.' }
    ];
    for (var c = 0; c < countMilestones.length; c++) {
      var cm = countMilestones[c];
      if (prevSummary.reviewed < cm.count && nextSummary.reviewed >= cm.count && !state.celebrated['count_' + cm.count]) {
        return { key: 'count_' + cm.count, title: cm.title, message: cm.message, tier: cm.count >= 25 ? 'major' : 'mini' };
      }
    }

    var street = streetOfAddress(address.displayAddress);
    if (street && !state.celebrated['street_' + street] && isStreetFullyReviewed(street)) {
      return {
        key: 'street_' + street,
        title: 'Street complete!',
        message: 'That\u2019s every address on ' + street + ' reviewed. On to the next one.',
        tier: 'major'
      };
    }

    if (street && !state.celebrated['street_prog_' + street]) {
      var streetTotal = state.queue.filter(function (item) {
        return streetOfAddress(item.displayAddress) === street;
      }).length;
      var streetReviewed = countReviewedOnStreet(street);
      if (streetTotal >= 3 && streetReviewed >= streetTotal - 1 && streetReviewed < streetTotal) {
        return {
          key: 'street_prog_' + street,
          title: 'Almost done with ' + street + '!',
          message: 'One more address on this street and it is complete.',
          tier: 'mini'
        };
      }
    }

    if (nextSummary.remaining === 5 && prevSummary.remaining > 5 && !state.celebrated.home_stretch) {
      return {
        key: 'home_stretch',
        title: 'Home stretch!',
        message: 'Only 5 addresses left in your whole zone.',
        tier: 'major'
      };
    }

    if (nextSummary.remaining === 1 && prevSummary.remaining > 1 && !state.celebrated.final_one) {
      return {
        key: 'final_one',
        title: 'One left!',
        message: 'Just one address remaining in your zone.',
        tier: 'mini'
      };
    }

    var n = state.sessionReviews;
    var sessionMilestones = [3, 5, 8, 10, 15, 20, 25, 30];
    for (var s = 0; s < sessionMilestones.length; s++) {
      var sm = sessionMilestones[s];
      if (n === sm && !state.celebrated['session_' + sm]) {
        return {
          key: 'session_' + sm,
          title: sm + ' this session!',
          message: sm <= 5
            ? 'You\u2019re on a roll — ' + sm + ' addresses reviewed since you sat down.'
            : 'Unstoppable. ' + sm + ' addresses reviewed in one sitting.',
          tier: sm >= 10 ? 'major' : 'mini'
        };
      }
    }
    if (n >= 35 && n % 5 === 0 && !state.celebrated['session_' + n]) {
      return {
        key: 'session_' + n,
        title: n + ' this session!',
        message: 'You are flying — ' + n + ' addresses reviewed without stopping.',
        tier: 'mini'
      };
    }

    return null;
  }

  function showMiniCelebration(milestone) {
    state.celebrated[milestone.key] = true;
    showCciNudge({
      title: milestone.title,
      message: milestone.message,
      duration: 3400
    });
  }

  function showCelebration(milestone) {
    state.celebrated[milestone.key] = true;
    var old = document.getElementById('cciCelebrate');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'cciCelebrate';
    overlay.className = 'cci-celebrate';
    var confetti = '';
    for (var i = 0; i < 20; i++) {
      var left = Math.round(Math.random() * 100);
      var delay = (Math.random() * 0.6).toFixed(2);
      var duration = (1.6 + Math.random() * 1.4).toFixed(2);
      var colors = ['#e8b64c', '#c96f4a', '#7fa96b', '#304059', '#b6cdd8'];
      var color = colors[i % colors.length];
      confetti += '<i style="left:' + left + '%;background:' + color +
        ';animation-delay:' + delay + 's;animation-duration:' + duration + 's;"></i>';
    }
    overlay.innerHTML =
      '<div class="cci-celebrate-card" role="status">' +
      '  <div class="cci-celebrate-ring"></div>' +
      '  <div class="cci-celebrate-confetti">' + confetti + '</div>' +
      '  <h2>' + escapeHtmlLocal(milestone.title) + '</h2>' +
      '  <p>' + escapeHtmlLocal(milestone.message) + '</p>' +
      '</div>';
    document.body.appendChild(overlay);

    var dismiss = function () {
      overlay.classList.add('leaving');
      setTimeout(function () { overlay.remove(); }, 400);
    };
    overlay.querySelector('.cci-celebrate-card').addEventListener('click', dismiss);
    setTimeout(dismiss, 4200);
  }

  function celebrateOrToast(address, prevSummary, nudgeList) {
    state.sessionReviews += 1;
    var milestone = detectMilestone(address, prevSummary, computeLocalSummary());
    if (milestone) {
      if (milestone.tier === 'mini') showMiniCelebration(milestone);
      else showCelebration(milestone);
    } else {
      encouragingNudge(nudgeList);
    }
  }

  function ensureDom() {
    if (document.getElementById('contactCheckInLearnMore')) return;

    var learn = document.createElement('div');
    learn.id = 'contactCheckInLearnMore';
    learn.className = 'cci-modal-backdrop';
    learn.innerHTML = [
      '<section class="cci-modal" role="dialog" aria-modal="true">',
      '  <button type="button" class="cci-close" data-cci-close-learn>&times;</button>',
      '  <h1>About Contact Check-In</h1>',
      '  <p class="cci-serif">Altagether is asking Neighborhood Captains to help us understand which households have been successfully reached, and which may still need help connecting.</p>',
      '  <p class="cci-serif">A successful contact means a real two-way interaction: someone replied, answered, spoke with you, asked a question, joined a conversation, or otherwise confirmed they received your message.</p>',
      '  <p class="cci-serif">This is part of a broader community effort with partner organizations working to understand who has been reached after the Eaton Fire and who may still need help connecting.</p>',
      '  <div class="cci-soft-box"><strong>Participating groups include:</strong><ul>',
      '    <li>Altagether</li>',
      '    <li>Clergy Community Coalition + PostFire</li>',
      '    <li>Community Women Vital Voices</li>',
      '    <li>Eaton Fire Residents United + EF Surviving Structures</li>',
      '  </ul></div>',
      '  <p class="cci-serif">Altagether may share address-level contact coverage with Department of Angels and cohort partners: whether someone at each address has been successfully contacted. We will not share resident names, individual contact details, phone numbers, email addresses, notes, or outreach logs.</p>',
      '  <div class="cci-actionbar"><button type="button" class="cci-primary" data-cci-close-learn>Got it</button></div>',
      '</section>'
    ].join('');
    document.body.appendChild(learn);

    var wizard = document.createElement('div');
    wizard.id = 'contactCheckInWizard';
    wizard.className = 'cci-modal-backdrop';
    wizard.innerHTML = [
      '<section class="cci-modal cci-modal-wide" role="dialog" aria-modal="true">',
      '  <button type="button" class="cci-close" data-cci-close-wizard>&times;</button>',
      '  <div class="cci-wizard-header">',
      '    <div>',
      '      <h1>Contact Check-In</h1>',
      '      <div class="cci-sub">Review one address at a time. Stop whenever you need; your progress is saved.</div>',
      '    </div>',
      '    <div class="cci-wizard-progress">',
      '      <div class="cci-progress-row">',
      '        <div class="cci-bar"><div class="cci-bar-fill" id="cciModalProgressBar"></div></div>',
      '        <strong id="cciModalProgressText">0%</strong>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="cci-address-card" id="cciAddressCard"></div>',
      '</section>'
    ].join('');
    document.body.appendChild(wizard);

    learn.addEventListener('click', function (e) {
      if (e.target === learn || e.target.closest('[data-cci-close-learn]')) closeLearnMore();
    });
    wizard.addEventListener('click', function (e) {
      if (e.target === wizard || e.target.closest('[data-cci-close-wizard]')) closeWizard();
    });
  }

  function renderHomeWidget() {
    var mount = document.getElementById('contactCheckInContent');
    if (!mount) return;
    ensureDom();

    if (!ctx.accessToken || !getCaptainId()) {
      mount.innerHTML = '<p class="cci-muted">Sign in to start Contact Check-In for your zone.</p>';
      return;
    }
    if (!state.queue.length) {
      mount.innerHTML = '<p class="cci-muted">Load a zone spreadsheet to begin Contact Check-In.</p>';
      return;
    }

    var summary = computeLocalSummary();
    var startLabel = summary.reviewed > 0 ? 'Continue Contact Check-In' : 'Start Contact Check-In';
    mount.innerHTML = [
      '<p class="cci-tagline">Help Altagether understand which households in your zone have been reached—and which may still need help connecting. <a href="#" class="announcement-link" id="cciLearnMoreBtn">Learn more</a></p>',
      '<div class="cci-progress-row">',
      '  <div class="cci-bar"><div class="cci-bar-fill" style="width:' + summary.percentReviewed + '%"></div></div>',
      '  <strong>' + summary.reviewed + ' of ' + summary.total + '</strong>',
      '</div>',
      '<div class="cci-mini-stats">',
      '  <div class="cci-mini-stat"><strong>' + summary.reviewed + '</strong><span>Reviewed</span></div>',
      '  <div class="cci-mini-stat"><strong>' + summary.remaining + '</strong><span>Remaining</span></div>',
      '  <div class="cci-mini-stat"><strong>' + summary.reached + '</strong><span>Reached</span></div>',
      '  <div class="cci-mini-stat"><strong>' + summary.skipped + '</strong><span>Skipped</span></div>',
      '</div>',
      '<div class="cci-home-actions">',
      '  <button type="button" class="quick-action-link" id="cciStartBtn">' + escapeHtmlLocal(startLabel) + '</button>',
      summary.skipped > 0
        ? '  <button type="button" class="cci-secondary" id="cciReviewSkippedBtn">Review skipped</button>'
        : '',
      '</div>'
    ].join('');

    var learnBtn = document.getElementById('cciLearnMoreBtn');
    if (learnBtn) {
      learnBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openLearnMore();
      });
    }
    var startBtn = document.getElementById('cciStartBtn');
    if (startBtn) startBtn.addEventListener('click', function () { openWizard(false); });
    var skippedBtn = document.getElementById('cciReviewSkippedBtn');
    if (skippedBtn) skippedBtn.addEventListener('click', function () { openWizard(true); });
  }

  function formatCount(n) {
    return String(Number(n) || 0);
  }

  function highlightToHtml(item) {
    if (!item || !item.type) return '';
    if (item.type === 'town_milestone') {
      return '<li><strong>Town-wide:</strong> ' + formatCount(item.count) +
        ' address' + (item.count === 1 ? '' : 'es') + ' reviewed in the last 48 hours.</li>';
    }
    if (item.type === 'zone_progress') {
      return '<li><strong>' + escapeHtmlLocal(item.zone) + '</strong> reviewed ' +
        formatCount(item.count) + ' address' + (item.count === 1 ? '' : 'es') + ' recently.</li>';
    }
    return '';
  }

  function renderCommunityFeed(community) {
    var mount = document.getElementById('contactCheckInFeedContent');
    if (!mount) return;

    var data = community || {};
    var reviewed = Number(data.reviewedAddresses) || 0;
    var reached = Number(data.reached) || 0;
    var captains = Number(data.captainsParticipating) || 0;
    var zones = Number(data.zonesParticipating) || 0;
    var recent = Number(data.reviewedLast48h) || 0;
    var highlights = Array.isArray(data.highlights) ? data.highlights : [];
    var hasActivity = reviewed > 0 || captains > 0;

    var local = computeLocalSummary();
    var feedItems = [];
    if (local.reviewed > 0 && getZoneId() && getZoneId() !== 'unknown_zone') {
      feedItems.push(
        '<li><strong>Your zone:</strong> ' + formatCount(local.reviewed) + ' of ' +
        formatCount(local.total) + ' addresses reviewed.</li>'
      );
    }
    highlights.forEach(function (item) {
      // Avoid duplicating the town-wide line when we already show the metric
      if (item && item.type === 'town_milestone' && recent > 0) return;
      var html = highlightToHtml(item);
      if (html) feedItems.push(html);
    });
    if (recent > 0) {
      feedItems.unshift(
        '<li><strong>Town-wide:</strong> ' + formatCount(recent) +
        ' address' + (recent === 1 ? '' : 'es') + ' reviewed in the last 48 hours.</li>'
      );
    }

    if (!hasActivity) {
      mount.innerHTML = [
        '<p class="cci-feed-intro">Updates from Altagether’s org-wide <strong>Contact Check-In</strong> campaign — progress across zones as captains review which households have been reached.</p>',
        '<p class="cci-feed-empty">No town-wide Check-In activity yet. When captains start reviewing addresses, momentum across zones will show up here.</p>'
      ].join('');
      return;
    }

    mount.innerHTML = [
      '<p class="cci-feed-intro">Altagether-wide Contact Check-In progress across participating zones.</p>',
      '<div class="cci-community-metrics">',
      '  <div class="cci-community-metric"><strong>' + formatCount(reviewed) + '</strong><span>Addresses reviewed</span></div>',
      '  <div class="cci-community-metric"><strong>' + formatCount(reached) + '</strong><span>Reached</span></div>',
      '  <div class="cci-community-metric"><strong>' + formatCount(zones) + '</strong><span>Zones underway</span></div>',
      '</div>',
      '<p class="cci-feed-meta">' +
        formatCount(captains) + ' captain' + (captains === 1 ? '' : 's') + ' participating' +
        (recent > 0 ? ' · ' + formatCount(recent) + ' reviewed in the last 48 hours' : '') +
      '.</p>',
      feedItems.length
        ? '<ul class="cci-feed-list">' + feedItems.join('') + '</ul>'
        : '<p class="cci-feed-empty">Your zone progress is saved automatically as you go.</p>'
    ].join('');
  }

  async function loadCommunityFeed() {
    var mount = document.getElementById('contactCheckInFeedContent');
    if (!mount) return;
    try {
      var url = '/api/contact-checkin/community'
        + '?check_in_id=' + encodeURIComponent(state.checkInId || CHECKIN_DEFAULT_ID);
      var res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load community feed');
      var data = await res.json();
      renderCommunityFeed(data.community || {});
    } catch (err) {
      console.warn('Contact Check-In: could not load community feed', err);
      mount.innerHTML = [
        '<p class="cci-feed-intro">Updates from Altagether’s org-wide <strong>Contact Check-In</strong> campaign.</p>',
        '<p class="cci-feed-empty">Community progress will appear here once Check-In activity is available.</p>'
      ].join('');
    }
  }

  function openLearnMore() {
    ensureDom();
    document.getElementById('contactCheckInLearnMore').classList.add('show');
  }
  function closeLearnMore() {
    var el = document.getElementById('contactCheckInLearnMore');
    if (el) el.classList.remove('show');
  }

  function findNextIndex(fromIndex, skippedOnly) {
    var start = typeof fromIndex === 'number' ? fromIndex : -1;
    for (var i = start + 1; i < state.queue.length; i++) {
      var review = getReview(state.queue[i].id);
      if (skippedOnly) {
        if (review && review.review_status === 'skipped') return i;
      } else {
        if (!review || review.review_status === 'skipped') return i;
      }
    }
    if (!skippedOnly) {
      for (var j = 0; j <= start; j++) {
        var r2 = getReview(state.queue[j].id);
        if (!r2 || r2.review_status === 'skipped') return j;
      }
    }
    return -1;
  }

  function openWizard(skippedOnly) {
    if (!ctx.accessToken) {
      toast('Please sign in to use Contact Check-In.');
      return;
    }
    ensureDom();
    state.reviewSkippedOnly = Boolean(skippedOnly);
    state.currentIndex = findNextIndex(-1, state.reviewSkippedOnly);
    if (state.currentIndex < 0) {
      toast(skippedOnly ? 'No skipped addresses to review.' : 'All addresses in this zone are reviewed.');
      renderHomeWidget();
      return;
    }
    document.getElementById('contactCheckInWizard').classList.add('show');
    renderAddressCard();
  }

  function closeWizard() {
    var el = document.getElementById('contactCheckInWizard');
    if (el) el.classList.remove('show');
    flushLinkedViewsRefresh();
    renderHomeWidget();
    loadCommunityFeed();
  }

  function personRowHtml(resident) {
    var id = escapeHtmlLocal(resident.id);
    return [
      '<div class="cci-person-row">',
      '  <input type="checkbox" class="cci-contact-check" value="' + id + '" id="cci_chk_' + id + '"' + (resident.contacted ? ' checked' : '') + '>',
      '  <div class="cci-person-content">',
      '    <label class="cci-person-heading" for="cci_chk_' + id + '">',
      '      <span class="cci-person-name">' + escapeHtmlLocal(resident.name) + '</span>',
      resident.contacted ? ' <span class="cci-status-pill good">Already contacted</span>' : '',
      '    </label>',
      '    <button type="button" class="cci-options-toggle" data-cci-toggle="cci_opts_' + id + '">Options / notes</button>',
      '    <div class="cci-person-options" id="cci_opts_' + id + '">',
      '      <div class="cci-checks">',
      '        <label><input type="checkbox" data-cci-field="wantsUpdates" data-cci-id="' + id + '"> Wants updates</label>',
      '        <label><input type="checkbox" data-cci-field="followUp" data-cci-id="' + id + '"> Needs follow-up</label>',
      '        <label><input type="checkbox" data-cci-field="unable" data-cci-id="' + id + '"> Unable to reach <span class="cci-tooltip" data-tip="Use only when you have tried multiple times and still have not been able to reach this person.">?</span></label>',
      '        <label><input type="checkbox" data-cci-field="former" data-cci-id="' + id + '"> Former resident</label>',
      '        <label><input type="checkbox" data-cci-field="deceased" data-cci-id="' + id + '"> Deceased</label>',
      '      </div>',
      '      <textarea data-cci-note-id="' + id + '" placeholder="Person note optional"></textarea>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function residentNamesLine(address) {
    var names = (address.residents || [])
      .map(function (r) { return String(r.name || '').trim(); })
      .filter(Boolean);
    if (!names.length) {
      return '<div class="cci-resident-names">No residents listed</div>';
    }
    return '<div class="cci-resident-names">' + escapeHtmlLocal(names.join(' · ')) + '</div>';
  }

  function personOptionsHtml(address) {
    return address.residents.map(function (r) {
      return '<option value="' + escapeHtmlLocal(r.id) + '">' + escapeHtmlLocal(r.name) + '</option>';
    }).join('');
  }

  function unableCheckboxesHtml(address) {
    return address.residents.map(function (r) {
      return '<label><input type="checkbox" data-cci-unable-id="' + escapeHtmlLocal(r.id) + '"> ' + escapeHtmlLocal(r.name) + '</label>';
    }).join('');
  }

  function renderAddressCard() {
    var card = document.getElementById('cciAddressCard');
    if (!card) return;
    if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) {
      showComplete();
      return;
    }

    state.activeBranch = null;
    state.pendingNoOutreach = [];
    state.pendingNoNotes = [];

    var address = state.queue[state.currentIndex];
    updateModalProgress();

    var existing = getReview(address.id);
    var statusHtml = existing
      ? '<span class="cci-status-pill ' + (existing.review_status === 'skipped' ? 'skip' : 'good') + '">' +
        (existing.review_status === 'skipped' ? 'Skipped for now' : 'Reviewed') + '</span>'
      : '';

    var peopleHtml = address.residents.map(personRowHtml).join('');

    card.innerHTML = [
      '<div class="cci-address-top">',
      '  <div>',
      '    <h2 class="cci-address-title">' + escapeHtmlLocal(address.displayAddress) + '</h2>',
      '    <div class="cci-tiny">APN: ' + escapeHtmlLocal(address.apn || 'not set') + '</div>',
      residentNamesLine(address),
      '  </div>',
      statusHtml,
      '</div>',
      '<div class="cci-context-line">',
      '  <span class="cci-context-text">' + escapeHtmlLocal(address.outreachSummary) + '</span>',
      '  <button type="button" class="cci-link-btn" id="cciToggleOutreachDetails">View details</button>',
      '</div>',
      '<div id="cciOutreachDetails" class="cci-outreach-details hidden">',
      address.residents.map(function (r) {
        return '<div class="cci-outreach-person"><strong>' + escapeHtmlLocal(r.name) + '</strong> — ' +
          (r.lastOutreach ? 'Last outreach: ' + escapeHtmlLocal(r.lastOutreach) : 'No outreach logged') +
          (r.log ? '<div class="cci-tiny cci-pre">' + escapeHtmlLocal(r.log) + '</div>' : '') +
          '</div>';
      }).join(''),
      '</div>',
      '<div class="cci-question">Have you successfully contacted anyone at this address?',
      '  <span class="cci-tooltip" data-tip="Contact means a two-way interaction. They replied, answered, spoke with you, asked a question, or otherwise confirmed they received your message. Sending an email, leaving a voicemail, or dropping off a flyer does not count unless they responded.">?</span>',
      '</div>',
      '<div class="cci-choice-row">',
      '  <button type="button" class="cci-big-choice" data-cci-branch="yes">Yes</button>',
      '  <button type="button" class="cci-big-choice" data-cci-branch="no">No</button>',
      '  <button type="button" class="cci-big-choice skip" data-cci-skip>Skip for now</button>',
      '</div>',
      '<div class="cci-branch" id="cciYesBranch">',
      '  <h3>Who have you successfully contacted?</h3>',
      '  <div class="cci-people-list">' + peopleHtml,
      '    <div class="cci-person-row">',
      '      <input type="checkbox" id="cciSomeoneElse">',
      '      <div class="cci-person-content">',
      '      <label for="cciSomeoneElse" class="cci-person-heading cci-person-name">Someone else at this address</label>',
      '      <div class="cci-quick-add" id="cciQuickAdd">',
      '        <strong>Quick add resident</strong>',
      '        <div class="cci-form-grid">',
      '          <input type="text" id="cciNewFirst" placeholder="First name">',
      '          <input type="text" id="cciNewLast" placeholder="Last name">',
      '          <input type="tel" id="cciNewPhone" placeholder="Phone optional">',
      '          <input type="email" id="cciNewEmail" placeholder="Email optional">',
      '        </div>',
      '        <textarea id="cciNewNotes" placeholder="Notes optional"></textarea>',
      '      </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="cci-address-note">',
      '    <button type="button" class="cci-options-toggle" data-cci-toggle="cciAddressNoteBox">Add context about this address</button>',
      '    <div class="cci-person-options" id="cciAddressNoteBox">',
      '      <textarea id="cciAddressNote" placeholder="Address note optional"></textarea>',
      '    </div>',
      '  </div>',
      '  <div class="cci-actionbar">',
      '    <button type="button" class="cci-primary" id="cciSaveYes">Save &amp; Next</button>',
      '    <button type="button" class="cci-quiet-btn" id="cciCancelYes">Cancel</button>',
      '  </div>',
      '</div>',
      '<div class="cci-branch" id="cciNoBranch">',
      '  <h3>Got it.</h3>',
      '  <p class="cci-serif">This address will count as reviewed, but not yet successfully contacted.</p>',
      '  <div class="cci-no-optional-hub">',
      '    <button type="button" class="cci-options-toggle" data-cci-toggle="cciNoExtraPanel">Add optional context</button>',
      '    <div class="cci-person-options cci-no-extra-panel" id="cciNoExtraPanel">',
      '      <div class="cci-action-picker">',
      '        <button type="button" class="cci-action-card" data-cci-no-tool="cciNoOutreachTool"><strong>Log outreach attempt</strong><span>Tried to reach someone, no response.</span></button>',
      '        <button type="button" class="cci-action-card" data-cci-no-tool="cciNoUnableTool"><strong>Mark unable to reach</strong><span>Use after multiple failed attempts.</span></button>',
      '        <button type="button" class="cci-action-card" data-cci-no-tool="cciNoPersonNoteTool"><strong>Add person note</strong><span>Save context about one resident.</span></button>',
      '        <button type="button" class="cci-action-card" data-cci-no-tool="cciNoAddressNoteTool"><strong>Add address note</strong><span>Save context about this address.</span></button>',
      '      </div>',
      '      <div class="cci-action-panel" id="cciNoOutreachTool">',
      '        <h4>Log outreach attempt <span class="cci-tooltip" data-tip="An outreach attempt means you tried to reach someone, even if they did not respond.">?</span></h4>',
      '        <div class="cci-field-row">',
      '          <select id="cciOutreachPersonSelect">' + personOptionsHtml(address) + '</select>',
      '          <select id="cciNoOutreachWhen"><option value="Today">Today</option><option value="specific">Specific date</option><option value="Date unknown">I don’t remember when</option></select>',
      '        </div>',
      '        <input type="date" id="cciNoOutreachSpecificDate" class="hidden">',
      '        <textarea id="cciNoOutreachNote" placeholder="e.g. Sent email but did not receive a response"></textarea>',
      '        <div class="cci-tool-actions"><button type="button" class="cci-secondary" id="cciAddPendingOutreach">Add outreach entry</button></div>',
      '        <div class="cci-pending-list" id="cciPendingOutreachList"></div>',
      '      </div>',
      '      <div class="cci-action-panel" id="cciNoUnableTool">',
      '        <h4>Mark unable to reach</h4>',
      '        <div class="cci-check-list">' + unableCheckboxesHtml(address) + '</div>',
      '      </div>',
      '      <div class="cci-action-panel" id="cciNoPersonNoteTool">',
      '        <h4>Add person note</h4>',
      '        <div class="cci-field-row"><select id="cciNotePersonSelect">' + personOptionsHtml(address) + '</select></div>',
      '        <textarea id="cciNoPersonNoteText" placeholder="Person note optional"></textarea>',
      '        <div class="cci-tool-actions"><button type="button" class="cci-secondary" id="cciAddPendingNote">Add note</button></div>',
      '        <div class="cci-pending-list" id="cciPendingPersonNoteList"></div>',
      '      </div>',
      '      <div class="cci-action-panel" id="cciNoAddressNoteTool">',
      '        <h4>Add address note</h4>',
      '        <textarea id="cciNoAddressNote" placeholder="Address note optional"></textarea>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="cci-actionbar">',
      '    <button type="button" class="cci-primary" id="cciSaveNo">Save &amp; Next</button>',
      '    <button type="button" class="cci-quiet-btn" id="cciCancelNo">Cancel</button>',
      '  </div>',
      '</div>'
    ].join('');

    wireAddressCardEvents(address);
  }

  function wireAddressCardEvents(address) {
    var detailsBtn = document.getElementById('cciToggleOutreachDetails');
    if (detailsBtn) {
      detailsBtn.addEventListener('click', function () {
        document.getElementById('cciOutreachDetails').classList.toggle('hidden');
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-cci-toggle]'), function (btn) {
      btn.addEventListener('click', function () {
        var el = document.getElementById(btn.getAttribute('data-cci-toggle'));
        if (el) el.classList.toggle('show');
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-cci-branch]'), function (btn) {
      btn.addEventListener('click', function () {
        chooseBranch(btn.getAttribute('data-cci-branch'), btn);
      });
    });

    var skipBtn = document.querySelector('[data-cci-skip]');
    if (skipBtn) skipBtn.addEventListener('click', function () { saveSkip(address); });

    var someoneElse = document.getElementById('cciSomeoneElse');
    if (someoneElse) {
      someoneElse.addEventListener('change', function () {
        document.getElementById('cciQuickAdd').classList.toggle('show', someoneElse.checked);
      });
    }

    var saveYes = document.getElementById('cciSaveYes');
    if (saveYes) saveYes.addEventListener('click', function () { saveYesFlow(address); });
    var cancelYes = document.getElementById('cciCancelYes');
    if (cancelYes) cancelYes.addEventListener('click', renderAddressCard);

    var saveNo = document.getElementById('cciSaveNo');
    if (saveNo) saveNo.addEventListener('click', function () { saveNoFlow(address); });
    var cancelNo = document.getElementById('cciCancelNo');
    if (cancelNo) cancelNo.addEventListener('click', renderAddressCard);

    Array.prototype.forEach.call(document.querySelectorAll('[data-cci-no-tool]'), function (btn) {
      btn.addEventListener('click', function () {
        openNoTool(btn.getAttribute('data-cci-no-tool'), btn);
      });
    });

    var whenSel = document.getElementById('cciNoOutreachWhen');
    if (whenSel) {
      whenSel.addEventListener('change', function () {
        var date = document.getElementById('cciNoOutreachSpecificDate');
        if (date) date.classList.toggle('hidden', whenSel.value !== 'specific');
      });
    }

    var addOutreach = document.getElementById('cciAddPendingOutreach');
    if (addOutreach) addOutreach.addEventListener('click', function () { addPendingOutreach(address); });
    var addNote = document.getElementById('cciAddPendingNote');
    if (addNote) addNote.addEventListener('click', function () { addPendingPersonNote(address); });
  }

  function chooseBranch(branch, btn) {
    state.activeBranch = branch;
    Array.prototype.forEach.call(document.querySelectorAll('.cci-big-choice'), function (b) {
      b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
    document.getElementById('cciYesBranch').classList.toggle('show', branch === 'yes');
    document.getElementById('cciNoBranch').classList.toggle('show', branch === 'no');
  }

  function openNoTool(id, btn) {
    Array.prototype.forEach.call(document.querySelectorAll('#cciNoExtraPanel .cci-action-panel'), function (p) {
      p.classList.remove('show');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cciNoExtraPanel .cci-action-card'), function (b) {
      b.classList.remove('active');
    });
    var panel = document.getElementById(id);
    if (panel) panel.classList.add('show');
    if (btn) btn.classList.add('active');
  }

  function personNameById(address, id) {
    var r = address.residents.find(function (x) { return x.id === id; });
    return r ? r.name : 'Unknown person';
  }

  function getNoOutreachWhen() {
    var sel = document.getElementById('cciNoOutreachWhen');
    if (!sel) return 'Today';
    if (sel.value === 'specific') {
      var date = document.getElementById('cciNoOutreachSpecificDate');
      return (date && date.value) || 'Specific date';
    }
    return sel.value;
  }

  function addPendingOutreach(address) {
    var personId = document.getElementById('cciOutreachPersonSelect') && document.getElementById('cciOutreachPersonSelect').value;
    var note = document.getElementById('cciNoOutreachNote') && document.getElementById('cciNoOutreachNote').value.trim();
    var when = getNoOutreachWhen();
    if (!personId || !note) {
      toast('Choose a person and add an outreach note.');
      return;
    }
    state.pendingNoOutreach.push({ personId: personId, when: when, note: note });
    document.getElementById('cciNoOutreachNote').value = '';
    renderPendingOutreach(address);
  }

  function renderPendingOutreach(address) {
    var list = document.getElementById('cciPendingOutreachList');
    if (!list) return;
    list.innerHTML = state.pendingNoOutreach.map(function (x, i) {
      return '<div class="cci-pending-item"><strong>' + escapeHtmlLocal(personNameById(address, x.personId)) +
        '</strong> — ' + escapeHtmlLocal(x.when) + ': ' + escapeHtmlLocal(x.note) +
        ' <button type="button" class="cci-mini-link" data-cci-remove-outreach="' + i + '">remove</button></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-cci-remove-outreach]'), function (btn) {
      btn.addEventListener('click', function () {
        state.pendingNoOutreach.splice(Number(btn.getAttribute('data-cci-remove-outreach')), 1);
        renderPendingOutreach(address);
      });
    });
  }

  function addPendingPersonNote(address) {
    var personId = document.getElementById('cciNotePersonSelect') && document.getElementById('cciNotePersonSelect').value;
    var note = document.getElementById('cciNoPersonNoteText') && document.getElementById('cciNoPersonNoteText').value.trim();
    if (!personId || !note) {
      toast('Choose a person and add a note.');
      return;
    }
    state.pendingNoNotes.push({ personId: personId, note: note });
    document.getElementById('cciNoPersonNoteText').value = '';
    renderPendingPersonNotes(address);
  }

  function renderPendingPersonNotes(address) {
    var list = document.getElementById('cciPendingPersonNoteList');
    if (!list) return;
    list.innerHTML = state.pendingNoNotes.map(function (x, i) {
      return '<div class="cci-pending-item"><strong>' + escapeHtmlLocal(personNameById(address, x.personId)) +
        '</strong> — ' + escapeHtmlLocal(x.note) +
        ' <button type="button" class="cci-mini-link" data-cci-remove-note="' + i + '">remove</button></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-cci-remove-note]'), function (btn) {
      btn.addEventListener('click', function () {
        state.pendingNoNotes.splice(Number(btn.getAttribute('data-cci-remove-note')), 1);
        renderPendingPersonNotes(address);
      });
    });
  }

  function collectOptionUpdates(address, headers) {
    var updates = [];
    var wantsCol = findHeader(headers, 'Wants_Updates', ['wants_updates', 'wants updates', 'newsletter subscriber']);
    var followCol = typeof findColumn === 'function' ? findColumn(headers, ['needs', 'follow']) : null;
    var unableCol = typeof findColumn === 'function' ? findColumn(headers, ['unable', 'reach']) : null;
    var formerCol = typeof findColumn === 'function' ? findColumn(headers, ['former', 'resident'], ['note']) : null;
    var deceasedCol = typeof findColumn === 'function' ? findColumn(headers, 'deceased') : null;
    var notesCol = headers.find(function (h) { return String(h).toLowerCase().includes('person note'); });

    address.residents.forEach(function (resident) {
      if (!resident.residentId) return;
      Array.prototype.forEach.call(document.querySelectorAll('[data-cci-field][data-cci-id="' + resident.id + '"]'), function (inp) {
        var field = inp.getAttribute('data-cci-field');
        var col = null;
        if (field === 'wantsUpdates') col = wantsCol;
        if (field === 'followUp') col = followCol;
        if (field === 'unable') col = unableCol;
        if (field === 'former') col = formerCol;
        if (field === 'deceased') col = deceasedCol;
        if (!col) return;

        var wasChecked = truthySheetValue(resident.row[col]);
        var isChecked = Boolean(inp.checked);
        if (isChecked === wasChecked) return;

        updates.push({
          resident_id: resident.residentId,
          column: col,
          value: isChecked ? 'TRUE' : ''
        });
      });
      var noteEl = document.querySelector('[data-cci-note-id="' + resident.id + '"]');
      if (noteEl && notesCol && noteEl.value.trim()) {
        var existing = String(resident.row[notesCol] || '').trim();
        var next = noteEl.value.trim();
        updates.push({
          resident_id: resident.residentId,
          column: notesCol,
          value: existing ? (existing + '\n' + next) : next
        });
      }
    });
    return updates;
  }

  function findAddressNotesColumn(headers) {
    return (headers || []).find(function (h) {
      var lower = String(h).toLowerCase();
      return lower.includes('address note') || lower === 'address notes';
    }) || null;
  }

  async function appendQuickAddResident(address, headers, options) {
    options = options || {};
    var addressNote = options.addressNote ? String(options.addressNote).trim() : '';
    var first = (document.getElementById('cciNewFirst') && document.getElementById('cciNewFirst').value.trim()) || '';
    var last = (document.getElementById('cciNewLast') && document.getElementById('cciNewLast').value.trim()) || '';
    var phone = (document.getElementById('cciNewPhone') && document.getElementById('cciNewPhone').value.trim()) || '';
    var email = (document.getElementById('cciNewEmail') && document.getElementById('cciNewEmail').value.trim()) || '';
    var notes = (document.getElementById('cciNewNotes') && document.getElementById('cciNewNotes').value.trim()) || '';
    if (!first && !last) {
      throw new Error('Add a name for the new person, or uncheck Someone else.');
    }

    var valuesByColumn = {};
    if (typeof copyAddRecordAddressFields === 'function') {
      var addressFieldCols = typeof getAddRecordAddressInheritanceColumns === 'function'
        ? getAddRecordAddressInheritanceColumns(headers)
        : [];
      copyAddRecordAddressFields(address.rows, valuesByColumn, addressFieldCols);
    }

    if (typeof applyAddRecordZoneDefaults === 'function' && typeof getAddRecordZoneDefaults === 'function') {
      applyAddRecordZoneDefaults(valuesByColumn, getAddRecordZoneDefaults(headers));
    }

    var fullName = [first, last].filter(Boolean).join(' ');
    if (typeof applyAddRecordPersonName === 'function') {
      var nameColumns = {
        nameCol: typeof getResidentNameColumn === 'function' ? getResidentNameColumn(headers) : null,
        firstNameCol: findHeader(headers, 'First Name', ['first name']),
        middleNameCol: findHeader(headers, 'Middle Name', ['middle name']),
        lastNameCol: findHeader(headers, 'Last Name', ['last name'])
      };
      applyAddRecordPersonName(valuesByColumn, fullName, nameColumns);
    } else {
      var nameCol = typeof getResidentNameColumn === 'function' ? getResidentNameColumn(headers) : null;
      if (nameCol) valuesByColumn[nameCol] = fullName;
    }

    var cellCol = headers.find(function (h) { return /cell|mobile/i.test(h); });
    var emailCol = headers.find(function (h) { return /email/i.test(h) && !/nc/i.test(h); });
    var notesCol = headers.find(function (h) { return String(h).toLowerCase().includes('person note'); });
    if (cellCol && phone) valuesByColumn[cellCol] = phone;
    if (emailCol && email) valuesByColumn[emailCol] = email;
    if (notesCol && notes) valuesByColumn[notesCol] = notes;

    // Address notes are address-level: bake this save's note into the new row
    // (inheritance may already copy older notes; append the new one if needed).
    var addressNotesCol = findAddressNotesColumn(headers);
    if (addressNotesCol && addressNote) {
      var inherited = String(valuesByColumn[addressNotesCol] || '').trim();
      if (!inherited) {
        valuesByColumn[addressNotesCol] = addressNote;
      } else if (inherited.indexOf(addressNote) === -1) {
        valuesByColumn[addressNotesCol] = inherited + '\n' + addressNote;
      }
    }

    if (typeof ensureResidentIdAndApn === 'function') ensureResidentIdAndApn(headers, valuesByColumn);
    if (typeof ensureAddressId === 'function') {
      ensureAddressId(headers, valuesByColumn, { existingRows: address.rows });
    } else if (headers.includes('address_id') && address.id && address.id.indexOf('legacy__') !== 0) {
      valuesByColumn.address_id = address.id;
    }

    var contactCol = findHeader(headers, SUCCESSFULLY_CONTACTED_HEADER, ['successfully contacted']);
    if (contactCol) valuesByColumn[contactCol] = 'TRUE';

    var row = typeof buildRowForHeaders === 'function'
      ? buildRowForHeaders(headers, valuesByColumn)
      : headers.map(function (h) { return valuesByColumn[h] != null ? String(valuesByColumn[h]) : ''; });

    if (typeof appendRowsToSheet !== 'function') throw new Error('Add Record is unavailable');
    await appendRowsToSheet([row]);

    // Register the new person in the in-memory sheet data so the Neighbors
    // tab, Map, and this wizard reflect them without a full reload.
    var sheet = getSheetData();
    if (sheet && Array.isArray(sheet.data)) {
      var localRow = {};
      headers.forEach(function (h) {
        localRow[h] = valuesByColumn[h] != null ? String(valuesByColumn[h]) : '';
      });
      localRow.__originalIndex = sheet.data.length;
      sheet.data.push(localRow);
      if (sheet.addressMap && sheet.addressMap.get(address.displayAddress)) {
        sheet.addressMap.get(address.displayAddress).push(localRow);
      }
      address.rows.push(localRow);
    }
    return valuesByColumn.resident_id || '';
  }

  async function saveYesFlow(address) {
    if (state.saving) return;
    var headers = (getSheetData() && getSheetData().headers) ? getSheetData().headers : [];
    var selected = Array.prototype.map.call(document.querySelectorAll('.cci-contact-check:checked'), function (el) {
      return el.value;
    });
    var someoneElse = document.getElementById('cciSomeoneElse') && document.getElementById('cciSomeoneElse').checked;
    if (!selected.length && !someoneElse) {
      toast('Select at least one person, or choose No / Skip.');
      return;
    }

    state.saving = true;
    setSaveBusy(true);
    try {
      var updates = [];
      var contactCol = findHeader(headers, SUCCESSFULLY_CONTACTED_HEADER, ['successfully contacted']);
      if (contactCol) {
        address.residents.forEach(function (resident) {
          if (selected.indexOf(resident.id) === -1) return;
          if (!resident.residentId) return;
          updates.push({
            resident_id: resident.residentId,
            column: contactCol,
            value: 'TRUE'
          });
          resident.contacted = true;
        });
      }

      updates = updates.concat(collectOptionUpdates(address, headers));

      var addressNote = document.getElementById('cciAddressNote') && document.getElementById('cciAddressNote').value.trim();
      var addressNotesCol = findAddressNotesColumn(headers);
      if (addressNote && addressNotesCol) {
        // Write onto existing residents at this address
        address.residents.forEach(function (resident) {
          if (!resident.residentId) return;
          var existing = String(resident.row[addressNotesCol] || '').trim();
          updates.push({
            resident_id: resident.residentId,
            column: addressNotesCol,
            value: existing ? (existing + '\n' + addressNote) : addressNote
          });
        });
      }

      // Quick-add after collecting existing-resident updates, and pass the
      // address note so the new row gets it on create (not only via later update).
      if (someoneElse) {
        await appendQuickAddResident(address, headers, { addressNote: addressNote || '' });
      }

      var prevSummary = computeLocalSummary();
      await batchUpdateResidentFields(updates);
      await saveReviewRecord(address.id, 'reviewed', 'yes_successful_contact');
      applyLocalRowUpdates(address, updates);
      celebrateOrToast(address, prevSummary, YES_NUDGES);
      await afterSaveAdvance();
      scheduleLinkedViewsRefresh(address);
    } catch (err) {
      console.error(err);
      showCciError(err.message || 'Could not save Check-In answer.');
    } finally {
      state.saving = false;
      setSaveBusy(false);
    }
  }

  async function saveNoFlow(address) {
    if (state.saving) return;
    var headers = (getSheetData() && getSheetData().headers) ? getSheetData().headers : [];
    state.saving = true;
    setSaveBusy(true);
    try {
      var updates = [];
      var unableCol = typeof findColumn === 'function' ? findColumn(headers, ['unable', 'reach']) : null;
      var notesCol = headers.find(function (h) { return String(h).toLowerCase().includes('person note'); });
      var outreachDateCol = typeof findOutreachDateColumn === 'function' ? findOutreachDateColumn(headers) : null;
      var outreachLogCol = typeof findOutreachLogColumn === 'function' ? findOutreachLogColumn(headers) : null;
      var todayLabel = typeof getTodayOutreachLabel === 'function' ? getTodayOutreachLabel() : new Date().toLocaleDateString();

      Array.prototype.forEach.call(document.querySelectorAll('[data-cci-unable-id]'), function (inp) {
        if (!inp.checked || !unableCol) return;
        var resident = address.residents.find(function (r) { return r.id === inp.getAttribute('data-cci-unable-id'); });
        if (!resident || !resident.residentId) return;
        updates.push({
          resident_id: resident.residentId,
          column: unableCol,
          value: 'TRUE'
        });
      });

      state.pendingNoOutreach.forEach(function (entry) {
        var resident = address.residents.find(function (r) { return r.id === entry.personId; });
        if (!resident || !resident.residentId) return;
        var whenLabel = entry.when === 'Today' ? todayLabel : entry.when;
        if (outreachDateCol) {
          updates.push({
            resident_id: resident.residentId,
            column: outreachDateCol,
            value: whenLabel
          });
        }
        if (outreachLogCol) {
          var existingLog = String(resident.row[outreachLogCol] || '').trim();
          var prefix = entry.when === 'Date unknown' ? '[Date unknown]' : '[' + whenLabel + ']';
          var nextLog = prefix + ' ' + entry.note + (existingLog ? '\n' + existingLog : '');
          updates.push({
            resident_id: resident.residentId,
            column: outreachLogCol,
            value: nextLog
          });
        }
      });

      state.pendingNoNotes.forEach(function (entry) {
        var resident = address.residents.find(function (r) { return r.id === entry.personId; });
        if (!resident || !resident.residentId || !notesCol) return;
        var existing = String(resident.row[notesCol] || '').trim();
        updates.push({
          resident_id: resident.residentId,
          column: notesCol,
          value: existing ? (existing + '\n' + entry.note) : entry.note
        });
      });

      var addressNote = document.getElementById('cciNoAddressNote') && document.getElementById('cciNoAddressNote').value.trim();
      var addressNotesCol = findAddressNotesColumn(headers);
      if (addressNote && addressNotesCol) {
        address.residents.forEach(function (resident) {
          if (!resident.residentId) return;
          var existing = String(resident.row[addressNotesCol] || '').trim();
          updates.push({
            resident_id: resident.residentId,
            column: addressNotesCol,
            value: existing ? (existing + '\n' + addressNote) : addressNote
          });
        });
      }

      var prevSummary = computeLocalSummary();
      await batchUpdateResidentFields(updates);
      await saveReviewRecord(address.id, 'reviewed', 'no_successful_contact');
      applyLocalRowUpdates(address, updates);
      celebrateOrToast(address, prevSummary, NO_NUDGES);
      await afterSaveAdvance();
      scheduleLinkedViewsRefresh(address);
    } catch (err) {
      console.error(err);
      showCciError(err.message || 'Could not save Check-In answer.');
    } finally {
      state.saving = false;
      setSaveBusy(false);
    }
  }

  async function saveSkip(address) {
    if (state.saving) return;
    state.saving = true;
    setSaveBusy(true);
    try {
      await saveReviewRecord(address.id, 'skipped', '');
      showCciNudge({ title: 'Skipped for now', message: 'This address stays in your queue.', duration: 2600 });
      await afterSaveAdvance();
    } catch (err) {
      console.error(err);
      showCciError(err.message || 'Could not skip address.');
    } finally {
      state.saving = false;
      setSaveBusy(false);
    }
  }

  async function afterSaveAdvance() {
    // Keep the in-memory queue; full sheet reload mid-wizard is too heavy.
    renderHomeWidget();
    var next = findNextIndex(state.currentIndex, state.reviewSkippedOnly);
    if (next < 0) {
      showComplete();
      return;
    }
    state.currentIndex = next;
    renderAddressCard();
  }

  function updateModalProgress(summary) {
    summary = summary || computeLocalSummary();
    var bar = document.getElementById('cciModalProgressBar');
    var text = document.getElementById('cciModalProgressText');
    if (bar) bar.style.width = summary.percentReviewed + '%';
    if (text) text.textContent = summary.reviewed + ' / ' + summary.total;
    return summary;
  }

  function showComplete() {
    var card = document.getElementById('cciAddressCard');
    if (!card) return;
    var summary = updateModalProgress();
    card.innerHTML = [
      '<h2 class="cci-address-title">Nice work — you\'re caught up.</h2>',
      '<p class="cci-serif">You can close this and come back anytime. Skipped addresses stay available to review.</p>',
      '<div class="cci-mini-stats">',
      '  <div class="cci-mini-stat"><strong>' + summary.reviewed + '</strong><span>Reviewed</span></div>',
      '  <div class="cci-mini-stat"><strong>' + summary.reached + '</strong><span>Reached</span></div>',
      '  <div class="cci-mini-stat"><strong>' + summary.skipped + '</strong><span>Skipped</span></div>',
      '  <div class="cci-mini-stat"><strong>' + summary.total + '</strong><span>Addresses</span></div>',
      '</div>',
      '<div class="cci-actionbar">',
      '  <button type="button" class="cci-primary" id="cciReturnHome">Return home</button>',
      summary.skipped > 0 ? '<button type="button" class="cci-secondary" id="cciReviewSkippedDone">Review skipped addresses</button>' : '',
      '</div>'
    ].join('');
    var homeBtn = document.getElementById('cciReturnHome');
    if (homeBtn) homeBtn.addEventListener('click', closeWizard);
    var skippedBtn = document.getElementById('cciReviewSkippedDone');
    if (skippedBtn) {
      skippedBtn.addEventListener('click', function () {
        state.reviewSkippedOnly = true;
        state.currentIndex = findNextIndex(-1, true);
        if (state.currentIndex < 0) {
          toast('No skipped addresses left.');
          return;
        }
        renderAddressCard();
      });
    }
  }

  async function refreshContactCheckIn(nextContext) {
    if (nextContext) setContext(nextContext);
    ensureDom();
    state.queue = buildQueueFromSheet();
    await loadReviews();
    renderHomeWidget();
    await loadCommunityFeed();
  }

  global.refreshContactCheckIn = refreshContactCheckIn;
  global.openContactCheckIn = function () { openWizard(false); };
  global.setContactCheckInContext = setContext;
})(typeof window !== 'undefined' ? window : globalThis);
