'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PARCEL_ENDPOINT,
  PARCEL_MIN_ZOOM,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_REQUEST_URL_LENGTH,
  DEFAULT_CACHE_SIZE,
  applyCartoKey,
  createBasemapFailureMonitor,
  canApplyBasemapFallback,
  buildParcelIdQueryUrl,
  buildParcelFeatureQueryUrl,
  dedupeObjectIds,
  batchObjectIds,
  batchObjectIdsForGet,
  shouldLoadParcels,
  getParcelLineStyle,
  runWithConcurrency,
  createParcelViewportLoader
} = require('../public/js/main-map');

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload
  };
}

function feature(id) {
  return { type: 'Feature', properties: { OBJECTID: id }, geometry: null };
}

const validRequest = {
  bounds: { west: -118.16, south: 34.18, east: -118.14, north: 34.20 },
  zoom: 17,
  visible: true,
  mapVisible: true
};

test('builds an ArcGIS envelope ID query in WGS84', () => {
  const url = new URL(buildParcelIdQueryUrl({
    west: -118.16,
    south: 34.18,
    east: -118.14,
    north: 34.20
  }));
  assert.equal(url.origin + url.pathname, PARCEL_ENDPOINT + '/query');
  assert.equal(url.searchParams.get('geometry'), '-118.16,34.18,-118.14,34.2');
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('returnIdsOnly'), 'true');
  assert.equal(url.searchParams.get('returnGeometry'), 'false');
});

test('builds a minimal GeoJSON object-ID query', () => {
  const url = new URL(buildParcelFeatureQueryUrl([7, 7, 3]));
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('objectIds'), '7,3');
  assert.equal(url.searchParams.get('outFields'), 'OBJECTID');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('returnGeometry'), 'true');
});

test('applies CARTO credentials with the supported key parameter', () => {
  const style = {
    sources: {
      carto: { url: 'https://tiles.example.test/tiles.json?api_key=wrong&lang=en' }
    }
  };
  applyCartoKey(style, ' carto-secret ');
  const url = new URL(style.sources.carto.url);
  assert.equal(url.searchParams.get('key'), 'carto-secret');
  assert.equal(url.searchParams.has('api_key'), false);
  assert.equal(url.searchParams.get('lang'), 'en');
});

test('post-load failure monitor ignores isolated errors and trips on a burst', () => {
  let time = 0;
  const fallbacks = [];
  const monitor = createBasemapFailureMonitor({
    threshold: 3,
    windowMs: 5000,
    now: () => time,
    onFallback: (error) => fallbacks.push(error.message)
  });
  monitor.recordError(new Error('one tile'));
  time = 100;
  monitor.recordError(new Error('one tile'));
  time = 5100;
  monitor.recordError(new Error('later tile'));
  time = 5200;
  monitor.recordError(new Error('second in burst'));
  assert.deepEqual(fallbacks, []);
  time = 5300;
  monitor.recordError(new Error('third in burst'));
  assert.deepEqual(fallbacks, ['third in burst']);
  monitor.recordError(new Error('ignored after trip'));
  assert.equal(fallbacks.length, 1);
});

test('context loss is fatal and fallback guard rejects stale or Satellite state', () => {
  let fallbackCount = 0;
  const monitor = createBasemapFailureMonitor({
    onFallback: () => { fallbackCount += 1; }
  });
  assert.equal(monitor.recordContextLoss(), true);
  assert.equal(fallbackCount, 1);
  assert.equal(canApplyBasemapFallback({
    generation: 4, currentGeneration: 4, isSatellite: false,
    layerActive: true, fallbackActive: false
  }), true);
  assert.equal(canApplyBasemapFallback({
    generation: 3, currentGeneration: 4, isSatellite: false,
    layerActive: true, fallbackActive: false
  }), false);
  assert.equal(canApplyBasemapFallback({
    generation: 4, currentGeneration: 4, isSatellite: true,
    layerActive: true, fallbackActive: false
  }), false);
});

