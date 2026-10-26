/**
 * Generate a State of the Neighborhood sample deck PDF (Zone 55–style fixture).
 * Uses the same 16:9 layout language as the live generator in index.html.
 *
 * Usage: node scripts/generate-son-sample.js
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const OUT_DIR = path.join(__dirname, '..', 'prototypes', 'state-of-neighborhood');
const HTML_PATH = path.join(OUT_DIR, 'zone-55-sample-deck.html');
const PDF_PATH = path.join(OUT_DIR, 'zone-55-sample-deck.pdf');

const C = {
  ink: '#1F2937',
  muted: '#5a6550',
  accent: '#283618',
  accentSoft: '#606c38',
  navy: '#314059',
  gold: '#F59E0B',
  clay: '#BC5838',
  teal: '#347072',
  paper: '#FDFBF7',
  soft: '#F3F0E6',
  border: '#D0CFC8',
  totalLoss: '#BC5838',
  partial: '#DDA15E',
  standing: '#81BDC3'
};

// Illustrative Zone 55–style snapshot for design review (not a live export)
const data = {
  zoneName: 'Zone 55',
  monthYear: 'October 2026',
  reportDate: 'October 22, 2026',
  captains: 'Alex Rivera · Jordan Lee',
  note: 'Join us next month for a State of the Neighborhood gathering — bring questions about rebuilding and how we can support each other.',
  totalAddresses: 64,
  totalPeople: 118,
  totalLoss: 51,
  partial: 4,
  standing: 7,
  notSet: 2,
  totalLossPct: 80,
  damaged: 55,
  damagedPct: 86,
  epicMatched: 38,
  epicDamaged: 55,
  epicPct: 69,
  milestones: [
    { key: 'application_or_plans', label: 'Plans &\napplications', count: 24, color: C.teal },
    { key: 'permit_issued', label: 'Permit\nissued', count: 8, color: C.accentSoft },
    { key: 'construction_underway', label: 'Under\nconstruction', count: 5, color: C.gold },
    { key: 'construction_completed', label: 'Construction\ncompleted', count: 1, color: C.navy }
  ],
  countyPermitOrBeyond: 14,
  tempHousing: 3,
  missingApn: 6,
  plans: [
    { label: 'Building', count: 31, color: C.accentSoft },
    { label: 'Undecided', count: 12, color: C.teal },
    { label: 'Selling', count: 7, color: C.partial },
    { label: 'Not set', count: 5, color: '#B9B9B4' }
  ],
  builds: [
    { label: 'Planning/Not Ready', count: 14, color: C.navy },
    { label: 'Permits & Pre-Construction', count: 9, color: '#3c7d7b' },
    { label: 'Under Construction', count: 6, color: C.teal },
    { label: 'Moved In', count: 2, color: C.accentSoft }
  ],
  buildingPlanCount: 31,
  sold: 5
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chip(text) {
  return `<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:rgba(49,64,89,0.08);color:${C.navy};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${esc(text)}</span>`;
}

function slide(inner, pad = '48px 56px', bg = C.paper) {
  return `<section class="slide" style="width:1280px;height:720px;box-sizing:border-box;padding:${pad};background:${bg};color:${C.ink};font-family:Chivo,Helvetica Neue,Arial,sans-serif;display:flex;flex-direction:column;position:relative;overflow:hidden;page-break-after:always;">${inner}</section>`;
}

function damageColumns() {
  const items = [
    { label: 'Total Loss', count: data.totalLoss, color: C.totalLoss },
    { label: 'Partial', count: data.partial, color: C.partial },
    { label: 'Standing', count: data.standing, color: C.standing },
    { label: 'Not set', count: data.notSet, color: '#B9B9B4' }
  ];
  const max = Math.max(...items.map((i) => i.count), 1);
  const h = 300;
  return `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:18px;height:${h + 70}px;">
    ${items.map((item) => {
      const barH = Math.max(8, Math.round((item.count / max) * h));
      const pct = Math.round((item.count / data.totalAddresses) * 100);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">
        <div style="font-size:28px;font-weight:900;color:${item.color};margin-bottom:8px;">${item.count}</div>
        <div style="width:100%;max-width:92px;height:${barH}px;background:${item.color};border-radius:10px 10px 4px 4px;box-shadow:4px 4px 0 rgba(31,41,55,0.12);"></div>
        <div style="margin-top:12px;font-size:14px;font-weight:700;">${esc(item.label)}</div>
        <div style="font-size:13px;color:${C.muted};">${pct}% of zone</div>
      </div>`;
    }).join('')}
  </div>`;
}

function journey() {
  return `<div style="display:flex;gap:8px;align-items:flex-start;">
    ${data.milestones.map((m, idx) => `
      <div style="flex:1;position:relative;text-align:center;">
        ${idx < data.milestones.length - 1 ? `<div style="position:absolute;top:36px;left:58%;right:-42%;height:4px;background:${C.border};"></div>` : ''}
        <div style="position:relative;z-index:1;width:72px;height:72px;margin:0 auto;border-radius:50%;background:${m.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;box-shadow:0 8px 18px rgba(40,54,24,0.18);">${m.count}</div>
        <div style="margin-top:14px;font-size:15px;font-weight:700;line-height:1.25;white-space:pre-line;">${esc(m.label)}</div>
      </div>`).join('')}
  </div>`;
}

function planRows(items, total) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return items.map((item) => {
    const width = Math.max(6, Math.round((item.count / max) * 100));
    const pct = Math.round((item.count / total) * 100);
    return `<div style="display:grid;grid-template-columns:170px 1fr 70px;gap:14px;align-items:center;margin-bottom:14px;">
      <div style="font-size:16px;font-weight:700;">${esc(item.label)}</div>
      <div style="height:28px;background:${C.soft};border-radius:6px;overflow:hidden;border:1px solid ${C.border};">
        <div style="height:100%;width:${width}%;background:${item.color};"></div>
      </div>
      <div style="text-align:right;font-size:18px;font-weight:900;">${item.count}<span style="display:block;font-size:12px;font-weight:700;color:${C.muted};">${pct}%</span></div>
    </div>`;
  }).join('');
}

const slides = [
  slide(`
    <div style="position:absolute;inset:0;background:linear-gradient(135deg,#243018 0%,#3f4a32 42%,#5c6b3a 100%);"></div>
    <div style="position:absolute;right:-80px;top:-80px;width:360px;height:360px;border-radius:50%;background:rgba(245,158,11,0.12);"></div>
    <div style="position:relative;z-index:1;flex:1;display:flex;flex-direction:column;justify-content:center;color:#FDFBF7;">
      <div style="text-transform:uppercase;letter-spacing:0.22em;font-size:14px;font-weight:700;color:${C.gold};margin-bottom:18px;">Altagether Neighborhood Captains</div>
      <div style="font-size:64px;font-weight:900;line-height:1.05;">State of the Neighborhood</div>
      <div style="margin-top:18px;font-size:34px;font-weight:700;">${esc(data.zoneName)}</div>
      <div style="margin-top:8px;font-size:20px;color:rgba(253,251,247,0.78);">${esc(data.monthYear)}</div>
      <div style="margin-top:28px;max-width:720px;padding:18px 22px;background:rgba(253,251,247,0.12);border-left:4px solid ${C.gold};font-size:20px;line-height:1.45;color:#FDFBF7;font-family:Lora,Georgia,serif;">“${esc(data.note)}”</div>
      <div style="margin-top:auto;padding-top:28px;font-size:18px;color:rgba(253,251,247,0.85);">Presented by ${esc(data.captains)}</div>
    </div>
  `, '56px 64px', '#243018'),

  slide(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      <div>
        <div style="text-transform:uppercase;letter-spacing:0.16em;font-size:13px;font-weight:700;color:${C.clay};margin-bottom:10px;">The impact</div>
        <div style="font-size:42px;font-weight:900;line-height:1.12;color:${C.accent};max-width:640px;">${data.totalLossPct}% of addresses in our zone were total losses</div>
      </div>
      ${chip('Neighborhood Captain records')}
    </div>
    <div style="margin-top:28px;flex:1;display:flex;gap:40px;">
      <div style="flex:0 0 280px;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:96px;font-weight:900;line-height:0.95;color:${C.totalLoss};">${data.totalLoss}</div>
        <div style="margin-top:10px;font-size:22px;font-weight:700;">homes lost</div>
        <div style="margin-top:18px;font-size:17px;line-height:1.5;color:${C.muted};">Of ${data.totalAddresses} addresses · ${data.standing} still standing · ${data.partial} partial damage</div>
        <div style="margin-top:18px;font-size:15px;color:${C.muted};">${data.totalPeople} neighbors on our roster</div>
      </div>
      <div style="flex:1;display:flex;align-items:flex-end;">${damageColumns()}</div>
    </div>
  `),

  slide(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      <div>
        <div style="text-transform:uppercase;letter-spacing:0.16em;font-size:13px;font-weight:700;color:${C.teal};margin-bottom:10px;">County recovery · EPIC-LA</div>
        <div style="font-size:40px;font-weight:900;line-height:1.12;color:${C.accent};max-width:760px;">Where rebuilding stands in the county system</div>
      </div>
      ${chip('LA County EPIC-LA')}
    </div>
    <div style="margin-top:18px;font-size:20px;line-height:1.45;">Of ${data.epicDamaged} damaged lots, <strong style="color:${C.accent};">${data.epicMatched}</strong> have a matched Los Angeles County rebuild record (${data.epicPct}%).</div>
    <div style="margin-top:28px;flex:1;display:flex;flex-direction:column;justify-content:center;">
      ${journey()}
      <div style="margin-top:22px;padding:16px 20px;background:${C.soft};border-radius:10px;font-size:17px;line-height:1.45;">
        <strong>${data.countyPermitOrBeyond}</strong> of those county-matched lots have reached <em>building permit issued</em> or further in the county system
        · <strong>${data.tempHousing}</strong> addresses show temporary housing activity
      </div>
      <div style="margin-top:14px;padding:12px 16px;background:#FDF3F0;border-left:4px solid ${C.clay};color:#8A3B2E;font-size:14px;line-height:1.45;">
        <strong>Data note.</strong> ${data.missingApn} addresses are missing APN numbers in our database, which can undercount permitting and sales figures.
      </div>
    </div>
    <div style="margin-top:auto;padding-top:12px;font-size:13px;color:${C.muted};line-height:1.4;">
      These figures come from county EPIC-LA cases matched by APN — not from captain Build Status notes. No match does not mean no rebuild.
    </div>
  `),

  slide(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      <div>
        <div style="text-transform:uppercase;letter-spacing:0.16em;font-size:13px;font-weight:700;color:${C.accentSoft};margin-bottom:10px;">Looking ahead</div>
        <div style="font-size:40px;font-weight:900;line-height:1.12;color:${C.accent};">What neighbors are planning</div>
      </div>
      ${chip('Neighborhood Captain records')}
    </div>
    <div style="margin-top:10px;font-size:16px;color:${C.muted};">From conversations our captains have logged — separate from county permit milestones on the previous slide.</div>
    <div style="margin-top:28px;flex:1;display:flex;gap:40px;">
      <div style="flex:1;">
        <div style="font-size:18px;font-weight:900;color:${C.navy};margin-bottom:14px;">Address plan · ${data.damaged} damaged lots</div>
        ${planRows(data.plans, data.damaged)}
        <div style="margin-top:8px;font-size:16px;color:${C.muted};"><strong style="color:${C.ink};font-size:22px;">${data.sold}</strong> homes sold since the fire <span style="font-size:13px;">(count only)</span></div>
      </div>
      <div style="flex:1;">
        <div style="font-size:18px;font-weight:900;color:${C.navy};margin-bottom:14px;">Build status · ${data.buildingPlanCount} planning to build</div>
        ${planRows(data.builds, data.buildingPlanCount)}
        <div style="margin-top:16px;font-size:13px;color:${C.muted};line-height:1.4;">“Permits &amp; Pre-Construction” here means a captain-recorded stage — not the same as a county-issued permit in EPIC-LA.</div>
      </div>
    </div>
  `),

  slide(`
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,${C.paper} 0%,#F3F0E6 55%,#E7ECD4 100%);"></div>
    <div style="position:relative;z-index:1;flex:1;display:flex;flex-direction:column;">
      <div style="text-transform:uppercase;letter-spacing:0.16em;font-size:13px;font-weight:700;color:${C.gold};margin-bottom:10px;">Conversation</div>
      <div style="font-size:44px;font-weight:900;line-height:1.1;color:${C.accent};">Let’s talk about our neighborhood</div>
      <div style="margin-top:12px;font-size:18px;color:${C.muted};max-width:760px;font-family:Lora,Georgia,serif;">The numbers only get us started. Your voice shapes what we do next.</div>
      <div style="margin-top:36px;flex:1;display:flex;gap:20px;">
        ${[
          'What are your biggest concerns right now?',
          'What information or resources would be most helpful?',
          'What should we be working on together?'
        ].map((p, i) => `
          <div style="flex:1;background:#fff;border:2px solid ${C.border};border-radius:14px;padding:28px 24px;box-shadow:6px 6px 0 rgba(49,64,89,0.08);">
            <div style="width:36px;height:36px;border-radius:50%;background:${C.gold};color:${C.accent};display:flex;align-items:center;justify-content:center;font-weight:900;margin-bottom:16px;">${i + 1}</div>
            <div style="font-size:24px;font-weight:700;line-height:1.35;font-family:Lora,Georgia,serif;">${esc(p)}</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:28px;display:flex;justify-content:space-between;">
        <div style="font-size:15px;color:${C.muted};">${esc(data.zoneName)} · ${esc(data.reportDate)} · Altagether · sample for design review</div>
        <div style="font-size:15px;font-weight:700;color:${C.accent};">altagether.org</div>
      </div>
    </div>
  `)
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Zone 55 · State of the Neighborhood (sample)</title>
  <link href="https://fonts.googleapis.com/css2?family=Chivo:wght@400;700;900&family=Lora:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page { size: 338.67mm 190.5mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .slide { page-break-after: always; break-after: page; }
    .slide:last-child { page-break-after: auto; }
  </style>
</head>
<body>
${slides.join('\n')}
</body>
</html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(HTML_PATH, html, 'utf8');
console.log('Wrote', HTML_PATH);

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (_) {
    console.log('puppeteer not installed locally; installing temporarily via npx is recommended.');
    console.log('Attempting dynamic import of puppeteer...');
  }

  // Prefer launching via npx-installed puppeteer in node_modules if present after npm i
  const candidates = [
    () => require('puppeteer'),
    () => require('puppeteer-core')
  ];
  for (const load of candidates) {
    try {
      puppeteer = load();
      break;
    } catch (_) { /* next */ }
  }

  if (!puppeteer) {
    console.log('HTML sample ready. Install puppeteer to emit PDF: npm i -D puppeteer && node scripts/generate-son-sample.js');
    return;
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: PDF_PATH,
      width: '13.333in',
      height: '7.5in',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    console.log('Wrote', PDF_PATH);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
