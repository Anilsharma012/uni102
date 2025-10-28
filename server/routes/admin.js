const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const SiteSetting = require('../models/SiteSetting');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const nodemailer = require('nodemailer');

// GET /api/admin/stats/overview?range=7d|30d|90d
router.get('/stats/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const range = String(req.query.range || '30d').toLowerCase();
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;

    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    // Totals
    const [totalRevenueAgg, totalOrders, totalUsers] = await Promise.all([
      Order.aggregate([{ $group: { _id: null, total: { $sum: { $ifNull: ['$total', 0] } } } }]),
      Order.countDocuments(),
      User.countDocuments(),
    ]);
    const totals = {
      revenue: (totalRevenueAgg[0]?.total || 0),
      orders: totalOrders || 0,
      users: totalUsers || 0,
    };

    // Last month and previous month comparisons (calendar months)
    const now = new Date();
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 1);
    const prevMonthEnd = new Date(firstOfLastMonth.getTime() - 1);

    const [lastMonthAgg, prevMonthAgg, lastMonthOrdersCount, prevMonthOrdersCount] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: firstOfLastMonth, $lte: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$total', 0] } } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: firstOfPrevMonth, $lte: prevMonthEnd } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$total', 0] } } } },
      ]),
      Order.countDocuments({ createdAt: { $gte: firstOfLastMonth, $lte: lastMonthEnd } }),
      Order.countDocuments({ createdAt: { $gte: firstOfPrevMonth, $lte: prevMonthEnd } }),
    ]);

    const lastMonth = { revenue: lastMonthAgg[0]?.total || 0, orders: lastMonthOrdersCount || 0 };
    const prevMonth = { revenue: prevMonthAgg[0]?.total || 0, orders: prevMonthOrdersCount || 0 };

    // Series for selected range (daily revenue and orders)
    const seriesAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: { $ifNull: ['$total', 0] } },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill missing dates with zeros
    const fillSeries = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const found = seriesAgg.find((d) => d._id === key);
      fillSeries.push({ date: key, revenue: found?.revenue || 0, orders: found?.orders || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    return res.json({ ok: true, data: { totals, lastMonth, prevMonth, series: fillSeries } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// GET /api/admin/orders/:id -> enriched order detail
router.get('/orders/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Order.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Not found' });

    const address = String(doc.address || '');

    function deriveFromAddress(addr) {
      try {
        const a = String(addr || '');
        const pinMatch = a.match(/(\d{6})(?!.*\d)/);
        const pincode = pinMatch ? pinMatch[1] : '';
        const cleaned = pinMatch ? a.replace(pinMatch[1], '') : a;
        const parts = cleaned.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
        const city = parts.length ? parts[parts.length - 1].replace(/[^A-Za-z\s]/g, '').trim() : '';
        return { city, pincode };
      } catch {
        return { city: '', pincode: '' };
      }
    }

    const derived = deriveFromAddress(address);

    const detail = {
      id: String(doc._id),
      createdAt: doc.createdAt,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      totals: { total: Number(doc.total || 0) },
      shipping: {
        name: doc.name || '',
        phone: doc.phone || '',
        address1: address,
        address2: '',
        city: doc.city || derived.city || '',
        state: (doc.state && String(doc.state).trim()) ? doc.state : '',
        pincode: (doc.pincode && String(doc.pincode).trim()) ? doc.pincode : derived.pincode || '',
      },
      items: Array.isArray(doc.items)
        ? doc.items.map((it) => ({
            productId: it.id || it.productId || '',
            title: it.title || it.name || 'Item',
            image: it.image || '',
            price: Number(it.price || 0),
            qty: Number(it.qty || 0),
            variant: it.variant || null,
          }))
        : [],
    };

    return res.json({ ok: true, data: detail });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// POST /api/admin/invoices/generate - Generate invoice for an order
router.post('/invoices/generate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ ok: false, message: 'Missing orderId' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });

    // Check if invoice already exists (idempotent)
    let invoice = await Invoice.findOne({ orderId });
    if (invoice) {
      return res.json({ ok: true, data: { invoiceId: invoice._id.toString(), invoiceNo: invoice.invoiceNo } });
    }

    // Generate invoice number: INV-YYYYMMDD-0001 (or next available)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await Invoice.countDocuments({
      createdAt: {
        $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        $lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
      },
    });
    const invoiceNo = `INV-${dateStr}-${String(countToday + 1).padStart(4, '0')}`;

    // Create invoice
    invoice = new Invoice({
      orderId,
      invoiceNo,
      issuedAt: new Date(),
      status: 'issued',
    });
    await invoice.save();

    // Link invoice to order
    order.invoiceId = invoice._id;
    await order.save();

    return res.json({ ok: true, data: { invoiceId: invoice._id.toString(), invoiceNo: invoice.invoiceNo } });
  } catch (e) {
    console.error('Generate invoice error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// PATCH /api/admin/settings/home - replace the ticker array
router.patch('/settings/home', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const incoming = Array.isArray(body.ticker) ? body.ticker : [];

    const sanitized = incoming
      .filter((x) => x && typeof x.text === 'string' && x.text.trim().length > 0)
      .map((x, idx) => {
        const out = {
          id: String(x.id || `t_${Date.now()}_${idx}`),
          text: String(x.text).trim(),
          url: typeof x.url === 'string' ? x.url.trim() : '',
          startAt: undefined,
          endAt: undefined,
          priority: Number(x.priority || 0),
        };
        if (x.startAt) {
          const d = new Date(x.startAt);
          if (!isNaN(d.getTime())) out.startAt = d;
        }
        if (x.endAt) {
          const d2 = new Date(x.endAt);
          if (!isNaN(d2.getTime())) out.endAt = d2;
        }
        return out;
      });

    const set = { 'home.ticker': sanitized };

    const nLimit = Number(body.newArrivalsLimit);
    if (!Number.isNaN(nLimit) && nLimit > 0) {
      set['home.newArrivalsLimit'] = Math.min(100, Math.floor(nLimit));
    }

    const doc = await SiteSetting.findOneAndUpdate({}, { $set: set }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    const home = (doc.home || {});
    const items = Array.isArray(home.ticker) ? home.ticker.map((it) => ({
      id: String(it.id || ''),
      text: String(it.text || ''),
      url: it.url ? String(it.url) : '',
      startAt: it.startAt || null,
      endAt: it.endAt || null,
      priority: Number(it.priority || 0),
    })) : [];

    return res.json({ ok: true, data: { ticker: items, updatedAt: doc.updatedAt } });
  } catch (e) {
    console.error('Failed to update home ticker', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// PATCH /api/admin/settings/contact - replace contact settings
router.patch('/settings/contact', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const set = {};

    if (body.phones && Array.isArray(body.phones)) {
      set['contact.phones'] = body.phones.map(String);
    }
    if (body.emails && Array.isArray(body.emails)) {
      set['contact.emails'] = body.emails.map(String);
    }
    if (body.address && typeof body.address === 'object') {
      const a = body.address;
      if (typeof a.line1 === 'string') set['contact.address.line1'] = a.line1.trim();
      if (typeof a.line2 === 'string') set['contact.address.line2'] = a.line2.trim();
      if (typeof a.city === 'string') set['contact.address.city'] = a.city.trim();
      if (typeof a.state === 'string') set['contact.address.state'] = a.state.trim();
      if (typeof a.pincode === 'string') set['contact.address.pincode'] = a.pincode.trim();
    }
    if (typeof body.mapsUrl === 'string') set['contact.mapsUrl'] = body.mapsUrl.trim();

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields supplied' });
    }

    const doc = await SiteSetting.findOneAndUpdate({}, { $set: set }, { new: true, upsert: true, setDefaultsOnInsert: true });
    const out = doc.contact || {};
    return res.json({ ok: true, data: out });
  } catch (e) {
    console.error('Failed to update contact settings', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// POST /api/admin/notify - send admin notifications to selected users
router.post('/notify', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userIds, message, subject } = req.body || {};

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ ok: false, message: 'userIds is required' });
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ ok: false, message: 'message is required' });
    }

    const ids = userIds.map(String);
    const users = await User.find({ _id: { $in: ids } }).select('name email').lean();
    const emails = Array.isArray(users) ? users.map((u) => u.email).filter(Boolean) : [];

    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASSWORD;

    if (gmailUser && gmailPass && emails.length > 0) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });

      await transporter.sendMail({
        from: gmailUser,
        to: gmailUser,
        bcc: emails.join(', '),
        subject: (typeof subject === 'string' && subject.trim()) ? subject.trim() : 'Admin Notification',
        text: String(message),
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${String(message).replace(/\n/g, '<br>')}</div>`,
      });

      return res.json({ ok: true, data: { sent: emails.length, recipients: emails } });
    }

    console.log('Email not configured or no recipients. Simulating notification send.', {
      ids,
      emails,
      subject: (typeof subject === 'string' && subject.trim()) ? subject.trim() : 'Admin Notification',
      preview: String(message).slice(0, 200),
    });
    return res.json({ ok: true, data: { sent: 0, recipients: emails }, message: 'Simulated send (email not configured)' });
  } catch (e) {
    console.error('Notify error:', e);
    return res.status(500).json({ ok: false, message: 'Failed to send notifications' });
  }
});

const Review = require('../models/Review');

// Admin: reply to user review (mirror endpoint for /api/admin)
router.post('/reviews/reply', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { reviewId, text } = req.body || {};
    if (!reviewId || !text || !String(text).trim()) {
      return res.status(400).json({ ok: false, message: 'reviewId and text are required' });
    }
    const sanitize = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    const review = await Review.findById(reviewId);
    if (!review) return res.status(404).json({ ok: false, message: 'Review not found' });
    review.replies = Array.isArray(review.replies) ? review.replies : [];
    review.replies.push({ authorId: req.user._id, text: sanitize(String(text).slice(0,2000)), createdAt: new Date() });
    await review.save();
    const updated = await Review.findById(review._id).populate('userId','name email').populate('replies.authorId','name email role').lean();
    return res.json({ ok: true, data: updated });
  } catch (e) {
    console.error('Admin reply error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
