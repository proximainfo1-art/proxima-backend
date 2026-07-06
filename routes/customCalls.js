const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const CustomCallSchema = new mongoose.Schema({
  name: String, phone: String, email: String,
  targetCollege: String, targetCourse: String, note: String,
  status: { type: String, default: 'pending' },
  paymentId: { type: String, default: null },
  paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const CustomCall = mongoose.models.CustomCall || mongoose.model('CustomCall', CustomCallSchema);

// POST — create Razorpay order for custom call
router.post('/create-order', async (req, res) => {
  try {
    const { name } = req.body;
    const order = await razorpay.orders.create({
      amount: 39900, // ₹399 in paise
      currency: 'INR',
      receipt: `custom_${Date.now()}`,
      notes: { name },
    });
    res.json({ orderId: order.id, amount: order.amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — verify payment and save custom call
router.post('/verify-and-save', async (req, res) => {
  try {
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      name, phone, email, targetCollege, targetCourse, note
    } = req.body;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Save to DB only after payment verified
    const doc = await CustomCall.create({
      name, phone, email, targetCollege, targetCourse, note,
      paymentId: razorpay_payment_id,
      paymentStatus: 'paid',
      status: 'pending',
    });

    console.log(`[CUSTOM CALL PAID] ${doc.name} (${doc.phone}) → ${doc.targetCourse} @ ${doc.targetCollege} | Payment: ${razorpay_payment_id}`);
    res.json({ success: true, id: doc._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — all custom calls (admin)
router.get('/', async (req, res) => {
  const calls = await CustomCall.find({ paymentStatus: 'paid' }).sort({ createdAt: -1 });
  res.json(calls);
});

// PATCH — fulfill
router.patch('/:id/fulfill', async (req, res) => {
  await CustomCall.findByIdAndUpdate(req.params.id, { status: 'fulfilled' });
  res.json({ success: true });
});

module.exports = { router, CustomCall };