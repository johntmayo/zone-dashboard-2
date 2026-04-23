'use strict';

// Pure helpers: APN normalization, temporary-housing detection, and advisory
// stage mapping. No I/O. Safe to import anywhere and easy to unit test.

// Ordered list of columns written to the EPIC cache tab. This IS the schema.
// Do not reorder without bumping a migration note in EPIC_RUNBOOK.md.
const CACHE_COLUMNS = [
  'casenumber',
  'main_ain_raw',
  'main_ain_norm',
  'main_address',
  'workclass_name',
  'status',
  'rebuild_progress',
  'rebuild_progress_num',
  'apply_date_iso',
  'issuance_date_iso',
  'last_inspection_date_iso',
  'permit_valuation',
  'struct_type_disp',
  'new_dwelling_units',
  'description',
  'css_link',
  'disaster_type',
  'sup_dist',
  'is_temporary_housing',
  'suggested_stage_num',
  'suggested_stage_label',
  'suggestion_confidence',
  'suggestion_reason',
  'sync_run_at',
  'objectid'
];

const META_COLUMNS = ['key', 'value', 'updated_at'];

// Rebuild-progress text → integer hint used to compute suggested stage.
// These are the labels the county uses in the REBUILD_PROGRESS field.
const REBUILD_PROGRESS_ORDINAL = {
  'rebuild applications received': 1,
  'zoning reviews cleared': 2,
  'full building plans received': 3,
  'building plans approved': 4,
  'building permits issued': 5,
  'rebuild in construction': 6,
  'construction completed': 7
};

// Normalize an APN value to digits-only form. Handles:
//   - hyphenated "1234-567-890"
//   - whitespace
//   - leading zeros preserved
//   - non-string inputs coerced to string
// Returns empty string for null/undefined/non-digit inputs.
function normalizeApn(value) {
  if (value == null) return '';
  const digits = String(value).replace(/\D+/g, '');
  return digits;
}

