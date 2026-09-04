/**
 * Main-map helpers for the LA County parcel overlay.
 *
 * The browser API is exposed as `MainMapHelpers`; the same helpers are
 * CommonJS-exported so the request and concurrency behavior can be tested
 * without Leaflet or a DOM.
 */
(function (global) {
  'use strict';

  var PARCEL_ENDPOINT =
    'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0';
  var PARCEL_MIN_ZOOM = 17;
  var DEFAULT_BATCH_SIZE = 250;
  var DEFAULT_CACHE_SIZE = 3000;
  var DEFAULT_BATCH_CONCURRENCY = 3;

  function applyCartoKey(style, key) {
    var trimmedKey = String(key || '').trim();
    if (!trimmedKey || !style || !style.sources || !style.sources.carto ||
        !style.sources.carto.url) return style;
    var sourceUrl = new URL(style.sources.carto.url);
    sourceUrl.searchParams.set('key', trimmedKey);
    sourceUrl.searchParams.delete('api_key');
    style.sources.carto.url = sourceUrl.toString();
    return style;
  }

  function createBasemapFailureMonitor(options) {
    options = options || {};
    var threshold = Math.max(2, Number(options.threshold) || 3);
    var windowMs = Math.max(250, Number(options.windowMs) || 5000);
    var dedupeMs = Math.max(0, Number(options.dedupeMs) || 750);
    var now = options.now || Date.now;
    var onFallback = options.onFallback;
    var errorTimes = [];
    var lastSignature = '';
    var lastSignatureAt = -Infinity;
    var tripped = false;

    function fallback(reason) {
      if (tripped) return false;
      tripped = true;
      if (typeof onFallback === 'function') onFallback(reason);
      return true;
    }

    function recordError(error) {
      if (tripped) return false;
      var time = Number(now());
      var signature = String(error && error.message || error || 'MapLibre error');
      if (signature === lastSignature && time - lastSignatureAt <= dedupeMs) return false;
      lastSignature = signature;
      lastSignatureAt = time;
      errorTimes = errorTimes.filter(function (value) { return time - value <= windowMs; });
      errorTimes.push(time);
      if (errorTimes.length >= threshold) return fallback(error);
      return false;
    }

    return {
      recordError: recordError,
      recordContextLoss: function (error) {
        return fallback(error || new Error('WebGL context lost'));
      },
      reset: function () {
        errorTimes = [];
        lastSignature = '';
        lastSignatureAt = -Infinity;
        tripped = false;
      },
      isTripped: function () { return tripped; }
    };
  }

  function canApplyBasemapFallback(state) {
    state = state || {};
    return state.generation === state.currentGeneration &&
      state.isSatellite !== true &&
      state.layerActive === true &&
      state.fallbackActive !== true;
  }

  function normalizeBounds(bounds) {
    if (!bounds) throw new TypeError('bounds are required');
    var normalized;
    if (typeof bounds.getWest === 'function') {
      normalized = {
        west: Number(bounds.getWest()),
        south: Number(bounds.getSouth()),
        east: Number(bounds.getEast()),
        north: Number(bounds.getNorth())
      };
    } else {
      normalized = {
        west: Number(bounds.west),
        south: Number(bounds.south),
        east: Number(bounds.east),
        north: Number(bounds.north)
      };
    }
    if (!Object.values(normalized).every(Number.isFinite) ||
        normalized.west > normalized.east || normalized.south > normalized.north) {
      throw new TypeError('bounds must be a finite west/south/east/north envelope');
    }
    return normalized;
  }

  function buildQueryUrl(endpoint, params) {
    var url = new URL(String(endpoint || PARCEL_ENDPOINT).replace(/\/+$/, '') + '/query');
    Object.keys(params).forEach(function (key) {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.set(key, String(params[key]));
      }
    });
    return url.toString();
  }

  function buildParcelIdQueryUrl(bounds, endpoint) {
    var b = normalizeBounds(bounds);
    return buildQueryUrl(endpoint, {
      f: 'json',
      where: '1=1',
      geometry: [b.west, b.south, b.east, b.north].join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      returnIdsOnly: true,
      returnGeometry: false
    });
  }

  function dedupeObjectIds(ids) {
    var seen = new Set();
    return (Array.isArray(ids) ? ids : []).reduce(function (result, value) {
      var id = Number(value);
      if (!Number.isInteger(id) || id < 0 || seen.has(id)) return result;
      seen.add(id);
      result.push(id);
      return result;
    }, []);
  }

  function batchObjectIds(ids, batchSize) {
    var unique = dedupeObjectIds(ids);
    var size = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
    var batches = [];
    for (var i = 0; i < unique.length; i += size) {
      batches.push(unique.slice(i, i + size));
    }
    return batches;
  }

  function buildParcelFeatureQueryUrl(ids, endpoint) {
    var objectIds = dedupeObjectIds(ids);
    return buildQueryUrl(endpoint, {
      f: 'geojson',
      objectIds: objectIds.join(','),
      outFields: 'OBJECTID',
      returnGeometry: true,
      outSR: 4326
    });
  }

  function shouldLoadParcels(options) {
    options = options || {};
    return Number(options.zoom) >= PARCEL_MIN_ZOOM &&
      options.visible !== false &&
      options.mapVisible !== false;
  }

  function getParcelLineStyle(zoom) {
    var z = Math.max(PARCEL_MIN_ZOOM, Math.min(20, Number(zoom) || PARCEL_MIN_ZOOM));
    var progress = (z - PARCEL_MIN_ZOOM) / 3;
    return {
      color: '#766F65',
      opacity: 0.22 + (0.06 * progress),
      weight: 0.45 + (0.25 * progress),
      fill: false,
      fillOpacity: 0,
      lineCap: 'round',
      lineJoin: 'round'
    };
  }

  async function runWithConcurrency(items, limit, worker) {
    var values = Array.isArray(items) ? items : [];
    var results = new Array(values.length);
    var nextIndex = 0;
    var workerCount = Math.min(
      values.length,
      Math.max(1, Number(limit) || DEFAULT_BATCH_CONCURRENCY)
    );

    async function runWorker() {
      while (nextIndex < values.length) {
        var index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = { status: 'fulfilled', value: await worker(values[index], index) };
        } catch (error) {
          results[index] = { status: 'rejected', reason: error };
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results;
  }

  function createParcelViewportLoader(options) {
    options = options || {};
    var fetchFn = options.fetchFn || global.fetch;
    if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is required');
    var endpoint = options.endpoint || PARCEL_ENDPOINT;
    var batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    var cacheSize = options.cacheSize || DEFAULT_CACHE_SIZE;
    var batchConcurrency = options.batchConcurrency || DEFAULT_BATCH_CONCURRENCY;
    var cache = new Map();
    var generation = 0;
    var activeController = null;

    function abort() {
      generation += 1;
      if (activeController) activeController.abort();
      activeController = null;
    }

    function remember(feature) {
      var rawId = feature && feature.properties && feature.properties.OBJECTID;
      var id = Number(rawId);
      if (!Number.isInteger(id)) return;
      if (cache.has(id)) cache.delete(id);
      cache.set(id, feature);
      while (cache.size > cacheSize) {
        cache.delete(cache.keys().next().value);
      }
    }

    async function fetchJson(url, signal) {
      var response = await fetchFn(url, { signal: signal, cache: 'no-store' });
      if (!response || !response.ok) {
        throw new Error('Parcel service request failed' +
          (response && response.status ? ' (' + response.status + ')' : ''));
      }
      var payload = await response.json();
      if (payload && payload.error) {
        throw new Error(payload.error.message || 'Parcel service returned an error');
      }
      return payload;
    }

    async function load(request) {
      request = request || {};
      abort();
      if (!shouldLoadParcels(request)) {
        if (typeof request.onFeatures === 'function') {
          request.onFeatures({ type: 'FeatureCollection', features: [] });
        }
        return { skipped: true, features: [], failures: [] };
      }

      var myGeneration = generation;
      activeController = new AbortController();
      var signal = activeController.signal;

      try {
        var idPayload = await fetchJson(
          buildParcelIdQueryUrl(request.bounds, endpoint),
          signal
        );
        if (myGeneration !== generation || signal.aborted) return { stale: true };

        var ids = dedupeObjectIds(idPayload && idPayload.objectIds);
        var requestedIdSet = new Set(ids);
        var currentFeatures = new Map();
        ids.forEach(function (id) {
          if (cache.has(id)) currentFeatures.set(id, cache.get(id));
        });
        var missingIds = ids.filter(function (id) { return !cache.has(id); });
        var batches = batchObjectIds(missingIds, batchSize);
        var settled = await runWithConcurrency(batches, batchConcurrency, async function (batch) {
          if (myGeneration !== generation || signal.aborted) return [];
          var geojson = await fetchJson(buildParcelFeatureQueryUrl(batch, endpoint), signal);
          if (myGeneration !== generation || signal.aborted) return [];
          var features = Array.isArray(geojson && geojson.features) ? geojson.features : [];
          features.forEach(function (feature) {
            var id = Number(feature && feature.properties && feature.properties.OBJECTID);
            if (!Number.isInteger(id) || !requestedIdSet.has(id)) return;
            currentFeatures.set(id, feature);
            remember(feature);
          });
          return features;
        });

        if (myGeneration !== generation || signal.aborted) return { stale: true };
        var failures = settled
          .filter(function (result) { return result.status === 'rejected'; })
          .map(function (result) { return result.reason; });
        var features = ids.map(function (id) { return currentFeatures.get(id); }).filter(Boolean);
        var collection = { type: 'FeatureCollection', features: features };
        if (typeof request.onFeatures === 'function') request.onFeatures(collection);
        if (failures.length && typeof request.onFailure === 'function') {
          request.onFailure(failures);
        }
        return { features: features, failures: failures };
      } catch (error) {
        if (myGeneration !== generation || signal.aborted ||
            (error && error.name === 'AbortError')) {
          return { stale: true };
        }
        if (typeof request.onFailure === 'function') request.onFailure([error]);
        return { features: [], failures: [error] };
      } finally {
        if (myGeneration === generation) activeController = null;
      }
    }

    return {
      load: load,
      abort: abort,
      clearCache: function () { cache.clear(); },
      getCacheSize: function () { return cache.size; }
    };
  }

  var api = {
    PARCEL_ENDPOINT: PARCEL_ENDPOINT,
    PARCEL_MIN_ZOOM: PARCEL_MIN_ZOOM,
    applyCartoKey: applyCartoKey,
    createBasemapFailureMonitor: createBasemapFailureMonitor,
    canApplyBasemapFallback: canApplyBasemapFallback,
    normalizeBounds: normalizeBounds,
    buildParcelIdQueryUrl: buildParcelIdQueryUrl,
    buildParcelFeatureQueryUrl: buildParcelFeatureQueryUrl,
    dedupeObjectIds: dedupeObjectIds,
    batchObjectIds: batchObjectIds,
    shouldLoadParcels: shouldLoadParcels,
    getParcelLineStyle: getParcelLineStyle,
    runWithConcurrency: runWithConcurrency,
    createParcelViewportLoader: createParcelViewportLoader
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MainMapHelpers = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
