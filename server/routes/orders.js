const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const { authOptional, requireAuth, requireAdmin } = require('../middleware/auth');
const { sendOrderConfirmationEmail, sendStatusUpdateEmail, sendReturnApprovalEmail, sendCustomEmail } = require('../utils/emailService');

const ALLOWED_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

// Create order
router.post('/', authOptional, async (req, res) => {
  try {
    const body = req.body || {};

    const name = body.name || body.customer?.name || '';
    const phone = body.phone || body.customer?.phone || '';
    const address = body.address || body.customer?.address || '';
    const city = body.city || body.customer?.city || '';
    const state = body.state || body.customer?.state || '';
    const pincode = body.pincode || body.customer?.pincode || '';
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, message: 'No items' });

    if (!city || !state || !pincode) return res.status(400).json({ ok: false, message: 'City, state and pincode are required' });
    const pinOk = /^\d{4,8}$/.test(String(pincode));
    if (!pinOk) return res.status(400).json({ ok: false, message: 'Invalid pincode' });

    // compute total server-side if not supplied or invalid
    const computed = items.reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0), 0);
    const total = typeof body.total === 'number' && body.total > 0 ? body.total : computed;

    const paymentMethod = (body.paymentMethod || body.payment || 'COD').toString();

    let status = 'pending';
    if (typeof body.status === 'string' && ALLOWED_STATUSES.includes(body.status)) {
      status = body.status;
    }

    const upi = (paymentMethod === 'UPI' && body.upi && typeof body.upi === 'object')
      ? { payerName: body.upi.payerName || '', txnId: body.upi.txnId || '' }
      : undefined;

    // Decrement inventory for each item with per-size tracking
    const Product = require('../models/Product');
    for (const item of items) {
      if (item.id || item.productId) {
        const productId = item.id || item.productId;
        const product = await Product.findById(productId);
        if (product) {
          // If the product has per-size inventory and the item has a size
          if (product.trackInventoryBySize && item.size && Array.isArray(product.sizeInventory)) {
            const sizeIdx = product.sizeInventory.findIndex(s => s.code === item.size);
            if (sizeIdx !== -1) {
              const currentQty = product.sizeInventory[sizeIdx].qty;
              const requestedQty = Number(item.qty || 1);

              // Check if enough stock
              if (currentQty < requestedQty) {
                return res.status(409).json({
                  ok: false,
                  message: `Insufficient stock for ${product.title} size ${item.size}`,
                  itemId: item.id || item.productId,
                  availableQty: currentQty
                });
              }

              // Decrement the size inventory
              product.sizeInventory[sizeIdx].qty -= requestedQty;
              await product.save();
            }
          } else if (!product.trackInventoryBySize) {
            // Decrement general stock
            const currentStock = product.stock || 0;
            const requestedQty = Number(item.qty || 1);
            if (currentStock < requestedQty) {
              return res.status(409).json({
                ok: false,
                message: `Insufficient stock for ${product.title}`,
                itemId: item.id || item.productId,
                availableQty: currentStock
              });
            }
            product.stock -= requestedQty;
            await product.save();
          }
        }
      }
    }

    const doc = new Order({
      userId: req.user ? req.user._id : undefined,
      name,
      phone,
      address,
      paymentMethod,
      address,
      city,
      state,
      pincode,
      items,
      total,
      status,
      upi,
    });

    await doc.save();
    return res.json({ ok: true, data: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// List orders for current user (mine=1) or admin all
router.get('/', authOptional, async (req, res) => {
  try {
    const { mine } = req.query;
    if (mine && String(mine) === '1') {
      if (!req.user) return res.status(401).json({ ok: false, message: 'Unauthorized' });
      const docs = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
      return res.json({ ok: true, data: docs });
    }

    // admin list
    if (!req.user) return res.status(401).json({ ok: false, message: 'Unauthorized' });
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, message: 'Forbidden' });
    const docs = await Order.find().sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, data: docs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Alias: GET /api/orders/mine
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const docs = await Order.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, data: docs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Get one order (owner or admin)
router.get('/:id', authOptional, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Order.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Not found' });
    if (req.user && (String(req.user._id) === String(doc.userId) || req.user.role === 'admin')) {
      return res.json({ ok: true, data: doc });
    }
    return res.status(403).json({ ok: false, message: 'Forbidden' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Update status (admin only)
router.put('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ ok: false, message: 'Missing status' });
    if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ ok: false, message: 'Invalid status' });
    const order = await Order.findById(id).populate('userId');
    if (!order) return res.status(404).json({ ok: false, message: 'Not found' });

    const previousStatus = order.status;
    order.status = status;
    await order.save();

    // Send email on status change
    if (status !== previousStatus && order.userId && order.userId.email) {
      const user = order.userId;
      if (status === 'shipped' || status === 'delivered') {
        await sendStatusUpdateEmail(order, user, status);
      }
    }

    return res.json({ ok: true, data: order });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Alternate update route to support Admin UI (PUT /api/orders/:id { status })
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let { status } = req.body || {};
    if (!status) return res.status(400).json({ ok: false, message: 'Missing status' });
    // Map common aliases from UI
    const map = { processing: 'paid', completed: 'delivered' };
    status = map[status] || status;
    if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ ok: false, message: 'Invalid status' });
    const doc = await Order.findByIdAndUpdate(id, { status }, { new: true }).lean();
    if (!doc) return res.status(404).json({ ok: false, message: 'Not found' });
    return res.json({ ok: true, data: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Cancel order (user or admin)
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found' });
    }

    // Check authorization: user can cancel their own order, admin can cancel any
    if (String(order.userId) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    // Can only cancel if status is pending, cod_pending, or pending_verification
    const cancellableStatuses = ['pending', 'cod_pending', 'pending_verification'];
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(400).json({ ok: false, message: 'Order cannot be cancelled in current status' });
    }

    order.status = 'cancelled';
    if (reason) order.cancellationReason = reason;
    await order.save();

    return res.json({ ok: true, data: order });
  } catch (e) {
    console.error('Cancel order error:', e);
    return res.status(500).json({ ok: false, message: 'Failed to cancel order' });
  }
});

// Send order confirmation email
router.post('/:id/email', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate('userId');

    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found' });
    }

    // Check authorization
    if (String(order.userId._id) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    const user = order.userId;
    const result = await sendOrderConfirmationEmail(order, user);

    if (result.ok) {
      return res.json({ ok: true, message: 'Confirmation email sent', messageId: result.messageId });
    } else {
      return res.status(500).json({ ok: false, message: result.error });
    }
  } catch (e) {
    console.error('Send email error:', e);
    return res.status(500).json({ ok: false, message: 'Failed to send email' });
  }
});

