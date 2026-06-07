const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// POST /api/payment/create-order
router.post('/create-order', async (req, res) => {
  try {
    const { amount, mentorId, slot, studentName } = req.body;
    const amountInPaise = Math.round(Number(amount) * 100);
    if (!amountInPaise || amountInPaise < 100) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: { mentorId, slot, studentName },
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Razorpay create-order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/payment/verify
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Signature mismatch' });
    }
    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (err) {
    console.error('Razorpay verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;