test('deduplicates and batches valid object IDs', () => {
  assert.deepEqual(dedupeObjectIds([2, '2', 3, -1, 'bad', 4]), [2, 3, 4]);
  assert.deepEqual(batchObjectIds([1, 2, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const ids = Array.from({ length: 501 }, (_, index) => index + 1);
  const batches = batchObjectIds([...ids, ...ids, 'bad', -1], 250);
  assert.deepEqual(batches.map((batch) => batch.length), [250, 250, 1]);
  assert.deepEqual(batches.flat(), ids);
});

test('GET batches of realistic IDs stay within the ArcGIS URL bound', () => {
  const ids = Array.from({ length: 6800 }, (_, index) => 7000000 + index);
  const batches = batchObjectIdsForGet(ids);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.length <= DEFAULT_BATCH_SIZE));
  assert.ok(batches.every((batch) =>
    buildParcelFeatureQueryUrl(batch).length < DEFAULT_MAX_REQUEST_URL_LENGTH));
  assert.deepEqual(batches.flat(), ids);
});

test('gates parcel loading by zoom and visibility', () => {
  assert.equal(PARCEL_MIN_ZOOM, 17);
  assert.equal(shouldLoadParcels({ zoom: 16, visible: true, mapVisible: true }), false);
  assert.equal(shouldLoadParcels({ zoom: 17, visible: true, mapVisible: true }), true);
  assert.equal(shouldLoadParcels({ zoom: 18, visible: false, mapVisible: true }), false);
  assert.equal(shouldLoadParcels({ zoom: 18, visible: true, mapVisible: false }), false);
});

test('loader gating performs zero fetches and publishes an empty collection', async () => {
  let fetchCount = 0;
  let published;
  const loader = createParcelViewportLoader({
    fetchFn: async () => {
      fetchCount += 1;
      throw new Error('must not fetch');
    }
  });
  const result = await loader.load({
    ...validRequest,
    zoom: 16,
    onFeatures: (collection) => { published = collection; }
  });
  assert.equal(result.skipped, true);
  assert.equal(fetchCount, 0);
  assert.deepEqual(published, { type: 'FeatureCollection', features: [] });
});

test('concurrency runner never exceeds its limit and preserves result order', async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 2 : 0));
    active -= 1;
    return value * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results.map((result) => result.value), [10, 20, 30, 40, 50, 60]);
});

test('parcel style is solid, subtle, and has no fill', () => {
  for (const zoom of [17, 18, 19, 20]) {
    const style = getParcelLineStyle(zoom);
    assert.equal(style.color, '#766F65');
    assert.equal(style.fill, false);
    assert.equal(style.fillOpacity, 0);
    assert.equal(Object.hasOwn(style, 'dashArray'), false);
    assert.ok(style.opacity >= 0.175 && style.opacity <= 0.28);
    assert.ok(style.weight >= 0.4375 && style.weight <= 0.70);
  }
  assert.deepEqual(
    { opacity: getParcelLineStyle(17).opacity, weight: getParcelLineStyle(17).weight },
    { opacity: 0.175, weight: 0.4375 }
  );
  assert.deepEqual(
    { opacity: getParcelLineStyle(20).opacity, weight: getParcelLineStyle(20).weight },
    { opacity: 0.28, weight: 0.70 }
  );
});

test('a stale generation cannot publish features', async () => {
  let resolveFirstIds;
  const published = [];
  const fetchFn = (url) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get('returnIdsOnly') === 'true') {
      if (!resolveFirstIds) {
        return new Promise((resolve) => { resolveFirstIds = resolve; });
      }
      return Promise.resolve(response({ objectIds: [2] }));
    }
    const id = Number(parsed.searchParams.get('objectIds'));
    return Promise.resolve(response({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { OBJECTID: id }, geometry: null }]
    }));
  };
  const loader = createParcelViewportLoader({ fetchFn });
  const first = loader.load({
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    zoom: 17,
    onFeatures: (fc) => published.push(fc)
  });
  const second = loader.load({
    bounds: { west: 1, south: 1, east: 2, north: 2 },
    zoom: 17,
    onFeatures: (fc) => published.push(fc)
  });
  resolveFirstIds(response({ objectIds: [1] }));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.features[0].properties.OBJECTID, 2);
  assert.equal(published.length, 1);
  assert.equal(published[0].features[0].properties.OBJECTID, 2);
});

