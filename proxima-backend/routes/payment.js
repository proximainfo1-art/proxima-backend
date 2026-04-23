const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

router.post("/create-order", async (req, res) => {
  try {
    const { amount, mentorId, slot, studentName } = req.body;
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: `proxima_${Date.now()}`,
      notes: { mentorId, slot, studentName },
    });
    res.json({ orderId: order.id, amount: order.amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }
    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;