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

const buildExcel = async (rows, summary, query) => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Manihar Enterprises Stock Management System';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = 'Stock Report';
  workbook.title = 'Manihar Enterprises Stock Report';

  const worksheet = workbook.addWorksheet('Stock Report', {
    views: [{ state: 'frozen', ySplit: 10 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    properties: { defaultRowHeight: 20 },
  });

  const reportHeaders = [
    'Date',
    'Mill',
    'Quality',
    'Design',
    'Lot No',
    'Type',
    'Received (m)',
    'Than Meter (m)',
    'Bale Meter (m)',
    'Bale Details',
    'Second (m)',
    'Unchecked (m)',
    'Final Report (m)',
    'Sold (m)',
    'In Stock (m)',
  ];

  worksheet.mergeCells('A1:I1');
  worksheet.getCell('A1').value = 'Stock Report';
  worksheet.getCell('A1').font = { name: 'Segoe UI', size: 18, bold: true, color: { argb: 'FF0F172A' } };
  worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };

  worksheet.mergeCells('A2:I2');
  worksheet.getCell('A2').value = `Generated ${formatDateTime()}`;
  worksheet.getCell('A2').font = { name: 'Segoe UI', size: 10, color: { argb: 'FF475569' } };

  const summaryItems = [
    ['Total Records', summary.count],
    ['Total Received (m)', summary.totalReceived.toFixed(2)],
    ['Total Sold (m)', summary.totalSold.toFixed(2)],
    ['Total In Stock (m)', summary.totalInStock.toFixed(2)],
    ['Total Than Meter (m)', summary.totalThanMeter.toFixed(2)],
    ['Total Bale Meter (m)', summary.totalBaleMeter.toFixed(2)],
  ];

  summaryItems.forEach(([label, value], index) => {
    const row = 4 + index;
    worksheet.getCell(`A${row}`).value = label;
    worksheet.getCell(`B${row}`).value = value;
    worksheet.getCell(`A${row}`).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
    worksheet.getCell(`B${row}`).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    worksheet.getCell(`B${row}`).alignment = { horizontal: 'right' };
    ['A', 'B'].forEach((col) => {
      worksheet.getCell(`${col}${row}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index % 2 === 0 ? 'FFEFF6FF' : 'FFF8FBFF' },
      };
      worksheet.getCell(`${col}${row}`).border = {
        top: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        left: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        right: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      };
    });
  });

  const filterStartRow = 4;
  getFilterLines(query).forEach((line, index) => {
    const row = filterStartRow + index;
    worksheet.mergeCells(`D${row}:G${row}`);
    worksheet.getCell(`D${row}`).value = line;
    worksheet.getCell(`D${row}`).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF475569' } };
    worksheet.getCell(`D${row}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };
    worksheet.getCell(`D${row}`).border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });

  const headerRowNumber = 11;
  worksheet.addRow([]);
  const headerRow = worksheet.getRow(headerRowNumber);
  reportHeaders.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
    cell.alignment = { vertical: 'middle', horizontal: header === 'Bale Details' ? 'left' : 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      left: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      right: { style: 'thin', color: { argb: 'FFBFDBFE' } },
    };
  });
  headerRow.height = 24;

  rows.forEach((row, rowIndex) => {
    const excelRow = worksheet.addRow([
      formatDate(row.date),
      row.millName,
      row.qualityName,
      row.designName,
      row.lotNo,
      formatTypeLabel(row.type),
      Number(formatMeter(row.totalMeterReceived)),
      Number(formatMeter(row.meterOfTotalThan)),
      Number(formatMeter(row.meterOfTotalBales)),
      buildRowBaleDetails(row, { multiline: true, maxLength: 500 }),
      Number(formatMeter(row.second)),
      Number(formatMeter(row.unchecked)),
      Number(formatMeter(row.finalReport)),
      Number(formatMeter(row.meterSold)),
      Number(formatMeter((row.stockRemaining || 0) + (row.unchecked || 0))),
    ]);

    excelRow.height = Math.max(24, Math.min(72, 18 + Math.ceil(String(excelRow.getCell(10).value || '').length / 55) * 14));

    excelRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = {
        vertical: 'top',
        horizontal: [5, 7, 8, 9, 11, 12, 13, 14, 15].includes(colNumber) ? 'right' : 'left',
        wrapText: colNumber === 10,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowIndex % 2 === 0 ? 'FFFFFFFF' : 'FFF8FBFF' },
      };
      if (colNumber === 10) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: rowIndex % 2 === 0 ? 'FFF8FBFF' : 'FFF1F5F9' },
        };
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6E4FF' } },
        left: { style: 'thin', color: { argb: 'FFD6E4FF' } },
        bottom: { style: 'thin', color: { argb: 'FFD6E4FF' } },
        right: { style: 'thin', color: { argb: 'FFD6E4FF' } },
      };
      if ([7, 8, 9, 11, 12, 13, 14, 15].includes(colNumber)) {
        cell.numFmt = '0.00';
      }
    });
  });

  worksheet.columns = [
    { width: 12 },
    { width: 26 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 10 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
    { width: 44 },
    { width: 13 },
    { width: 14 },
    { width: 15 },
    { width: 13 },
    { width: 14 },
  ];

  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: reportHeaders.length },
  };

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (!cell.alignment) {
        cell.alignment = { vertical: 'middle' };
      }
    });
  });

  const lastRow = worksheet.lastRow?.number || headerRowNumber;
  worksheet.pageSetup.printArea = `A1:O${lastRow}`;

  return workbook.xlsx.writeBuffer();
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
      { label: 'Quality', width: 90 },
      { label: 'Design', width: 90 },
      { label: 'Mill', width: 120 },
      { label: 'Details', width: pageWidth - 40 - 46 - 90 - 90 - 120 },
    ],
    rows: rows.map((row) => [
      String(row.lotNo ?? ''),
      formatTypeLabel(row.type),
      row.qualityName,
      row.designName,
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
    const normalizedFormat = format === 'xls' ? 'xlsx' : format;
    const { rows, summary } = await buildReportPayload(req.query);

    if (normalizedFormat === 'csv') {
      const csv = buildCsv(rows, summary);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${buildReportFileName(req.query, 'csv')}"`);
      return res.send(csv);
    }

    if (normalizedFormat === 'xlsx') {
      const workbook = await buildExcel(rows, summary, req.query);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${buildReportFileName(req.query, 'xlsx')}"`);
      return res.send(Buffer.from(workbook));
    }

    if (normalizedFormat === 'pdf') {
      const pdf = await buildPdf(rows, summary, req.query);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${buildReportFileName(req.query, 'pdf')}"`);
      return res.send(pdf);
    }

    return res.status(400).json({ success: false, message: 'Unsupported export format. Use pdf, xlsx, or csv.' });
  } catch (error) {
    next(error);
  }
};