test('abort cancels the active generation without reporting a failure', async () => {
  let published = false;
  let failed = false;
  const loader = createParcelViewportLoader({
    fetchFn: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })
  });
  const pending = loader.load({
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    zoom: 17,
    onFeatures: () => { published = true; },
    onFailure: () => { failed = true; }
  });
  loader.abort();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(published, false);
  assert.equal(failed, false);
});

test('one failed feature batch does not discard successful batches', async () => {
  const failures = [];
  const loader = createParcelViewportLoader({
    batchSize: 2,
    fetchFn: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('returnIdsOnly') === 'true') {
        return response({ objectIds: [1, 2, 3, 4] });
      }
      const ids = parsed.searchParams.get('objectIds');
      if (ids === '3,4') return response({}, false, 503);
      return response({
        type: 'FeatureCollection',
        features: ids.split(',').map((id) => ({
          type: 'Feature',
          properties: { OBJECTID: Number(id) },
          geometry: null
        }))
      });
    }
  });
  const result = await loader.load({
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    zoom: 17,
    onFailure: (errors) => failures.push(...errors)
  });
  assert.deepEqual(result.features.map((f) => f.properties.OBJECTID), [1, 2]);
  assert.equal(result.failures.length, 1);
  assert.equal(failures.length, 1);
});

test('current viewport retains all features when the reuse cache evicts entries', async () => {
  const ids = Array.from({ length: 3001 }, (_, index) => index + 1);
  const loader = createParcelViewportLoader({
    cacheSize: 3000,
    fetchFn: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('returnIdsOnly') === 'true') {
        return response({ objectIds: ids });
      }
      return response({
        type: 'FeatureCollection',
        features: parsed.searchParams.get('objectIds').split(',').map(Number).map(feature)
      });
    }
  });
  const result = await loader.load(validRequest);
  assert.equal(result.features.length, 3001);
  assert.deepEqual(result.features.map((item) => item.properties.OBJECTID), ids);
  assert.equal(loader.getCacheSize(), 3000);
});

test('large z17 viewport renders completely and fits the default reuse cache', async () => {
  const ids = Array.from({ length: 6800 }, (_, index) => 7000000 + index);
  const featureUrls = [];
  const loader = createParcelViewportLoader({
    fetchFn: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('returnIdsOnly') === 'true') {
        return response({ objectIds: ids });
      }
      featureUrls.push(url);
      return response({
        type: 'FeatureCollection',
        features: parsed.searchParams.get('objectIds').split(',').map(Number).map(feature)
      });
    }
  });
  const result = await loader.load(validRequest);
  assert.equal(result.features.length, 6800);
  assert.deepEqual(result.features.map((item) => item.properties.OBJECTID), ids);
  assert.equal(loader.getCacheSize(), 6800);
  assert.ok(DEFAULT_CACHE_SIZE >= 6800);
  assert.ok(featureUrls.every((url) => url.length < DEFAULT_MAX_REQUEST_URL_LENGTH));
});

test('parcel loader caps configured geometry concurrency at three', async () => {
  let active = 0;
  let peak = 0;
  const loader = createParcelViewportLoader({
    batchSize: 1,
    batchConcurrency: 9,
    fetchFn: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('returnIdsOnly') === 'true') {
        return response({ objectIds: [1, 2, 3, 4, 5, 6] });
      }
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return response({
        type: 'FeatureCollection',
        features: [feature(Number(parsed.searchParams.get('objectIds')))]
      });
    }
  });
  const result = await loader.load(validRequest);
  assert.equal(result.features.length, 6);
  assert.equal(peak, 3);
});