// Parse an ArcGIS date value (epoch ms number, or numeric string).
// Returns an ISO-8601 string in UTC, or empty string if unparseable.
function arcgisDateToIso(value) {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  // ArcGIS epoch-ms can legitimately be 0; treat negative as invalid.
  if (n < 0) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

// Detect whether a case is temporary housing (not a rebuild).
// Signal comes from WORKCLASS_NAME or REBUILD_PROGRESS text.
function isTemporaryHousing(workclassName, rebuildProgress) {
  const hay = `${workclassName || ''} ${rebuildProgress || ''}`.toLowerCase();
  if (!hay.trim()) return false;
  if (hay.includes('temporary housing')) return true;
  if (hay.includes('temp housing')) return true;
  if (/\btemp\b/.test(hay) && /housing|dwelling|trailer|rv/.test(hay)) return true;
  return false;
}

// Advisory stage mapping. Returns { num, label, confidence, reason }.
// Stage 1 is captain-only (outreach). Stage 4/5 are never auto-suggested to
// keep the rule that captain knowledge is authoritative. Temporary housing
// cases are classified as a parallel track and do NOT produce a stage.
function mapStage({ isTempHousing, workclassName, rebuildProgress, status }) {
  if (isTempHousing) {
    return {
      num: null,
      label: 'Temporary Housing (parallel track)',
      confidence: 'low',
      reason: 'Temporary housing case; not merged into rebuild stage headline.'
    };
  }

  const progress = String(rebuildProgress || '').toLowerCase().trim();
  const ordinal = REBUILD_PROGRESS_ORDINAL[progress] || 0;

  if (ordinal === 0) {
    return {
      num: null,
      label: 'Unknown',
      confidence: 'low',
      reason: `No rebuild_progress match (raw="${rebuildProgress || ''}").`
    };
  }

  // Early steps up through plan approval → Stage 2 (design/approvals).
  if (ordinal >= 1 && ordinal <= 4) {
    return {
      num: 2,
      label: 'Stage 2 - Design / Approvals',
      confidence: ordinal >= 3 ? 'high' : 'medium',
      reason: `Mapped from rebuild_progress "${rebuildProgress}" (ordinal ${ordinal}).`
    };
  }

  // "Building Permits Issued" is the boundary between Stage 2 and Stage 3.
  // Default-suggest Stage 2 with medium confidence per plan guardrails.
  if (ordinal === 5) {
    return {
      num: 2,
      label: 'Stage 2 - Permit Issued (boundary)',
      confidence: 'medium',
      reason: 'Building permits issued; on the Stage 2/3 boundary. Captain confirms transition.'
    };
  }

  if (ordinal === 6) {
    return {
      num: 3,
      label: 'Stage 3 - Construction',
      confidence: 'high',
      reason: `Rebuild in construction (ordinal ${ordinal}).`
    };
  }

  // Construction completed → suggest Stage 4 candidate but never Stage 5.
  if (ordinal === 7) {
    return {
      num: 4,
      label: 'Stage 4 - Construction Complete (candidate)',
      confidence: 'medium',
      reason: 'Construction completed per county; Stage 4/5 confirmation is captain-owned.'
    };
  }

  return {
    num: null,
    label: 'Unknown',
    confidence: 'low',
    reason: `Unhandled ordinal ${ordinal}.`
  };
}

function toBoolString(v) {
  return v ? 'TRUE' : 'FALSE';
}

function fromBoolString(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function numOrEmpty(v) {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : '';
}

// Build a normalized record (key/value object) from one ArcGIS feature's
// attributes object. Output is flat and uses cache-column names.
function buildRecordFromArcgisAttrs(attrs, syncRunAtIso) {
  const a = attrs || {};
  const apnRaw = a.MAIN_AIN == null ? '' : String(a.MAIN_AIN);
  const apnNorm = normalizeApn(apnRaw);
  const workclass = a.WORKCLASS_NAME || '';
  const rebuildProgress = a.REBUILD_PROGRESS || '';
  const status = a.STATUS || '';
  const tempHousing = isTemporaryHousing(workclass, rebuildProgress);
  const stage = mapStage({
    isTempHousing: tempHousing,
    workclassName: workclass,
    rebuildProgress,
    status
  });

  return {
    casenumber: a.CASENUMBER == null ? '' : String(a.CASENUMBER),
    main_ain_raw: apnRaw,
    main_ain_norm: apnNorm,
    main_address: a.MAIN_ADDRESS || '',
    workclass_name: workclass,
    status,
    rebuild_progress: rebuildProgress,
    rebuild_progress_num: REBUILD_PROGRESS_ORDINAL[String(rebuildProgress).toLowerCase().trim()] || '',
    apply_date_iso: arcgisDateToIso(a.APPLY_DATE),
    issuance_date_iso: arcgisDateToIso(a.ISSUANCE_DATE),
    last_inspection_date_iso: arcgisDateToIso(a.LAST_INSPECTION_DATE),
    permit_valuation: numOrEmpty(a.PERMIT_VALUATION),
    struct_type_disp: a.STRUCT_TYPE_DISP || '',
    new_dwelling_units: numOrEmpty(a.NEW_DWELLING_UNITS),
    description: a.DESCRIPTION || '',
    css_link: a.CSSLINK || '',
    disaster_type: a.DISASTER_TYPE || '',
    sup_dist: a.SUP_DIST == null ? '' : String(a.SUP_DIST),
    is_temporary_housing: toBoolString(tempHousing),
    suggested_stage_num: stage.num == null ? '' : stage.num,
    suggested_stage_label: stage.label,
    suggestion_confidence: stage.confidence,
    suggestion_reason: stage.reason,
    sync_run_at: syncRunAtIso || '',
    objectid: a.OBJECTID == null ? '' : String(a.OBJECTID)
  };
}

// Convert a record object to a row array matching CACHE_COLUMNS order.
function recordToRow(record) {
  return CACHE_COLUMNS.map((col) => {
    const v = record[col];
    if (v == null) return '';
    return v;
  });
}

// Convert a row array (as read from Sheets) back into a record object keyed
// by column name. Tolerant to row being shorter than CACHE_COLUMNS.
function rowToRecord(row) {
  const rec = {};
  for (let i = 0; i < CACHE_COLUMNS.length; i++) {
    rec[CACHE_COLUMNS[i]] = row[i] == null ? '' : row[i];
  }
  return rec;
}

// Payload shape returned by the by-apn/by-apns endpoints. Splits rebuild
// vs temporary housing and surfaces one headline suggestion.
function buildLookupPayload(records, { apnNorm, lastSyncedAt } = {}) {
  const rebuild = [];
  const tempHousing = [];
  for (const r of records) {
    const isTemp = fromBoolString(r.is_temporary_housing);
    if (isTemp) tempHousing.push(r);
    else rebuild.push(r);
  }

  // Pick the "most progressed" rebuild case as the headline suggestion so a
  // one-to-many APN doesn't under-represent reality.
  let headline = null;
  let headlineOrdinal = -1;
  for (const r of rebuild) {
    const ord = Number(r.rebuild_progress_num) || 0;
    if (ord > headlineOrdinal) {
      headlineOrdinal = ord;
      headline = r;
    }
  }

  return {
    apn: apnNorm || '',
    cases_rebuild: rebuild,
    cases_temp_housing: tempHousing,
    suggested_stage: headline
      ? {
        num: headline.suggested_stage_num === '' ? null : Number(headline.suggested_stage_num) || null,
        label: headline.suggested_stage_label || '',
        source_casenumber: headline.casenumber || ''
      }
      : null,
    suggestion_confidence: headline ? (headline.suggestion_confidence || 'low') : 'low',
    suggestion_reason: headline
      ? (headline.suggestion_reason || '')
      : (rebuild.length === 0 && tempHousing.length === 0
        ? 'No EPIC cases found for this APN.'
        : 'Only temporary-housing cases found; no rebuild stage inferred.'),
    last_synced_at: lastSyncedAt || '',
    counts: {
      rebuild: rebuild.length,
      temp_housing: tempHousing.length,
      total: rebuild.length + tempHousing.length
    }
  };
}

module.exports = {
  CACHE_COLUMNS,
  META_COLUMNS,
  REBUILD_PROGRESS_ORDINAL,
  normalizeApn,
  arcgisDateToIso,
  isTemporaryHousing,
  mapStage,
  buildRecordFromArcgisAttrs,
  recordToRow,
  rowToRecord,
  buildLookupPayload,
  fromBoolString
};
