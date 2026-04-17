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

const buildExcelTable = ({ headers, rows, headerTone = '#dbeafe', border = '#cbd5e1', zebra = '#f8fafc' }) => `
  <table style="border-collapse:collapse;width:100%;margin:0 0 18px 0;">
    <thead>
      <tr>
        ${headers
          .map(
            (header) =>
              `<th style="background:${headerTone};color:#0f172a;border:1px solid ${border};padding:8px 10px;text-align:left;font-weight:700;">${escapeHtml(
                header
              )}</th>`
          )
          .join('')}
      </tr>
    </thead>
    <tbody>
      ${
        rows.length > 0
          ? rows
              .map(
                (row, index) =>
                  `<tr style="background:${index % 2 === 0 ? '#ffffff' : zebra};">${row
                    .map(
                      (cell) =>
                        `<td style="border:1px solid ${border};padding:8px 10px;vertical-align:top;white-space:pre-wrap;">${escapeHtml(cell)}</td>`
                    )
                    .join('')}</tr>`
              )
              .join('')
          : `<tr><td colspan="${headers.length}" style="border:1px solid ${border};padding:10px;color:#64748b;">No records available</td></tr>`
      }
    </tbody>
  </table>
`;

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
  });

  const overviewTable = buildExcelTable({
    headers,
    rows: exportRows.map((row) => headers.map((header) => String(row[header] ?? ''))),
    headerTone: '#dbeafe',
    border: '#bfdbfe',
  });

  const summaryTable = buildExcelTable({
    headers: ['Metric', 'Value'],
    rows: getSummaryMetricItems(summary),
    headerTone: '#dcfce7',
    border: '#bbf7d0',
    zebra: '#f0fdf4',
  });

  const filterTable = buildExcelTable({
    headers: ['Applied Filters'],
    rows: getFilterLines(query).map((line) => [line]),
    headerTone: '#f1f5f9',
    border: '#cbd5e1',
  });

  const detailSections = rows
    .map((row) => {
      const metaTable = buildExcelTable({
        headers: ['Field', 'Value'],
        rows: [
          ['Date', formatDate(row.date)],
          ['Mill', row.millName],
          ['Quality', row.qualityName],
          ['Design', row.designName],
          ['Lot No', String(row.lotNo ?? '')],
          ['Type', formatTypeLabel(row.type)],
          ['Received (m)', formatMeter(row.totalMeterReceived)],
          ['Sold (m)', formatMeter(row.meterSold)],
          ['In Stock (m)', formatMeter((row.stockRemaining || 0) + (row.unchecked || 0))],
          ['Second (m)', formatMeter(row.second)],
          ['Unchecked (m)', formatMeter(row.unchecked)],
          ['Final Report (m)', formatMeter(row.finalReport)],
        ],
        headerTone: row.type === 'regular' ? '#dbeafe' : '#ede9fe',
        border: row.type === 'regular' ? '#bfdbfe' : '#ddd6fe',
        zebra: row.type === 'regular' ? '#f8fbff' : '#faf5ff',
      });

      const detailsTable =
        row.type === 'regular'
          ? buildExcelTable({
              headers: ['#', 'Bale No', 'Meter (m)', 'Status', 'Bill No'],
              rows: buildRegularBaleDetailRows(row).map((item) => [item.serial, item.baleNo, item.meter, item.status, item.billNo]),
              headerTone: '#eff6ff',
              border: '#bfdbfe',
            })
          : buildExcelTable({
              headers: ['Than #', 'Than Meter (m)', 'Than Status', 'Bale #', 'Bale No', 'Bale Meter (m)', 'Bill No'],
              rows: buildMixBaleDetailRows(row).map((item) => [
                item.thanSerial,
                item.thanMeter,
                item.thanStatus,
                item.baleSerial,
                item.baleNo,
                item.baleMeter,
                item.billNo,
              ]),
              headerTone: '#f5f3ff',
              border: '#ddd6fe',
              zebra: '#faf5ff',
            });

      return `
        <section style="margin-top:28px;page-break-inside:avoid;">
          <div style="padding:12px 16px;border:1px solid ${row.type === 'regular' ? '#bfdbfe' : '#ddd6fe'};background:${
            row.type === 'regular' ? 'linear-gradient(90deg, #eff6ff 0%, #ffffff 100%)' : 'linear-gradient(90deg, #f5f3ff 0%, #ffffff 100%)'
          };">
            <div style="font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(row.millName)} - Lot ${escapeHtml(String(row.lotNo ?? ''))}</div>
            <div style="margin-top:4px;color:#475569;">${escapeHtml(row.qualityName)} - ${escapeHtml(row.designName)} - ${escapeHtml(
        formatTypeLabel(row.type)
      )}</div>
          </div>
          <div style="margin-top:14px;font-size:15px;font-weight:700;color:#1e293b;">Stock Snapshot</div>
          ${metaTable}
          <div style="margin-top:6px;font-size:15px;font-weight:700;color:#1e293b;">${
            row.type === 'regular' ? 'Bale Number Details' : 'Than and Bale Number Details'
          }</div>
          ${detailsTable}
        </section>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; padding: 20px; color: #0f172a; }
      h1 { margin: 0; font-size: 26px; }
      h2 { margin: 6px 0 0; font-size: 14px; font-weight: 500; color: #475569; }
      .hero { padding: 18px 20px; border: 1px solid #cbd5e1; background: linear-gradient(135deg, #eff6ff 0%, #ffffff 60%, #f8fafc 100%); }
      .section-title { margin: 22px 0 10px; font-size: 17px; font-weight: 700; color: #0f172a; }
    </style>
  </head>
  <body>
    <div class="hero">
      <h1>Manihar Enterprises Stock Report</h1>
      <h2>Generated ${escapeHtml(formatDateTime())}</h2>
    </div>
    <div class="section-title">Applied Filters</div>
    ${filterTable}
    <div class="section-title">Summary</div>
    ${summaryTable}
    <div class="section-title">Overview</div>
    ${overviewTable}
    <div class="section-title">Detailed Stock Sections</div>
    ${detailSections || '<p style="color:#64748b;">No records available for the selected filters.</p>'}
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
    headerBg: '#e0f2fe',
    cardBg: '#eff6ff',
    zebra: '#f8fafc',
    regularBg: '#eff6ff',
    mixBg: '#f5f3ff',
    accent: '#1d4ed8',
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
    doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(13).text(title, { continued: false });
    doc.moveDown(0.25);
    const lineY = doc.y;
    doc.moveTo(doc.page.margins.left, lineY).lineTo(doc.page.margins.left + pageWidth, lineY).strokeColor(palette.border).lineWidth(1).stroke();
    doc.moveDown(0.45);
  };

  const drawMetricGrid = (items, columns = 3) => {
    const gap = 12;
    const cardWidth = (pageWidth - gap * (columns - 1)) / columns;
    const cardHeight = 52;
    let index = 0;

    while (index < items.length) {
      ensureSpace(cardHeight + 8);
      const startY = doc.y;
      for (let col = 0; col < columns && index < items.length; col += 1, index += 1) {
        const [label, value] = items[index];
        const x = doc.page.margins.left + col * (cardWidth + gap);
        doc.roundedRect(x, startY, cardWidth, cardHeight, 8).fillAndStroke(palette.cardBg, '#bfdbfe');
        doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x + 10, startY + 9, { width: cardWidth - 20 });
        doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(14).text(value, x + 10, startY + 24, { width: cardWidth - 20 });
      }
      doc.y = startY + cardHeight + 10;
    }
  };

  const drawKeyValueTable = (items, sectionTone) => {
    const labelWidth = 140;
    const valueWidth = pageWidth - labelWidth;
    const rowHeight = 22;
    items.forEach(([label, value], index) => {
      ensureSpace(rowHeight + 2);
      const y = doc.y;
      if (index % 2 === 0) {
        doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fill(sectionTone);
      }
      doc.rect(doc.page.margins.left, y, labelWidth, rowHeight).strokeColor(palette.border).lineWidth(0.5).stroke();
      doc.rect(doc.page.margins.left + labelWidth, y, valueWidth, rowHeight).strokeColor(palette.border).lineWidth(0.5).stroke();
      doc.fillColor(palette.muted).font('Helvetica-Bold').fontSize(9).text(label, doc.page.margins.left + 8, y + 7, { width: labelWidth - 16 });
      doc.fillColor(palette.ink).font('Helvetica').fontSize(9).text(String(value ?? ''), doc.page.margins.left + labelWidth + 8, y + 7, {
        width: valueWidth - 16,
      });
      doc.y = y + rowHeight;
    });
    doc.moveDown(0.4);
  };

  const drawTable = ({ title, columns, rows, headerBg = palette.headerBg, zebraBg = palette.zebra, emptyMessage = 'No records available' }) => {
    drawSectionTitle(title);
    const headerHeight = 24;
    const padding = 6;
    const drawHeader = () => {
      const y = doc.y;
      let x = doc.page.margins.left;
      columns.forEach((column) => {
        doc.rect(x, y, column.width, headerHeight).fillAndStroke(headerBg, palette.border);
        doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(8).text(column.label, x + padding, y + 8, {
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
      doc.fillColor(palette.muted).font('Helvetica').fontSize(9).text(emptyMessage, doc.page.margins.left + 8, doc.y + 7);
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
        doc.fillColor(palette.ink).font('Helvetica').fontSize(8.5).text(String(row[columnIndex] ?? ''), x + padding, y + 6, {
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

  drawSectionTitle('Report Filters');
  drawKeyValueTable(
    getFilterLines(query).map((line) => {
      const [label, ...rest] = line.split(':');
      return [label, rest.join(':').trim()];
    }),
    '#ffffff'
  );

  drawSectionTitle('Summary');
  drawMetricGrid(getSummaryMetricItems(summary), 3);

  if (!rows.length) {
    drawSectionTitle('Detailed Stock Report');
    doc.fillColor(palette.muted).font('Helvetica').fontSize(11).text('No records available for the selected filters.');
  } else {
    rows.forEach((row, index) => {
      ensureSpace(36);
      doc.roundedRect(doc.page.margins.left, doc.y, pageWidth, 46, 10).fillAndStroke(row.type === 'regular' ? palette.regularBg : palette.mixBg, palette.border);
      doc.fillColor(palette.ink).font('Helvetica-Bold').fontSize(15).text(`${row.millName}  |  Lot ${row.lotNo}`, doc.page.margins.left + 12, doc.y + 10);
      doc.fillColor(palette.muted).font('Helvetica').fontSize(10).text(
        `${row.qualityName} | ${row.designName} | ${formatTypeLabel(row.type)} | ${formatDate(row.date)}`,
        doc.page.margins.left + 12,
        doc.y + 28
      );
      doc.y += 58;

      drawMetricGrid(
        [
          ['Received', `${formatMeter(row.totalMeterReceived)} m`],
          ['Sold', `${formatMeter(row.meterSold)} m`],
          ['In Stock', `${formatMeter((row.stockRemaining || 0) + (row.unchecked || 0))} m`],
          ['Second', `${formatMeter(row.second)} m`],
          ['Unchecked', `${formatMeter(row.unchecked)} m`],
          ['Final Report', `${formatMeter(row.finalReport)} m`],
        ],
        3
      );

      drawSectionTitle('Stock Snapshot');
      drawKeyValueTable(
        [
          ['Date', formatDate(row.date)],
          ['Mill', row.millName],
          ['Quality', row.qualityName],
          ['Design', row.designName],
          ['Lot No', row.lotNo],
          ['Type', formatTypeLabel(row.type)],
          ['Total Bale Meter', `${formatMeter(row.meterOfTotalBales)} m`],
          ['Total Than Meter', `${formatMeter(row.meterOfTotalThan)} m`],
        ],
        row.type === 'regular' ? '#f8fbff' : '#faf5ff'
      );

      if (row.type === 'regular') {
        drawTable({
          title: 'Bale Number Details',
          columns: [
            { label: '#', width: 42 },
            { label: 'Bale No', width: 188 },
            { label: 'Meter (m)', width: 92, align: 'right' },
            { label: 'Status', width: 110 },
            { label: 'Bill No', width: 128 },
          ],
          rows: buildRegularBaleDetailRows(row).map((item) => [item.serial, item.baleNo, item.meter, item.status, item.billNo]),
          headerBg: '#dbeafe',
          zebraBg: '#f8fbff',
          emptyMessage: 'No bale details available',
        });
      } else {
        drawTable({
          title: 'Than Details',
          columns: [
            { label: 'Than #', width: 56 },
            { label: 'Than Meter (m)', width: 110, align: 'right' },
            { label: 'Status', width: 100 },
            { label: 'Bales', width: 100, align: 'right' },
          ],
          rows: (row.thanDetails || []).map((than) => [
            than.sNo ?? '',
            formatMeter(than.thanMeter),
            than.checked ? 'Sold' : 'In Stock',
            String((than.baleDetails || []).length),
          ]),
          headerBg: '#ede9fe',
          zebraBg: '#faf5ff',
          emptyMessage: 'No than details available',
        });

        drawTable({
          title: 'Than-wise Bale Number Details',
          columns: [
            { label: 'Than #', width: 52 },
            { label: 'Than Meter', width: 86, align: 'right' },
            { label: 'Than Status', width: 86 },
            { label: 'Bale #', width: 48 },
            { label: 'Bale No', width: 180 },
            { label: 'Bale Meter', width: 86, align: 'right' },
            { label: 'Bill No', width: 98 },
          ],
          rows: buildMixBaleDetailRows(row).map((item) => [
            item.thanSerial,
            item.thanMeter,
            item.thanStatus,
            item.baleSerial,
            item.baleNo,
            item.baleMeter,
            item.billNo,
          ]),
          headerBg: '#ede9fe',
          zebraBg: '#faf5ff',
          emptyMessage: 'No bale details available',
        });
      }

      if (index < rows.length - 1) {
        ensureSpace(18);
        doc.moveDown(0.4);
      }
    });
  }

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