test('a deferred stale feature response cannot publish or enter reuse cache', async () => {
  let idRequestCount = 0;
  let objectOneFetchCount = 0;
  let resolveOldFeature;
  let markOldStarted;
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve; });
  const published = [];
  const loader = createParcelViewportLoader({
    fetchFn: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('returnIdsOnly') === 'true') {
        idRequestCount += 1;
        return response({ objectIds: [idRequestCount === 2 ? 2 : 1] });
      }
      const id = Number(parsed.searchParams.get('objectIds'));
      if (id === 1) {
        objectOneFetchCount += 1;
        if (objectOneFetchCount === 1) {
          markOldStarted();
          return new Promise((resolve) => { resolveOldFeature = resolve; });
        }
      }
      return response({ type: 'FeatureCollection', features: [feature(id)] });
    }
  });

  const first = loader.load({ ...validRequest, onFeatures: (fc) => published.push(fc) });
  await oldStarted;
  const second = await loader.load({ ...validRequest, onFeatures: (fc) => published.push(fc) });
  resolveOldFeature(response({ type: 'FeatureCollection', features: [feature(1)] }));
  const firstResult = await first;
  const third = await loader.load({ ...validRequest, onFeatures: (fc) => published.push(fc) });

  assert.equal(firstResult.stale, true);
  assert.equal(second.features[0].properties.OBJECTID, 2);
  assert.equal(third.features[0].properties.OBJECTID, 1);
  assert.equal(objectOneFetchCount, 2);
  assert.deepEqual(published.map((fc) => fc.features[0].properties.OBJECTID), [2, 1]);
});

test('mid-batch abort stops new requests and cannot publish or cache geometry', async () => {
  const ids = Array.from({ length: 501 }, (_, index) => index + 1);
  let started = 0;
  let markTwoStarted;
  const twoStarted = new Promise((resolve) => { markTwoStarted = resolve; });
  let published = false;
  const loader = createParcelViewportLoader({
    batchConcurrency: 2,
    fetchFn: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('returnIdsOnly') === 'true') {
        return response({ objectIds: ids });
      }
      started += 1;
      if (started === 2) markTwoStarted();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });
  const pending = loader.load({
    ...validRequest,
    onFeatures: () => { published = true; }
  });
  await twoStarted;
  loader.abort();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(started, 2);
  assert.equal(published, false);
  assert.equal(loader.getCacheSize(), 0);
});

test('malformed bounds and ArcGIS errors are isolated', async () => {
  let malformedFetches = 0;
  const malformedLoader = createParcelViewportLoader({
    fetchFn: async () => {
      malformedFetches += 1;
      return response({});
    }
  });
  const malformed = await malformedLoader.load({
    ...validRequest,
    bounds: { west: 'bad', south: 0, east: 1, north: 1 }
  });
  assert.equal(malformedFetches, 0);
  assert.match(malformed.failures[0].message, /bounds must be/);

  const arcgisLoader = createParcelViewportLoader({
    fetchFn: async () => response({ error: { message: 'ArcGIS unavailable' } })
  });
  const arcgis = await arcgisLoader.load(validRequest);
  assert.match(arcgis.failures[0].message, /ArcGIS unavailable/);

  const malformedJsonLoader = createParcelViewportLoader({
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('invalid JSON'); }
    })
  });
  const malformedJson = await malformedJsonLoader.load(validRequest);
  assert.match(malformedJson.failures[0].message, /invalid JSON/);
});

test('z17 fetches IDs and empty results publish without feature requests', async () => {
  let fetchCount = 0;
  let published;
  const loader = createParcelViewportLoader({
    fetchFn: async () => {
      fetchCount += 1;
      return response({ objectIds: [] });
    }
  });
  const result = await loader.load({
    ...validRequest,
    onFeatures: (collection) => { published = collection; }
  });
  assert.equal(fetchCount, 1);
  assert.deepEqual(result.features, []);
  assert.deepEqual(published, { type: 'FeatureCollection', features: [] });
});

