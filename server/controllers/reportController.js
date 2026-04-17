const Stock = require('../models/Stock');

const pad = (value) => String(value).padStart(2, '0');

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

const escapeCsvCell = (value) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapePdfText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const buildReportFilter = (query = {}) => {
  const { millId, qualityId, designId, lotNo, type, uncheckedStatus } = query;
  const filter = { isDeleted: false };

  if (millId) filter.millId = millId;
  if (qualityId) filter.qualityId = qualityId;
  if (designId) filter.designId = designId;
  if (lotNo && !isNaN(Number(lotNo))) filter.lotNo = Number(lotNo);
  if (type) filter.type = type;
  if (uncheckedStatus === 'yes') filter.unchecked = { $gt: 0 };
  if (uncheckedStatus === 'no') filter.unchecked = { $lte: 0 };

  return filter;
};

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatMeter = (value) => toNum(value).toFixed(2);

const formatDateTime = (value = new Date()) => new Date(value).toLocaleString('en-IN');

const formatTypeLabel = (type) => (type === 'regular' ? 'Regular' : 'Mix');

const slugifyFilePart = (value, fallback = 'all') => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
};

const buildReportFileName = (query = {}, format = 'csv') => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  const typePart = slugifyFilePart(query.type, 'all-types');
  const lotPart = query.lotNo ? `lot-${slugifyFilePart(query.lotNo, 'all-lots')}` : 'all-lots';
  const uncheckedPart =
    query.uncheckedStatus === 'yes' ? 'unchecked-only' : query.uncheckedStatus === 'no' ? 'checked-only' : 'all-status';

  return `manihar-stock-report-${stamp}-${typePart}-${lotPart}-${uncheckedPart}.${format}`;
};

const calculateRowMetrics = (stock) => {
  const total = toNum(stock.totalMeterReceived);
  const second = toNum(stock.second);
  const unchecked = toNum(stock.unchecked);

  if (stock.type === 'regular') {
    const meterOfTotalBales = Number((stock.baleDetails || []).reduce((sum, bale) => sum + toNum(bale.meter), 0).toFixed(2));
    const meterSold = Number(
      (stock.baleDetails || [])
        .filter((bale) => bale.billNo && String(bale.billNo).trim() !== '')
        .reduce((sum, bale) => sum + toNum(bale.meter), 0)
        .toFixed(2)
    );
    const stockRemaining = Number((meterOfTotalBales - meterSold).toFixed(2));

    return {
      meterOfTotalBales,
      meterOfTotalThan: 0,
      meterSold,
      stockRemaining,
      remaining: Number((total - meterOfTotalBales).toFixed(2)),
      finalReport: Number((total - (meterOfTotalBales + second + unchecked)).toFixed(2)),
    };
  }

  const meterOfTotalThan = Number((stock.thanDetails || []).reduce((sum, than) => sum + toNum(than.thanMeter), 0).toFixed(2));
  const meterOfTotalBales = Number(
    (stock.thanDetails || [])
      .reduce((sum, than) => sum + (than.baleDetails || []).reduce((bSum, bale) => bSum + toNum(bale.meter), 0), 0)
      .toFixed(2)
  );
  const meterSold = Number(
    (stock.thanDetails || [])
      .filter((than) => than.checked)
      .reduce((sum, than) => sum + toNum(than.thanMeter), 0)
      .toFixed(2)
  );
  const stockRemaining = Number((meterOfTotalThan - meterSold).toFixed(2));

  return {
    meterOfTotalBales,
    meterOfTotalThan,
    meterSold,
    stockRemaining,
    remaining: Number((total - meterOfTotalThan).toFixed(2)),
    finalReport: Number((total - (meterOfTotalThan + second + unchecked)).toFixed(2)),
  };
};

