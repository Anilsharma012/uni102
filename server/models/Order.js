const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  id: String,
  title: String,
  price: Number,
  qty: Number,
  image: String,
  variant: Object,
  size: String,
  productId: String,
});

const OrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String },
    phone: { type: String },
    address: { type: String },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pincode: { type: String, default: '' },
    paymentMethod: { type: String, enum: ['COD', 'UPI'], default: 'COD' },
    items: { type: [OrderItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    upi: {
      payerName: { type: String },
      txnId: { type: String },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Order', OrderSchema);