test('local MapLibre style preserves required civic-map invariants', () => {
  const stylePath = path.join(__dirname, '..', 'public', 'map-styles', 'altagether-voyager-v1.json');
  const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
  assert.equal(style.version, 8);
  assert.equal(style.sources.carto.url,
    'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json');
  assert.match(style.sources.carto.attribution, /OpenStreetMap contributors/);
  assert.match(style.sources.carto.attribution, /CARTO/);

  const buildingLayers = style.layers.filter((layer) => layer['source-layer'] === 'building');
  assert.deepEqual(buildingLayers.map((layer) => layer.id), [
    'building-reference-fill',
    'building-reference-outline'
  ]);
  assert.ok(buildingLayers.every((layer) => layer.source === 'carto'));
  assert.ok(buildingLayers.every((layer) => layer.minzoom === 17));

  const buildingFill = buildingLayers[0];
  assert.equal(buildingFill.type, 'fill');
  assert.equal(buildingFill.paint['fill-color'], '#E7DED1');
  assert.equal(buildingFill.paint['fill-opacity'], 0.4);
  assert.equal(Object.hasOwn(buildingFill.paint, 'fill-extrusion-height'), false);
  assert.equal(Object.hasOwn(buildingFill.paint, 'fill-translate'), false);

  const buildingOutline = buildingLayers[1];
  assert.equal(buildingOutline.type, 'line');
  assert.equal(buildingOutline.paint['line-color'], '#B8AEA0');
  assert.equal(buildingOutline.paint['line-opacity'], 0.5);
  assert.equal(buildingOutline.paint['line-width'], 0.6);
  assert.equal(Object.hasOwn(buildingOutline.paint, 'line-dasharray'), false);
  assert.doesNotMatch(JSON.stringify(buildingLayers),
    /damage|status|burned|destroyed|affected|residential/i);

  const buildingOutlineIndex = style.layers.indexOf(buildingOutline);
  assert.ok(buildingOutlineIndex < style.layers.findIndex((layer) => layer.id === 'waterway_label'));
  assert.ok(buildingOutlineIndex < style.layers.findIndex((layer) => layer.id === 'road_service_case'));
  assert.ok(buildingOutlineIndex < style.layers.findIndex((layer) => layer.id === 'housenumber'));

  const background = style.layers.find((layer) => layer.id === 'background');
  assert.equal(background.paint['background-color'], '#F8F3E9');
  const house = style.layers.find((layer) => layer.id === 'housenumber');
  assert.ok(house);
  assert.equal(house.layout['text-field'], '{housenumber}');
  // The Leaflet bridge evaluates MapLibre at Leaflet zoom - 1.
  assert.equal(house.minzoom, 17);
  assert.equal(house.maxzoom, 24);
  assert.deepEqual(house.layout['text-size'].stops, [[17, 9], [19, 11], [23, 12]]);
  assert.equal(house.layout['text-allow-overlap'], false);
  assert.equal(house.layout['text-ignore-placement'], false);
  assert.equal(house.layout['symbol-avoid-edges'], true);
  assert.equal(house.paint['text-color'], '#6F6A61');
  assert.equal(house.paint['text-halo-color'], '#FFFDF8');
  assert.equal(house.paint['text-opacity'], 1);

  const symbolColors = style.layers
    .filter((layer) => layer.type === 'symbol' && layer.paint)
    .map((layer) => layer.paint['text-color'])
    .filter(Boolean);
  assert.ok(symbolColors.includes('#314059'));
  const roadAndWaterPaint = style.layers
    .filter((layer) => /road|water/.test(layer.id))
    .map((layer) => JSON.stringify(layer.paint || {}));
  assert.equal(roadAndWaterPaint.some((paint) => paint.includes('#347072')), false);

  const byId = (id) => style.layers.find((layer) => layer.id === id);
  const majorFills = [
    'tunnel_pri_fill', 'tunnel_trunk_fill', 'tunnel_mot_fill',
    'road_pri_fill_ramp', 'road_trunk_fill_ramp', 'road_mot_fill_ramp',
    'road_pri_fill_noramp', 'road_trunk_fill_noramp', 'road_mot_fill_noramp',
    'bridge_pri_fill', 'bridge_trunk_fill', 'bridge_mot_fill'
  ];
  const secondaryFills = [
    'tunnel_sec_fill', 'road_sec_fill_noramp', 'bridge_sec_fill'
  ];
  const majorCases = [
    'tunnel_pri_case', 'tunnel_trunk_case', 'tunnel_mot_case',
    'road_pri_case_ramp', 'road_trunk_case_ramp', 'road_mot_case_ramp',
    'road_pri_case_noramp', 'road_trunk_case_noramp', 'road_mot_case_noramp',
    'bridge_pri_case', 'bridge_trunk_case', 'bridge_mot_case'
  ];
  const secondaryCases = [
    'tunnel_sec_case', 'road_sec_case_noramp', 'bridge_sec_case'
  ];
  assert.ok(majorFills.every((id) => byId(id).paint['line-color'] === '#F6CF98'));
  assert.ok(secondaryFills.every((id) => byId(id).paint['line-color'] === '#FBE9C8'));
  assert.ok(majorCases.every((id) => byId(id).paint['line-color'] === '#D7B77F'));
  assert.ok(secondaryCases.every((id) => byId(id).paint['line-color'] === '#E2CFAB'));

  const neutralStreetFills = [
    'tunnel_path', 'tunnel_service_fill', 'tunnel_minor_fill',
    'road_path', 'road_service_fill', 'road_minor_fill',
    'bridge_path', 'bridge_service_fill', 'bridge_minor_fill'
  ];
  assert.ok(neutralStreetFills.every((id) => byId(id).paint['line-color'] === '#FFFDF8'));
  assert.equal(byId('rail').paint['line-color'], '#dddddd');
  assert.equal(byId('rail_dash').paint['line-color'], '#ffffff');

  assert.equal(byId('landcover').paint['fill-color'], '#C7D8B3');
  assert.equal(byId('park_national_park').paint['fill-color'], '#C7D8B3');
  assert.equal(byId('park_nature_reserve').paint['fill-color'], '#C7D8B3');
  assert.equal(byId('landuse_residential').paint['fill-color'], '#F4EEE4');
  assert.equal(byId('landuse').paint['fill-color'], '#EEE8DC');
  assert.equal(byId('water').paint['fill-color'], '#DDE8E8');
  assert.equal(byId('water_shadow').paint['fill-color'], '#C8D8D8');
  assert.equal(byId('waterway').paint['line-color'], '#B8CCCC');
});