const mapStockToReportRow = (stock, isLotFiltered) => {
  const metrics = calculateRowMetrics(stock);
  const base = {
    _id: stock._id,
    date: stock.date,
    millName: stock.millName,
    qualityName: stock.qualityName,
    designName: stock.designName,
    lotNo: stock.lotNo,
    type: stock.type,
    totalMeterReceived: stock.totalMeterReceived,
    second: stock.second,
    unchecked: stock.unchecked,
    finalReport: metrics.finalReport,
    meterSold: metrics.meterSold,
    stockRemaining: metrics.stockRemaining,
    meterOfTotalBales: metrics.meterOfTotalBales,
    meterOfTotalThan: metrics.meterOfTotalThan,
    remaining: metrics.remaining,
  };

  if (stock.type === 'regular') {
    const regularBales = stock.baleDetails || [];
    const unsoldBales = regularBales.filter((bale) => !bale.billNo || bale.billNo.trim() === '');
    const soldBales = regularBales.filter((bale) => bale.billNo && bale.billNo.trim() !== '');

    return {
      ...base,
      regularBales,
      unsoldBales,
      soldBales: isLotFiltered ? soldBales : [],
    };
  }

  const mixThans = stock.thanDetails || [];
  const inStockThans = mixThans.filter((than) => !than.checked);
  const soldThans = mixThans.filter((than) => than.checked);

  return {
    ...base,
    inStockThans,
    soldThans,
    thanDetails: mixThans,
  };
};

const buildReportPayload = async (query = {}) => {
  const filter = buildReportFilter(query);
  const stocks = await Stock.find(filter)
    .sort({ date: -1, lotNo: 1, createdAt: -1 })
    .lean();
  const isLotFiltered = Boolean(query.lotNo);

  const rows = stocks.map((stock) => mapStockToReportRow(stock, isLotFiltered));
  const summary = {
    totalReceived: Number(rows.reduce((sum, row) => sum + toNum(row.totalMeterReceived), 0).toFixed(2)),
    totalSold: Number(rows.reduce((sum, row) => sum + toNum(row.meterSold), 0).toFixed(2)),
    totalInStock: Number(rows.reduce((sum, row) => sum + toNum(row.stockRemaining) + toNum(row.unchecked), 0).toFixed(2)),
    totalThanMeter: Number(rows.reduce((sum, row) => sum + toNum(row.meterOfTotalThan), 0).toFixed(2)),
    totalBaleMeter: Number(rows.reduce((sum, row) => sum + toNum(row.meterOfTotalBales), 0).toFixed(2)),
    count: stocks.length,
  };

  return { rows, summary, isLotFiltered };
};

const flattenRowsForExport = (rows) =>
  rows.map((row) => ({
    Date: formatDate(row.date),
    Mill: row.millName,
    Quality: row.qualityName,
    Design: row.designName,
    'Lot No': row.lotNo,
    Type: row.type === 'regular' ? 'Regular' : 'Mix',
    'Received (m)': Number(row.totalMeterReceived || 0).toFixed(2),
    'Than Meter (m)': Number(row.meterOfTotalThan || 0).toFixed(2),
    'Bale Meter (m)': Number(row.meterOfTotalBales || 0).toFixed(2),
    'Bale Details': buildRowBaleDetails(row),
    'Second (m)': Number(row.second || 0).toFixed(2),
    'Unchecked (m)': Number(row.unchecked || 0).toFixed(2),
    'Final Report (m)': Number(row.finalReport || 0).toFixed(2),
    'Sold (m)': Number(row.meterSold || 0).toFixed(2),
    'In Stock (m)': Number((row.stockRemaining || 0) + (row.unchecked || 0)).toFixed(2),
  }));

const getFilterLines = (query = {}) => [
  `Mill: ${query.millId || 'All'}`,
  `Quality: ${query.qualityId || 'All'}`,
  `Design: ${query.designId || 'All'}`,
  `Lot No: ${query.lotNo || 'All'}`,
  `Type: ${query.type || 'All'}`,
  `Unchecked: ${query.uncheckedStatus === 'yes' ? 'Unchecked Only' : query.uncheckedStatus === 'no' ? 'Checked Only' : 'All'}`,
];