// Request return
router.post('/:id/request-return', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!reason || !reason.trim()) {
      return res.status(400).json({ ok: false, message: 'Return reason is required' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found' });
    }

    // Check authorization
    if (String(order.userId) !== String(req.user._id)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    // Can only request return if order is delivered
    if (order.status !== 'delivered') {
      return res.status(400).json({ ok: false, message: 'Return can only be requested for delivered orders' });
    }

    order.returnReason = reason.trim();
    order.returnStatus = 'Pending';
    await order.save();

    return res.json({ ok: true, data: order, message: 'Return request submitted' });
  } catch (e) {
    console.error('Request return error:', e);
    return res.status(500).json({ ok: false, message: 'Failed to submit return request' });
  }
});

// Admin: Update order (status, tracking number, return approval)
router.put('/:id/admin-update', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, trackingNumber, returnStatus } = req.body || {};

    const order = await Order.findById(id).populate('userId');
    if (!order) {
      return res.status(404).json({ ok: false, message: 'Order not found' });
    }

    const previousStatus = order.status;

    // Update status if provided
    if (status && ALLOWED_STATUSES.includes(status)) {
      order.status = status;
    }

    // Update tracking number if provided
    if (trackingNumber) {
      order.trackingNumber = trackingNumber.trim();
    }

    // Update return status if provided
    if (returnStatus && ['None', 'Pending', 'Approved', 'Rejected'].includes(returnStatus)) {
      order.returnStatus = returnStatus;
    }

    await order.save();

    // Send email on status change
    if (status && status !== previousStatus && order.userId && order.userId.email) {
      const user = order.userId;
      if (status === 'shipped' || status === 'delivered') {
        await sendStatusUpdateEmail(order, user, status);
      }
    }

    // Send email on return approval
    if (returnStatus === 'Approved' && order.returnStatus === 'Approved' && order.userId && order.userId.email) {
      const user = order.userId;
      await sendReturnApprovalEmail(order, user);
    }

    return res.json({ ok: true, data: order, message: 'Order updated successfully' });
  } catch (e) {
    console.error('Admin update order error:', e);
    return res.status(500).json({ ok: false, message: 'Failed to update order' });
  }
});

// Send custom email
router.post('/send-mail', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, subject, html } = req.body || {};

    if (!to || !subject || !html) {
      return res.status(400).json({ ok: false, message: 'Missing required fields: to, subject, html' });
    }

    const result = await sendCustomEmail(to, subject, html);

    if (result.ok) {
      return res.json({ ok: true, message: 'Email sent', messageId: result.messageId });
    } else {
      return res.status(500).json({ ok: false, message: result.error });
    }
  } catch (e) {
    console.error('Send mail error:', e);
    return res.status(500).json({ ok: false, message: 'Failed to send email' });
  }
});

