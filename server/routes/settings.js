const express = require('express');
const SiteSetting = require('../models/SiteSetting');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

async function ensureSettingsDoc() {
  let doc = await SiteSetting.findOne();
  if (!doc) {
    doc = await SiteSetting.create({});
  }
  return doc;
}

function toClient(doc) {
  const obj = doc.toObject({ versionKey: false });
  obj.id = obj._id.toString();
  delete obj._id;
  return obj;
}

function publicAssetUrl(req, value) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        return `/api${u.pathname}`;
      }
    } catch {}
    return raw;
  }

  if (raw.startsWith('/uploads')) return `/api${raw}`;
  if (raw.startsWith('uploads')) return `/api/${raw}`;

  return raw;
}

// Public home settings (ticker, feature rows, etc)
router.get('/home', async (req, res) => {
  try {
    const doc = await ensureSettingsDoc();
    const home = (doc.home || {});
    const items = Array.isArray(home.ticker) ? home.ticker.map((it) => ({
      id: String(it.id || ''),
      text: String(it.text || ''),
      url: it.url ? String(it.url) : '',
      startAt: it.startAt || null,
      endAt: it.endAt || null,
      priority: Number(it.priority || 0),
    })) : [];
    const featureRows = Array.isArray(home.featureRows) ? home.featureRows.map((fr) => ({
      key: String(fr.key || ''),
      title: String(fr.title || ''),
      link: String(fr.link || ''),
      imageAlt: String(fr.imageAlt || ''),
    })) : [];
    const newArrivalsLimit = Number((home.newArrivalsLimit ?? 0)) || undefined;
    return res.json({ ok: true, data: { ticker: items, featureRows, newArrivalsLimit, updatedAt: doc.updatedAt } });
  } catch (error) {
    console.error('Failed to load home settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Admin: edit home settings (ticker, feature rows, etc)
router.patch('/home', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const set = {};

    if (body.home && typeof body.home === 'object') {
      const home = body.home;

      if (Array.isArray(home.ticker)) {
        const ticker = home.ticker.map((it) => ({
          id: String(it.id || ''),
          text: String(it.text || ''),
          url: String(it.url || ''),
          startAt: it.startAt ? new Date(it.startAt) : null,
          endAt: it.endAt ? new Date(it.endAt) : null,
          priority: Number(it.priority || 0),
        }));
        set['home.ticker'] = ticker;
      }

      if (Array.isArray(home.featureRows)) {
        const featureRows = home.featureRows.map((fr) => ({
          key: String(fr.key || ''),
          title: String(fr.title || ''),
          link: String(fr.link || ''),
          imageAlt: String(fr.imageAlt || ''),
        }));
        set['home.featureRows'] = featureRows;
      }

      if (typeof home.newArrivalsLimit === 'number') {
        set['home.newArrivalsLimit'] = Math.max(1, home.newArrivalsLimit);
      }
    }

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields supplied' });
    }

    const doc = await SiteSetting.findOneAndUpdate({}, { $set: set }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    return res.json({ ok: true, data: toClient(doc) });
  } catch (error) {
    console.error('Failed to update home settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Admin-only full settings
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await ensureSettingsDoc();
    return res.json({ ok: true, data: toClient(doc) });
  } catch (error) {
    console.error('Failed to load settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Public payments settings for checkout
router.get('/payments', async (req, res) => {
  try {
    const doc = await ensureSettingsDoc();
    const p = (doc.payment || {});
    const out = {
      upiQrImage: publicAssetUrl(req, p.upiQrImage || ''),
      upiId: p.upiId || '',
      beneficiaryName: p.beneficiaryName || '',
      instructions: p.instructions || 'Scan QR and pay. Enter UTR/Txn ID on next step.',
      updatedAt: doc.updatedAt,
    };
    return res.json({ ok: true, data: out });
  } catch (error) {
    console.error('Failed to load payment settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Public business settings for invoices
router.get('/business', async (req, res) => {
  try {
    const doc = await ensureSettingsDoc();
    const b = (doc.business || {});
    const out = {
      name: b.name || 'UNI10',
      logo: publicAssetUrl(req, b.logo || ''),
      address: b.address || '',
      phone: b.phone || '',
      email: b.email || '',
      gstIn: b.gstIn || '',
    };
    return res.json({ ok: true, data: out });
  } catch (error) {
    console.error('Failed to load business settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Public contact settings for Contact page
router.get('/contact', async (req, res) => {
  try {
    const doc = await ensureSettingsDoc();
    const c = (doc.contact || {});
    const out = {
      phones: Array.isArray(c.phones) ? c.phones : [],
      emails: Array.isArray(c.emails) ? c.emails : [],
      address: c.address || {},
      mapsUrl: c.mapsUrl || '',
      updatedAt: doc.updatedAt,
    };
    return res.json({ ok: true, data: out });
  } catch (error) {
    console.error('Failed to load contact settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

router.put('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const set = {};

    if (typeof body.domain === 'string') {
      const trimmed = body.domain.trim();
      if (trimmed) set.domain = trimmed;
    }

    if (body.business && typeof body.business === 'object') {
      const business = body.business;
      if (typeof business.name === 'string') set['business.name'] = business.name.trim();
      if (typeof business.logo === 'string') set['business.logo'] = business.logo.trim();
      if (typeof business.address === 'string') set['business.address'] = business.address.trim();
      if (typeof business.phone === 'string') set['business.phone'] = business.phone.trim();
      if (typeof business.email === 'string') set['business.email'] = business.email.trim();
      if (typeof business.gstIn === 'string') set['business.gstIn'] = business.gstIn.trim();
    }

    if (body.payment && typeof body.payment === 'object') {
      const payment = body.payment;
      if (typeof payment.upiQrImage === 'string') set['payment.upiQrImage'] = payment.upiQrImage.trim();
      if (typeof payment.upiId === 'string') set['payment.upiId'] = payment.upiId.trim();
      if (typeof payment.beneficiaryName === 'string') set['payment.beneficiaryName'] = payment.beneficiaryName.trim();
      if (typeof payment.instructions === 'string') set['payment.instructions'] = payment.instructions.trim();
    }

    if (body.shipping && typeof body.shipping === 'object') {
      const shipping = body.shipping;
      if (shipping.shiprocket && typeof shipping.shiprocket === 'object') {
        const shiprocket = shipping.shiprocket;
        if (typeof shiprocket.enabled === 'boolean') set['shipping.shiprocket.enabled'] = shiprocket.enabled;
        if (typeof shiprocket.email === 'string') set['shipping.shiprocket.email'] = shiprocket.email.trim();
        if (typeof shiprocket.password === 'string') set['shipping.shiprocket.password'] = shiprocket.password; // keep exact value
        if (typeof shiprocket.apiKey === 'string') set['shipping.shiprocket.apiKey'] = shiprocket.apiKey.trim();
        if (typeof shiprocket.secret === 'string') set['shipping.shiprocket.secret'] = shiprocket.secret.trim();
        if (typeof shiprocket.channelId === 'string') set['shipping.shiprocket.channelId'] = shiprocket.channelId.trim();
      }
    }

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields supplied' });
    }

    const doc = await SiteSetting.findOneAndUpdate({}, { $set: set }, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    return res.json({ ok: true, data: toClient(doc) });
  } catch (error) {
    console.error('Failed to update settings', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