test('warmer map branding preserves SOLD semantics and main-map scope', () => {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const badgeMatch = css.match(
    /\.address-sale-badge,\s*\.central-sales-section__badge\s*\{([\s\S]*?)\}/
  );
  assert.ok(badgeMatch);
  assert.match(badgeMatch[1], /background:\s*#fff7d6/i);
  assert.match(badgeMatch[1], /color:\s*#7c2d12/i);
  assert.match(badgeMatch[1], /border:\s*1px solid rgba\(146,\s*64,\s*14,\s*0\.45\)/i);
  assert.match(badgeMatch[1], /border-radius:\s*999px/i);
  assert.match(badgeMatch[1], /font-weight:\s*900/);
  assert.doesNotMatch(badgeMatch[1], /background:\s*#9f3a27|color:\s*#fff(?:\s*;|\s*$)/i);

  assert.match(html, /const MAPBOX_ADDITIONAL_LAYER_CONFIG = \{[\s\S]*?style: \{\s*color: '#314059',\s*weight: 2,\s*opacity: 0\.78,\s*fillColor: '#D6C58F',\s*fillOpacity: 0\.11\s*\},\s*hoverStyle: \{\s*color: '#314059',\s*weight: 3,\s*opacity: 0\.9,\s*fillColor: '#D6C58F',\s*fillOpacity: 0\.18\s*\}/);
  assert.match(html, /const ZONE_BOUNDARY_STYLE = \{\s*color: '#314059',\s*weight: 2\.5,\s*opacity: 0\.75,\s*fillColor: '#D6C58F',\s*fillOpacity: 0\.11\s*\}/);
  assert.match(html, /const HOME_BOUNDARY_STYLE = \{\s*color: '#214025',\s*weight: 2,\s*opacity: 0\.8,\s*fillColor: '#214025',\s*fillOpacity: 0\.1\s*\}/);
  assert.match(html, /const LOT_WEEDING_ZONE_STYLE = \{\s*color: '#4B7D5D',\s*weight: 2,\s*opacity: 0\.85,\s*fillColor: '#A9CFA0',\s*fillOpacity: 0\.16\s*\}/);
  assert.match(html, /const baseStyle = LOT_WEEDING_ZONE_STYLE;/);

  const fallback = html.match(/async function loadKMLBoundary\(kmlUrl\) \{([\s\S]*?)\n    \}/);
  assert.ok(fallback);
  assert.match(fallback[1], /L\.geoJSON\(geojson, \{\s*style: ZONE_BOUNDARY_STYLE\s*\}\)/);
  assert.doesNotMatch(fallback[1], /color:\s*'#214025'|fillColor:\s*'#214025'/);
});

test('service-worker ownership and automatic lot-line integration stay aligned', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(worker, /const SW_VERSION = 'zd-shell-v5'/);
  assert.doesNotMatch(html, /shell-zd-shell-v4/);
  assert.doesNotMatch(html, /key !== 'shell-zd-shell-/);
  const versionedStylePath = 'public/map-styles/altagether-voyager-v1.json?v=2';
  assert.match(html, new RegExp(
    `const ZONE_STREET_STYLE_URL = '${versionedStylePath.replace(/[.?]/g, '\\$&')}'`
  ));
  assert.match(worker, new RegExp(
    `'/${versionedStylePath.replace(/[.?]/g, '\\$&')}'`
  ));
  assert.doesNotMatch(worker, /['"]\/public\/map-styles\/altagether-voyager-v1\.json['"]/);

  assert.doesNotMatch(html, /mobileLayerLotLines/);
  assert.doesNotMatch(html, /lotLinesLayerToggleBtn/);
  assert.doesNotMatch(html, /LA County lot lines \(zoom \d+\+\)/);
  assert.doesNotMatch(html, /setLotLinesVisible|updateLotLinesToggleButton|syncLotLinesAttribution/);
  assert.doesNotMatch(html, /toggleLotLines|areLotLinesVisible/);
  assert.doesNotMatch(html, /lotLinesVisible|lotLinesAttributionVisible/);

  assert.match(html, /const lotLinesRenderer = L\.canvas\(\{/);
  assert.match(html, /renderer: lotLinesRenderer/);
  assert.match(html, /const request = \{[\s\S]*?visible: true,[\s\S]*?mapVisible:/);
  assert.match(html,
    /zoneMap = L\.map\('zoneMap'[\s\S]*?addAttribution\(LA_COUNTY_PARCEL_ATTRIBUTION\)/);
  assert.doesNotMatch(html, /removeAttribution\(LA_COUNTY_PARCEL_ATTRIBUTION\)/);

  const referenceWording = 'Structure shapes update periodically and may be inaccurate.';
  const normalizedHtml = html.replace(/\s+/g, ' ');
  assert.equal(normalizedHtml.split(referenceWording).length - 1, 2);
  assert.match(html, /<p class="map-reference-note">[\s\S]*Structure shapes update periodically/);
  assert.match(html,
    /L\.DomUtil\.create\('p', 'map-reference-note', panel\)[\s\S]*Structure shapes update periodically/);
});