// Get invoice for download
router.get('/:id/invoice', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate('userId');
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });

    // Check authorization
    if (String(order.userId?._id) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }

    // Generate a simple HTML invoice that can be printed as PDF
    const orderDate = new Date(order.createdAt).toLocaleDateString('en-IN');
    const itemsHtml = order.items
      .map((item, idx) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${idx + 1}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.title}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.qty}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">₹${item.price}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">₹${item.price * item.qty}</td>
        </tr>
      `)
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Invoice</title>
        <style>
          body { font-family: Arial, sans-serif; color: #333; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }
          .logo { font-size: 28px; font-weight: bold; color: #333; }
          .invoice-title { text-align: right; }
          .invoice-title h2 { margin: 0; font-size: 24px; color: #333; }
          .invoice-title p { margin: 5px 0 0 0; color: #666; font-size: 14px; }
          .section { margin-bottom: 30px; }
          .section-title { font-weight: bold; font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 10px; }
          .section-content { font-size: 14px; line-height: 1.6; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f5f5f5; padding: 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #ddd; font-size: 13px; }
          td { padding: 10px; font-size: 13px; }
          .summary { margin-left: auto; width: 300px; margin-top: 20px; }
          .summary-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .summary-row.total { border-bottom: 2px solid #333; margin-top: 10px; font-weight: bold; font-size: 16px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">UNI10</div>
            <div class="invoice-title">
              <h2>Invoice</h2>
              <p>Order #${(id || '').slice(0, 8)}</p>
            </div>
          </div>

          <div style="display: flex; gap: 60px; margin-bottom: 30px;">
            <div class="section">
              <div class="section-title">Bill To</div>
              <div class="section-content">
                <strong>${order.name || 'N/A'}</strong><br>
                ${order.address || ''}<br>
                ${order.city || ''}, ${order.state || ''} ${order.pincode || ''}<br>
                Phone: ${order.phone || 'N/A'}<br>
                Email: ${order.userId?.email || 'N/A'}
              </div>
            </div>
            <div class="section">
              <div class="section-title">Invoice Details</div>
              <div class="section-content">
                <strong>Invoice Date:</strong> ${orderDate}<br>
                <strong>Order Date:</strong> ${orderDate}<br>
                <strong>Payment Method:</strong> ${order.paymentMethod || 'N/A'}<br>
                ${order.upi?.txnId ? `<strong>Transaction ID:</strong> ${order.upi.txnId}<br>` : ''}
                <strong>Status:</strong> ${order.status || 'Pending'}
              </div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 5%">#</th>
                <th style="width: 50%">Item Description</th>
                <th style="width: 15%; text-align: center;">Qty</th>
                <th style="width: 15%; text-align: right;">Price</th>
                <th style="width: 15%; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <div class="summary">
            <div class="summary-row">
              <span>Subtotal:</span>
              <span>₹${order.subtotal || order.total || 0}</span>
            </div>
            ${order.discount ? `<div class="summary-row"><span>Discount:</span><span>-₹${order.discount}</span></div>` : ''}
            ${order.tax ? `<div class="summary-row"><span>Tax:</span><span>₹${order.tax}</span></div>` : ''}
            ${order.shipping ? `<div class="summary-row"><span>Shipping:</span><span>₹${order.shipping}</span></div>` : ''}
            <div class="summary-row total">
              <span>Total Amount:</span>
              <span>₹${order.total || 0}</span>
            </div>
          </div>

          <div class="footer">
            <p>Thank you for your order! If you have any questions, please contact us.</p>
            <p>© 2024 UNI10. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Return HTML that can be converted to PDF by the client
    return res.json({
      ok: true,
      data: {
        html,
        pdfUrl: `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
        orderId: id,
      },
    });
  } catch (e) {
    console.error('Get invoice error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// List return requests (admin only)
router.get('/admin/return-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { returnStatus: 'Pending' },
        { returnStatus: 'Approved' },
        { returnStatus: 'Rejected' },
      ],
    })
      .populate('userId', 'name email')
      .sort({ updatedAt: -1 })
      .lean();

    const returnRequests = orders
      .filter((o) => o.returnStatus && o.returnStatus !== 'None')
      .map((o) => ({
        _id: o._id,
        orderId: String(o._id).slice(0, 8),
        userEmail: o.userId?.email || 'N/A',
        userName: o.userId?.name || 'N/A',
        reason: o.returnReason || 'No reason provided',
        status: o.returnStatus,
        date: o.updatedAt || o.createdAt,
        items: o.items,
        total: o.total,
        order: o,
      }));

    return res.json({ ok: true, data: returnRequests });
  } catch (e) {
    console.error('List return requests error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Approve return request (admin only)
router.post('/:id/approve-return', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate('userId');
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });

    if (order.returnStatus !== 'Pending') {
      return res.status(400).json({ ok: false, message: 'Return request is not pending' });
    }

    order.returnStatus = 'Approved';
    await order.save();

    // Send approval email
    if (order.userId && order.userId.email) {
      await sendReturnApprovalEmail(order, order.userId, 'Approved');
    }

    return res.json({ ok: true, data: order, message: 'Return request approved' });
  } catch (e) {
    console.error('Approve return error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Reject return request (admin only)
router.post('/:id/reject-return', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const order = await Order.findById(id).populate('userId');
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });

    if (order.returnStatus !== 'Pending') {
      return res.status(400).json({ ok: false, message: 'Return request is not pending' });
    }

    order.returnStatus = 'Rejected';
    if (reason) order.rejectionReason = reason;
    await order.save();

    // Send rejection email
    if (order.userId && order.userId.email) {
      await sendReturnApprovalEmail(order, order.userId, 'Rejected', reason);
    }

    return res.json({ ok: true, data: order, message: 'Return request rejected' });
  } catch (e) {
    console.error('Reject return error:', e);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

module.exports = router;
