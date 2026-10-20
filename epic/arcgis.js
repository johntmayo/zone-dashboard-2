'use strict';

// Minimal ArcGIS FeatureServer client scoped to the EPIC sync.
// Uses Node's built-in fetch (Node 18+). No external deps.

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function fieldNameSet(availableFields) {
  if (!Array.isArray(availableFields) || !availableFields.length) return null;
  return new Set(availableFields.map((name) => String(name).toUpperCase()));
}

// Build the WHERE clause used for the sync query.
//
// Always scope to the configured disaster (Eaton). SUP_DIST is applied only
// when the live layer still exposes that field. LA County removed it on
// 2026-10-20; querying it makes ArcGIS reject the whole request, and the
// September audit already found it was not a reliable Altadena boundary.
function buildWhereClause({ disasterType, supDist, availableFields } = {}) {
  const parts = [];
  parts.push(`DISASTER_TYPE='${escapeSqlString(disasterType)}'`);
  const fields = fieldNameSet(availableFields);
  if (supDist && fields && fields.has('SUP_DIST')) {
    parts.push(`SUP_DIST='${escapeSqlString(supDist)}'`);
  }
  return parts.join(' AND ');
}

// Drop requested fields the live layer does not have. Unknown outFields are
// not always fatal, but a WHERE clause that names a removed field is.
// When metadata is missing, still omit fields the county has already retired
// so a metadata miss cannot recreate that failure.
const RETIRED_OUT_FIELDS = new Set(['SUP_DIST', 'NEW_DWELLING_UNITS']);

function selectOutFields(requested, availableFields) {
  const names = Array.isArray(requested) ? requested : [];
  const fields = fieldNameSet(availableFields);
  if (!fields) {
    return names.filter((name) => !RETIRED_OUT_FIELDS.has(String(name).toUpperCase()));
  }
  return names.filter((name) => fields.has(String(name).toUpperCase()));
}

function buildQueryUrl(baseUrl, params) {
  const url = new URL(baseUrl.replace(/\/$/, '') + '/query');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const bodyText = await res.text();
    if (!res.ok) {
      const snippet = bodyText.slice(0, 500);
      throw new Error(`ArcGIS HTTP ${res.status}: ${snippet}`);
    }
    let json;
    try {
      json = JSON.parse(bodyText);
    } catch (err) {
      throw new Error(`ArcGIS returned non-JSON (first 200 chars): ${bodyText.slice(0, 200)}`);
    }
    if (json && json.error) {
      const msg = json.error.message || JSON.stringify(json.error);
      throw new Error(`ArcGIS API error: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch source metadata (last edit date, etc.) with a single lightweight call.
async function fetchLayerMetadata(config) {
  const url = `${config.featureServiceUrl.replace(/\/$/, '')}?f=json`;
  try {
    const json = await fetchJson(url, config.fetchTimeoutMs);
    const fieldNames = Array.isArray(json && json.fields)
      ? json.fields.map((field) => field && field.name).filter(Boolean)
      : [];
    return {
      lastEditDate: (json && json.editingInfo && json.editingInfo.lastEditDate) || null,
      currentVersion: json && json.currentVersion,
      name: json && json.name,
      fieldNames
    };
  } catch (err) {
    // Non-fatal - we still try the data query below.
    return {
      lastEditDate: null,
      currentVersion: null,
      name: null,
      fieldNames: [],
      metadataError: err.message
    };
  }
}

// Paginated fetch of all features matching the EPIC filter.
// Returns { features: [{attributes: {...}}], pages, hitMaxPages }.
//
// Stable ordering is required for ArcGIS pagination to be correct across
// page boundaries; we order by OBJECTID ASC because it is always present
// and immutable per feature.
async function fetchAllEpicFeatures(config, layerMeta) {
  const fieldNames = layerMeta && Array.isArray(layerMeta.fieldNames) ? layerMeta.fieldNames : [];
  const where = buildWhereClause({
    disasterType: config.disasterType,
    supDist: config.supDist,
    availableFields: fieldNames
  });
  const outFields = selectOutFields(config.outFields, fieldNames);
  if (!outFields.length) {
    throw new Error('ArcGIS layer has none of the requested EPIC fields.');
  }
  const knownFields = fieldNameSet(fieldNames);
  const supDistApplied = Boolean(knownFields && knownFields.has('SUP_DIST') && config.supDist);

  const baseParams = {
    where,
    outFields: outFields.join(','),
    returnGeometry: 'false',
    orderByFields: 'OBJECTID ASC',
    f: 'json',
    resultRecordCount: config.pageSize
  };

  const all = [];
  let offset = 0;
  let page = 0;
  let hitMaxPages = false;

  for (; page < config.maxPages; page++) {
    const url = buildQueryUrl(config.featureServiceUrl, {
      ...baseParams,
      resultOffset: offset
    });
    const json = await fetchJson(url, config.fetchTimeoutMs);
    const features = Array.isArray(json.features) ? json.features : [];
    all.push(...features);

    const exceeded = Boolean(json.exceededTransferLimit);
    if (features.length === 0) break;
    if (features.length < config.pageSize && !exceeded) break;

    offset += features.length;
  }

  if (page >= config.maxPages) hitMaxPages = true;

  return { features: all, pages: page + 1, hitMaxPages, supDistApplied };
}

module.exports = {
  buildWhereClause,
  selectOutFields,
  buildQueryUrl,
  fetchLayerMetadata,
  fetchAllEpicFeatures
};
