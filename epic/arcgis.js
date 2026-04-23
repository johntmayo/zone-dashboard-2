'use strict';

// Minimal ArcGIS FeatureServer client scoped to the EPIC sync.
// Uses Node's built-in fetch (Node 18+). No external deps.

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

// Build the WHERE clause used for the sync query. Filter is scoped exactly
// as specified in EPIC_DATA_INTEGRATION_PLAN (Eaton Fire + SUP_DIST 5) so
// captain sheets are never touched and we pull only what we need.
function buildWhereClause({ disasterType, supDist }) {
  const parts = [];
  parts.push(`DISASTER_TYPE='${escapeSqlString(disasterType)}'`);
  parts.push(`SUP_DIST='${escapeSqlString(supDist)}'`);
  return parts.join(' AND ');
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
    return {
      lastEditDate: (json && json.editingInfo && json.editingInfo.lastEditDate) || null,
      currentVersion: json && json.currentVersion,
      name: json && json.name
    };
  } catch (err) {
    // Non-fatal - we still try the data query below.
    return { lastEditDate: null, currentVersion: null, name: null, metadataError: err.message };
  }
}

// Paginated fetch of all features matching the EPIC filter.
// Returns { features: [{attributes: {...}}], pages, hitMaxPages }.
//
// Stable ordering is required for ArcGIS pagination to be correct across
// page boundaries; we order by OBJECTID ASC because it is always present
// and immutable per feature.
async function fetchAllEpicFeatures(config) {
  const where = buildWhereClause({
    disasterType: config.disasterType,
    supDist: config.supDist
  });

  const baseParams = {
    where,
    outFields: config.outFields.join(','),
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

  return { features: all, pages: page + 1, hitMaxPages };
}

module.exports = {
  buildWhereClause,
  buildQueryUrl,
  fetchLayerMetadata,
  fetchAllEpicFeatures
};