const getSummaryMetricItems = (summary) => [
  ['Total Records', String(summary.count)],
  ['Total Received', `${formatMeter(summary.totalReceived)} m`],
  ['Total Sold', `${formatMeter(summary.totalSold)} m`],
  ['Total In Stock', `${formatMeter(summary.totalInStock)} m`],
  ['Total Than Meter', `${formatMeter(summary.totalThanMeter)} m`],
  ['Total Bale Meter', `${formatMeter(summary.totalBaleMeter)} m`],
];

const buildRowBaleDetails = (row, { compact = false, maxLength = null, multiline = false } = {}) => {
  const regularSegments =
    row.type === 'regular'
      ? (row.regularBales || []).map((bale) => {
          const base = compact
            ? `${bale.baleNo} ${formatMeter(bale.meter)}`
            : `${bale.sNo}. ${bale.baleNo} (${formatMeter(bale.meter)} m)`;
          return bale.billNo && String(bale.billNo).trim() !== ''
            ? `${base}${compact ? ` [${bale.billNo}]` : ` Bill ${bale.billNo}`}`
            : base;
        })
      : [];

  const mixSegments =
    row.type === 'mix'
      ? (row.thanDetails || []).flatMap((than) =>
          (than.baleDetails || []).map((bale) =>
            compact
              ? `T${than.sNo}/B${bale.sNo} ${bale.baleNo} ${formatMeter(bale.meter)}`
              : `Than ${than.sNo} / Bale ${bale.sNo} - ${bale.baleNo} (${formatMeter(bale.meter)} m${bale.billNo ? `, Bill ${bale.billNo}` : ''})`
          )
        )
      : [];

  const separator = multiline ? '\n' : compact ? ' | ' : '; ';
  const text = [...regularSegments, ...mixSegments].join(separator);
  if (!maxLength || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 12)).trimEnd()} ...more`;
};

const buildRegularBaleDetailRows = (row) => [
  ...((row.regularBales || []).filter((bale) => !bale.billNo || bale.billNo.trim() === '')).map((bale) => ({
    serial: bale.sNo ?? '',
    baleNo: bale.baleNo || '',
    meter: formatMeter(bale.meter),
    status: 'In Stock',
    billNo: '',
  })),
  ...((row.regularBales || []).filter((bale) => bale.billNo && bale.billNo.trim() !== '')).map((bale) => ({
    serial: bale.sNo ?? '',
    baleNo: bale.baleNo || '',
    meter: formatMeter(bale.meter),
    status: 'Sold',
    billNo: bale.billNo || '',
  })),
];

const buildMixBaleDetailRows = (row) =>
  (row.thanDetails || []).flatMap((than) =>
    (than.baleDetails || []).map((bale) => ({
      thanSerial: than.sNo ?? '',
      thanMeter: formatMeter(than.thanMeter),
      thanStatus: than.checked ? 'Sold' : 'In Stock',
      baleSerial: bale.sNo ?? '',
      baleNo: bale.baleNo || '',
      baleMeter: formatMeter(bale.meter),
      billNo: bale.billNo || '',
    }))
  );

const buildCsv = (rows, summary) => {
  const exportRows = flattenRowsForExport(rows);
  const headers = Object.keys(exportRows[0] || {
    Date: '',
    Mill: '',
    Quality: '',
    Design: '',
    'Lot No': '',
    Type: '',
    'Received (m)': '',
    'Than Meter (m)': '',
    'Bale Meter (m)': '',
    'Second (m)': '',
    'Unchecked (m)': '',
    'Final Report (m)': '',
    'Sold (m)': '',
    'In Stock (m)': '',
  });

  const lines = [
    headers.join(','),
    ...exportRows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
    '',
    `Summary Count,${summary.count}`,
    `Summary Total Received,${summary.totalReceived.toFixed(2)}`,
    `Summary Total Sold,${summary.totalSold.toFixed(2)}`,
    `Summary Total In Stock,${summary.totalInStock.toFixed(2)}`,
    `Summary Total Than Meter,${summary.totalThanMeter.toFixed(2)}`,
    `Summary Total Bale Meter,${summary.totalBaleMeter.toFixed(2)}`,
  ];

  return lines.join('\n');
};

const buildExcel = (rows, summary, query) => {
  const exportRows = flattenRowsForExport(rows);
  const headers = Object.keys(exportRows[0] || {
    Date: '',
    Mill: '',
    Quality: '',
    Design: '',
    'Lot No': '',
    Type: '',
    'Received (m)': '',
    'Than Meter (m)': '',
    'Bale Meter (m)': '',
    'Second (m)': '',
    'Unchecked (m)': '',
    'Final Report (m)': '',
    'Sold (m)': '',
    'In Stock (m)': '',
    'Bale Details': '',
  });
  const filterRows = getFilterLines(query)
    .map((line) => `<tr><td colspan="2" style="padding:6px 10px;color:#475569;border:1px solid #e2e8f0;">${escapeHtml(line)}</td></tr>`)
    .join('');

  const summaryRows = [
    ['Total Records', String(summary.count)],
    ['Total Received (m)', summary.totalReceived.toFixed(2)],
    ['Total Sold (m)', summary.totalSold.toFixed(2)],
    ['Total In Stock (m)', summary.totalInStock.toFixed(2)],
    ['Total Than Meter (m)', summary.totalThanMeter.toFixed(2)],
    ['Total Bale Meter (m)', summary.totalBaleMeter.toFixed(2)],
  ]
    .map(
      ([label, value], index) =>
        `<tr>
          <td style="padding:8px 12px;border:1px solid #bfdbfe;background:${index % 2 === 0 ? '#eff6ff' : '#f8fbff'};font-weight:600;color:#1e3a8a;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;border:1px solid #bfdbfe;background:${index % 2 === 0 ? '#eff6ff' : '#f8fbff'};font-weight:700;text-align:right;color:#0f172a;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  const bodyRows = exportRows
    .map(
      (row) =>
        `<tr>${headers
          .map((header) => {
            const isBaleDetails = header === 'Bale Details';
            const isNumeric = header !== 'Date' && header !== 'Mill' && header !== 'Quality' && header !== 'Design' && header !== 'Type' && header !== 'Bale Details';
            return `<td style="padding:8px 10px;border:1px solid #dbeafe;vertical-align:top;${isBaleDetails ? 'min-width:340px;max-width:420px;white-space:pre-wrap;word-break:break-word;background:#f8fbff;font-size:12px;line-height:1.45;' : ''}${isNumeric ? 'text-align:right;font-variant-numeric:tabular-nums;' : ''}">${escapeHtml(
              row[header]
            )}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; padding: 18px; color: #0f172a; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      h2 { margin: 0 0 14px; font-size: 14px; color: #475569; }
      table { border-collapse: collapse; width: 100%; table-layout: auto; }
      th { background: #e0f2fe; color: #1e3a8a; border: 1px solid #bfdbfe; padding: 8px 10px; text-align: left; white-space: nowrap; }
      .section { margin-bottom: 16px; }
      .summary-table { width: 420px; }
      .report-table td, .report-table th { font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>Stock Report</h1>
    <h2>Generated ${escapeHtml(formatDateTime())}</h2>
    <div class="section">
      <table class="summary-table">
        ${summaryRows}
      </table>
    </div>
    <div class="section">
      <table style="width:460px;">
        ${filterRows}
      </table>
    </div>
    <table class="report-table">
      <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
      ${bodyRows}
    </table>
  </body>
</html>`;
};

const buildPdf = (rows, summary, query) => {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({
    margin: 36,
    size: 'A4',
    layout: 'landscape',
    info: {
      Title: 'Manihar Enterprises Stock Report',
      Author: 'Manihar Enterprises Stock Management System',
    },
  });
  const chunks = [];
  let pageNumber = 1;

  doc.on('data', (chunk) => chunks.push(chunk));

  const palette = {
    ink: '#0f172a',
    muted: '#475569',
    border: '#cbd5e1',
    headerBg: '#dbeafe',
    zebra: '#f8fafc',
    summaryBg: '#eff6ff',
  };
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const safeBottom = pageBottom - 24;

  const drawPageFrame = () => {
    doc.save();
    doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 56).fill('#f8fafc');
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(20).text('Manihar Enterprises Stock Report', doc.page.margins.left + 16, doc.page.margins.top + 14);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(10).text(`Generated ${formatDateTime()}`, doc.page.margins.left + 16, doc.page.margins.top + 36);
    doc.restore();
    doc.y = doc.page.margins.top + 72;
  };

  const drawPageFooter = () => {
    doc.save();
    doc.fillColor('#64748b')
      .font('Helvetica')
      .fontSize(8)
      .text(`Page ${pageNumber}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 10, {
        width: pageWidth,
        align: 'right',
        lineBreak: false,
      });
    doc.restore();
  };

  const ensureSpace = (requiredHeight) => {
    if (doc.y + requiredHeight <= safeBottom) return;
    drawPageFooter();
    doc.addPage();
    pageNumber += 1;
    drawPageFrame();
  };

  const drawSectionTitle = (title) => {
    ensureSpace(28);
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(12).text(title, { continued: false });
    doc.moveDown(0.25);
    const lineY = doc.y;
    doc.moveTo(doc.page.margins.left, lineY).lineTo(doc.page.margins.left + pageWidth, lineY).strokeColor(palette.border).lineWidth(1).stroke();
    doc.moveDown(0.45);
  };

  const drawMetricGrid = (items, columns = 3) => {
    const gap = 12;
    const cardWidth = (pageWidth - gap * (columns - 1)) / columns;
    const cardHeight = 40;
    let index = 0;

    while (index < items.length) {
      ensureSpace(cardHeight + 8);
      const startY = doc.y;
      for (let col = 0; col < columns && index < items.length; col += 1, index += 1) {
        const [label, value] = items[index];
        const x = doc.page.margins.left + col * (cardWidth + gap);
        doc.roundedRect(x, startY, cardWidth, cardHeight, 6).fillAndStroke(palette.summaryBg, '#bfdbfe');
        doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(7).text(label.toUpperCase(), x + 8, startY + 7, { width: cardWidth - 16 });
        doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(11).text(value, x + 8, startY + 20, { width: cardWidth - 16 });
      }
      doc.y = startY + cardHeight + 10;
    }
  };

  const drawTable = ({ title, columns, rows, headerBg = palette.headerBg, zebraBg = palette.zebra, emptyMessage = 'No records available', fontSize = 7 }) => {
    drawSectionTitle(title);
    const headerHeight = 20;
    const padding = 5;
    const drawHeader = () => {
      const y = doc.y;
      let x = doc.page.margins.left;
      columns.forEach((column) => {
        doc.rect(x, y, column.width, headerHeight).fillAndStroke(headerBg, palette.border);
        doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(7).text(column.label, x + padding, y + 6, {
          width: column.width - padding * 2,
          align: column.align || 'left',
        });
        x += column.width;
      });
      doc.y = y + headerHeight;
    };

    ensureSpace(headerHeight + 6);
    drawHeader();

    if (!rows.length) {
      ensureSpace(28);
      doc.rect(doc.page.margins.left, doc.y, pageWidth, 24).strokeColor(palette.border).lineWidth(0.5).stroke();
      doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(emptyMessage, doc.page.margins.left + 8, doc.y + 7);
      doc.y += 30;
      return;
    }

    rows.forEach((row, rowIndex) => {
      const rowHeight =
        Math.max(
          ...columns.map((column, columnIndex) =>
            doc.heightOfString(String(row[columnIndex] ?? ''), {
              width: column.width - padding * 2,
              align: column.align || 'left',
            })
          )
        ) + 12;

      ensureSpace(rowHeight + 2);
      if (doc.y === doc.page.margins.top + 72) {
        drawHeader();
      }

      const y = doc.y;
      if (rowIndex % 2 === 1) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill(zebraBg);
      }

      let x = doc.page.margins.left;
      columns.forEach((column, columnIndex) => {
        doc.rect(x, y, column.width, rowHeight).strokeColor(palette.border).lineWidth(0.5).stroke();
        doc.fillColor(palette.ink).font('Helvetica').fontSize(fontSize).text(String(row[columnIndex] ?? ''), x + padding, y + 5, {
          width: column.width - padding * 2,
          align: column.align || 'left',
        });
        x += column.width;
      });
      doc.y = y + rowHeight;
    });

    doc.moveDown(0.35);
  };

  drawPageFrame();

  doc.fillColor(palette.muted).font('Helvetica').fontSize(8).text(getFilterLines(query).join('   |   '), {
    width: pageWidth,
    align: 'left',
  });
  doc.moveDown(0.6);

  drawSectionTitle('Summary');
  drawMetricGrid(getSummaryMetricItems(summary), 6);

  drawTable({
    title: 'Stock Overview',
    columns: [
      { label: 'Date', width: 46 },
      { label: 'Mill', width: 124 },
      { label: 'Quality', width: 92 },
      { label: 'Design', width: 76 },
      { label: 'Lot', width: 34, align: 'right' },
      { label: 'Type', width: 40 },
      { label: 'Recv', width: 46, align: 'right' },
      { label: 'Than', width: 40, align: 'right' },
      { label: 'Bale', width: 40, align: 'right' },
      { label: 'Sold', width: 40, align: 'right' },
      { label: 'Stock', width: 42, align: 'right' },
    ],
    rows: rows.map((row) => [
      formatDate(row.date),
      row.millName,
      row.qualityName,
      row.designName,
      String(row.lotNo ?? ''),
      formatTypeLabel(row.type),
      formatMeter(row.totalMeterReceived),
      formatMeter(row.meterOfTotalThan),
      formatMeter(row.meterOfTotalBales),
      formatMeter(row.meterSold),
      formatMeter((row.stockRemaining || 0) + (row.unchecked || 0)),
    ]),
    emptyMessage: 'No records available for the selected filters.',
  });

  drawTable({
    title: 'Bale Details',
    columns: [
      { label: 'Lot', width: 40, align: 'right' },
      { label: 'Type', width: 46 },
      { label: 'Mill', width: 140 },
      { label: 'Details', width: pageWidth - 40 - 46 - 140 },
    ],
    rows: rows.map((row) => [
      String(row.lotNo ?? ''),
      formatTypeLabel(row.type),
      row.millName,
      buildRowBaleDetails(row, { multiline: true, maxLength: 420 }) || 'No bale details',
    ]),
    headerBg: '#eef2ff',
    zebraBg: '#f8fbff',
    emptyMessage: 'No bale details available.',
    fontSize: 6.6,
  });

  drawPageFooter();
  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      resolve(pdfBuffer);
    });
  });
};

exports.getReport = async (req, res, next) => {
  try {
    const { rows, summary } = await buildReportPayload(req.query);
    res.json({ success: true, data: rows, summary });
  } catch (error) {
    next(error);
  }
};

exports.exportReport = async (req, res, next) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const { rows, summary } = await buildReportPayload(req.query);

    if (format === 'csv') {
      const csv = buildCsv(rows, summary);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${buildReportFileName(req.query, 'csv')}"`);
      return res.send(csv);
    }

    if (format === 'xls') {
      const workbook = buildExcel(rows, summary, req.query);
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${buildReportFileName(req.query, 'xls')}"`);
      return res.send(workbook);
    }

    if (format === 'pdf') {
      const pdf = await buildPdf(rows, summary, req.query);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${buildReportFileName(req.query, 'pdf')}"`);
      return res.send(pdf);
    }

    return res.status(400).json({ success: false, message: 'Unsupported export format. Use pdf, xls, or csv.' });
  } catch (error) {
    next(error);
  }
};
