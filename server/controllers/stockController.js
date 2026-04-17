const Stock = require('../models/Stock');
const Mill = require('../models/Mill');
const Quality = require('../models/Quality');
const Design = require('../models/Design');

const toNum = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasMoreThanTwoDecimals = (value) => {
  const text = String(value ?? '').trim();
  if (!text || !text.includes('.')) return false;
  return text.split('.')[1].length > 2;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAX_LIST_LIMIT = 200;
const MAX_BALE_ROWS = 5000;
const MAX_THAN_ROWS = 5000;
const MAX_MIX_BALE_ROWS_PER_THAN = 500;

const calculateRegularMetrics = (baleDetails = []) => {
  let meterSold = 0;
  let stockRemaining = 0;

  baleDetails.forEach((bale) => {
    const meter = toNum(bale?.meter);
    if (bale?.billNo && String(bale.billNo).trim() !== '') {
      meterSold += meter;
    } else {
      stockRemaining += meter;
    }
  });

  return {
    meterSold: Number(meterSold.toFixed(2)),
    stockRemaining: Number(stockRemaining.toFixed(2)),
  };
};

const calculateMixMetrics = (thanDetails = []) => {
  let meterSold = 0;
  let stockRemaining = 0;

  thanDetails.forEach((than) => {
    const meter = toNum(than?.thanMeter);
    if (than?.checked) {
      meterSold += meter;
    } else {
      stockRemaining += meter;
    }
  });

  return {
    meterSold: Number(meterSold.toFixed(2)),
    stockRemaining: Number(stockRemaining.toFixed(2)),
  };
};

const calculateStockMetrics = (stock = {}) =>
  stock.type === 'regular'
    ? calculateRegularMetrics(stock.baleDetails || [])
    : calculateMixMetrics(stock.thanDetails || []);

const MIN_FINAL_REPORT = -100;

const validateStockPayload = ({ type, lotNo, totalMeterReceived, second, unchecked, baleDetails, thanDetails }) => {
  if (!Number.isInteger(Number(lotNo)) || Number(lotNo) < 1) {
    return 'Lot number must be a positive whole number';
  }
  if (!Number.isFinite(Number(totalMeterReceived)) || toNum(totalMeterReceived) <= 0) {
    return 'Total meter received must be greater than 0';
  }

  if (hasMoreThanTwoDecimals(totalMeterReceived)) {
    return 'Total meter received must have at most 2 decimal places';
  }

  if (
    second !== undefined &&
    second !== null &&
    second !== '' &&
    (!Number.isFinite(Number(second)) || toNum(second) < 0 || hasMoreThanTwoDecimals(second))
  ) {
    return 'Second must be a non-negative number with at most 2 decimal places';
  }

  if (
    unchecked !== undefined &&
    unchecked !== null &&
    unchecked !== '' &&
    (!Number.isFinite(Number(unchecked)) || toNum(unchecked) < 0 || hasMoreThanTwoDecimals(unchecked))
  ) {
    return 'Unchecked must be a non-negative number with at most 2 decimal places';
  }

  const total = toNum(totalMeterReceived);
  const secondValue = toNum(second);
  const uncheckedValue = toNum(unchecked);

  try {
    if (type === 'regular') {
      const regularBales = Array.isArray(baleDetails) ? baleDetails : [];
      if (regularBales.length > MAX_BALE_ROWS) {
        return `Maximum ${MAX_BALE_ROWS} bale rows are allowed per stock entry`;
      }
      const baleTotal = regularBales.reduce((sum, bale) => {
        if (!bale.baleNo || !String(bale.baleNo).trim()) {
          throw new Error('Bale number is required for every bale row');
        }

        if (!Number.isFinite(Number(bale.meter)) || toNum(bale.meter) <= 0 || hasMoreThanTwoDecimals(bale.meter)) {
          throw new Error('Every bale meter must be greater than 0 with at most 2 decimal places');
        }

        return sum + toNum(bale.meter);
      }, 0);

      const finalReport = total - (baleTotal + secondValue + uncheckedValue);
      if (finalReport < MIN_FINAL_REPORT) {
        return 'Final report cannot be less than -100. Check bale total, second, and unchecked values';
      }
    }

    if (type === 'mix') {
      if (!Array.isArray(thanDetails) || thanDetails.length === 0) {
        return 'At least one than detail is required for Mix stock';
      }
      if (thanDetails.length > MAX_THAN_ROWS) {
        return `Maximum ${MAX_THAN_ROWS} than rows are allowed per stock entry`;
      }

      const thanTotal = thanDetails.reduce((sum, than) => {
        if (!Number.isFinite(Number(than.thanMeter)) || toNum(than.thanMeter) <= 0 || hasMoreThanTwoDecimals(than.thanMeter)) {
          throw new Error('Every than meter must be greater than 0 with at most 2 decimal places');
        }

        if (Array.isArray(than.baleDetails)) {
          if (than.baleDetails.length > MAX_MIX_BALE_ROWS_PER_THAN) {
            throw new Error(`Maximum ${MAX_MIX_BALE_ROWS_PER_THAN} bale rows are allowed per than`);
          }
          than.baleDetails.forEach((bale) => {
            if (!bale.baleNo || !String(bale.baleNo).trim()) {
              throw new Error('Bale number is required for every mix bale row');
            }

            if (!Number.isFinite(Number(bale.meter)) || toNum(bale.meter) <= 0 || hasMoreThanTwoDecimals(bale.meter)) {
              throw new Error('Every mix bale meter must be greater than 0 with at most 2 decimal places');
            }
          });
        }

        return sum + toNum(than.thanMeter);
      }, 0);

      if (thanTotal > total) {
        return 'Meter of total than cannot exceed total meter received';
      }

      const finalReport = total - (thanTotal + secondValue + uncheckedValue);
      if (finalReport < MIN_FINAL_REPORT) {
        return 'Final report cannot be less than -100. Check than total, second, and unchecked values';
      }
    }
  } catch (error) {
    return error.message;
  }

  return null;
};

// ─── Get all stocks ───────────────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, type, millId, qualityId, designId, search, uncheckedStatus, lotNo } = req.query;
    const parsedPage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), MAX_LIST_LIMIT);

    const filter = { isDeleted: false };
    if (type) filter.type = type;
    if (millId) filter.millId = millId;
    if (qualityId) filter.qualityId = qualityId;
    if (designId) filter.designId = designId;
    if (lotNo && !isNaN(Number(lotNo))) filter.lotNo = Number(lotNo);
    if (uncheckedStatus === 'yes') filter.unchecked = { $gt: 0 };
    if (uncheckedStatus === 'no') filter.unchecked = { $lte: 0 };
    if (search) {
      const safeRegex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { millName: safeRegex },
        { qualityName: safeRegex },
        { designName: safeRegex },
      ];
    }

    const total = await Stock.countDocuments(filter);
    const stocks = await Stock.find(filter)
      .select(
        '_id date millName qualityName designName lotNo type totalMeterReceived second unchecked baleDetails.billNo baleDetails.meter thanDetails.checked thanDetails.thanMeter createdAt'
      )
      .sort({ date: -1, createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean();

    const listItems = stocks.map((stock) => {
      const metrics = calculateStockMetrics(stock);
      return {
        _id: stock._id,
        date: stock.date,
        millName: stock.millName,
        qualityName: stock.qualityName,
        designName: stock.designName,
        lotNo: stock.lotNo,
        type: stock.type,
        totalMeterReceived: stock.totalMeterReceived,
        second: stock.second || 0,
        unchecked: stock.unchecked || 0,
        meterSold: metrics.meterSold,
        stockRemaining: metrics.stockRemaining,
        createdAt: stock.createdAt,
      };
    });

    res.json({
      success: true,
      data: listItems,
      pagination: { total, page: parsedPage, limit: parsedLimit, pages: Math.ceil(total / parsedLimit) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get single stock ─────────────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const stock = await Stock.findOne({ _id: req.params.id, isDeleted: false });
    if (!stock) return res.status(404).json({ success: false, message: 'Stock not found' });
    res.json({ success: true, data: stock });
  } catch (err) {
    next(err);
  }
};

// ─── Create stock ─────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { millId, qualityId, designId, type, baleDetails, thanDetails } = req.body;

    // Fetch names from master
    const [mill, quality, design] = await Promise.all([
      Mill.findById(millId),
      Quality.findById(qualityId),
      Design.findById(designId),
    ]);

    if (!mill || mill.isDeleted) return res.status(400).json({ success: false, message: 'Invalid Mill selected' });
    if (!quality || quality.isDeleted) return res.status(400).json({ success: false, message: 'Invalid Quality selected' });
    if (!design || design.isDeleted) return res.status(400).json({ success: false, message: 'Invalid Design selected' });

    // Validate than details
    if (type === 'mix') {
      if (!thanDetails || thanDetails.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one than detail is required for Mix stock' });
      }
    }

    const validationError = validateStockPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    // Assign sNo
    const normalizedBaleDetails = (baleDetails || []).map((b, i) => ({ ...b, sNo: i + 1 }));
    const normalizedThanDetails = (thanDetails || []).map((t, i) => ({
      ...t,
      sNo: i + 1,
      baleDetails: (t.baleDetails || []).map((b, j) => ({ ...b, sNo: j + 1 })),
    }));

    const stock = await Stock.create({
      ...req.body,
      millName: mill.name,
      qualityName: quality.name,
      designName: design.name,
      baleDetails: type === 'regular' ? normalizedBaleDetails : [],
      thanDetails: type === 'mix' ? normalizedThanDetails : [],
    });

    res.status(201).json({ success: true, data: stock, message: 'Stock added successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Update stock ─────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const stock = await Stock.findOne({ _id: req.params.id, isDeleted: false });
    if (!stock) return res.status(404).json({ success: false, message: 'Stock not found' });

    const { millId, qualityId, designId, type, baleDetails, thanDetails } = req.body;

    const [mill, quality, design] = await Promise.all([
      Mill.findById(millId),
      Quality.findById(qualityId),
      Design.findById(designId),
    ]);

    if (!mill || mill.isDeleted) return res.status(400).json({ success: false, message: 'Invalid Mill selected' });
    if (!quality || quality.isDeleted) return res.status(400).json({ success: false, message: 'Invalid Quality selected' });
    if (!design || design.isDeleted) return res.status(400).json({ success: false, message: 'Invalid Design selected' });

    if (type === 'mix' && (!thanDetails || thanDetails.length === 0)) {
      return res.status(400).json({ success: false, message: 'At least one than detail is required for Mix stock' });
    }

    const validationError = validateStockPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const normalizedBaleDetails = (baleDetails || []).map((b, i) => ({ ...b, sNo: i + 1 }));
    const normalizedThanDetails = (thanDetails || []).map((t, i) => ({
      ...t,
      sNo: i + 1,
      baleDetails: (t.baleDetails || []).map((b, j) => ({ ...b, sNo: j + 1 })),
    }));

    const updated = await Stock.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        millName: mill.name,
        qualityName: quality.name,
        designName: design.name,
        baleDetails: type === 'regular' ? normalizedBaleDetails : [],
        thanDetails: type === 'mix' ? normalizedThanDetails : [],
      },
      { new: true, runValidators: true }
    );

    res.json({ success: true, data: updated, message: 'Stock updated successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Soft delete stock ────────────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const stock = await Stock.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );
    if (!stock) return res.status(404).json({ success: false, message: 'Stock not found' });
    res.json({ success: true, message: 'Stock deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────
exports.getStats = async (req, res, next) => {
  try {
    const stocks = await Stock.find({ isDeleted: false })
      .select('type totalMeterReceived unchecked baleDetails.billNo baleDetails.meter thanDetails.checked thanDetails.thanMeter')
      .lean();

    let totalReceived = 0, totalSold = 0, totalInStock = 0;
    let regularCount = 0, mixCount = 0;

    stocks.forEach((s) => {
      totalReceived += s.totalMeterReceived || 0;
      const metrics = calculateStockMetrics(s);
      totalSold += metrics.meterSold;
      totalInStock += metrics.stockRemaining + (s.unchecked || 0);
      if (s.type === 'regular') {
        regularCount++;
      } else {
        mixCount++;
      }
    });

    res.json({
      success: true,
      data: {
        totalStocks: stocks.length,
        regularCount,
        mixCount,
        totalReceived: Number(totalReceived.toFixed(2)),
        totalSold: Number(totalSold.toFixed(2)),
        totalInStock: Number(totalInStock.toFixed(2)),
      },
    });
  } catch (err) {
    next(err);
  }
};
