const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const CustomCall = mongoose.model('CustomCall', new mongoose.Schema({
  name: String, phone: String, email: String,
  targetCollege: String, targetCourse: String, note: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
}));

router.post('/', async (req, res) => {
  try {
    const doc = await CustomCall.create(req.body);
    console.log(`[CUSTOM CALL] ${doc.name} (${doc.phone}) → ${doc.targetCourse} @ ${doc.targetCollege}`);
    res.json({ success: true, id: doc._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  const calls = await CustomCall.find().sort({ createdAt: -1 });
  res.json(calls);
});

router.patch('/:id/fulfill', async (req, res) => {
  await CustomCall.findByIdAndUpdate(req.params.id, { status: 'fulfilled' });
  res.json({ success: true });
});

module.exports = { router, CustomCall };