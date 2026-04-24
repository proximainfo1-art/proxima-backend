require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = "Kusu@Manku0430";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/proxima";
const PORT = process.env.PORT || 5000;

// ─── DB ───────────────────────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI).then(() => console.log("MongoDB connected")).catch(console.error);

// ─── SCHEMAS ─────────────────────────────────────────────────────────────────
const SlotSchema = new mongoose.Schema({ day: String, time: String, display: String, status: { type: String, default: "available" }, outsideSchedule: { type: Boolean, default: false } });

const MentorSchema = new mongoose.Schema({
  name: String, college: String, course: String, year: String,
  bio: String, photo: String, email: String, whatsapp: String,
  price: { type: Number, default: 299 }, rating: { type: Number, default: 5 },
  sessions: { type: Number, default: 0 }, credits: { type: Number, default: 0 },
  referralCode: String, pin: { type: String, default: "0000" },
  visible: { type: Boolean, default: true },
  slots: [SlotSchema],
}, { timestamps: true });

const BookingSchema = new mongoose.Schema({
  mentorId: String, mentorName: String, slot: String,
  studentName: String, studentEmail: String, studentPhone: String,
  referralCode: String, message: String,
  notes: String, meetLink: String, meetSent: { type: Boolean, default: false },
  paymentId: { type: String, default: null },
  paymentStatus: { type: String, enum: ["pending", "paid"], default: "pending" },
}, { timestamps: true });

const RegistrationSchema = new mongoose.Schema({
  name: String, college: String, course: String, year: String,
  email: String, whatsapp: String, bio: String, photo: String,
  status: { type: String, default: "pending" },
}, { timestamps: true });

const Mentor = mongoose.model("Mentor", MentorSchema);
const Booking = mongoose.model("Booking", BookingSchema);
const Registration = mongoose.model("Registration", RegistrationSchema);

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ error: "Invalid password" });
});

// Mentor login
app.post("/api/mentor/login", async (req, res) => {
  const { email, pin } = req.body;
  const mentor = await Mentor.findOne({ email: email.toLowerCase().trim(), pin });
  if (!mentor) return res.status(401).json({ error: "Invalid email or PIN" });
  res.json(mentor);
});

// GET mentors
app.get("/api/mentors", async (req, res) => {
  const query = req.query.all === "true" ? {} : { visible: true };
  const mentors = await Mentor.find(query).sort({ createdAt: -1 });
  res.json(mentors);
});

// POST mentor (admin add)
app.post("/api/mentors", async (req, res) => {
  const mentor = await Mentor.create({ ...req.body, email: req.body.email?.toLowerCase()?.trim() });
  res.json(mentor);
});

// PUT mentor (admin edit)
app.put("/api/mentors/:id", async (req, res) => {
  const mentor = await Mentor.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(mentor);
});

// DELETE mentor
app.delete("/api/mentors/:id", async (req, res) => {
  await Mentor.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// PUT mentor slots
app.put("/api/mentors/:id/slots", async (req, res) => {
  const { slots: newSlots } = req.body;
  const mentor = await Mentor.findById(req.params.id);
  if (!mentor) return res.status(404).json({ error: "Mentor not found" });

  const bookedSlots = mentor.slots.filter(s => s.status === "booked");
  const newSlotDisplays = new Set(newSlots.map(s => s.display));

  const preservedBooked = bookedSlots.map(s => ({
    ...s.toObject(),
    outsideSchedule: !newSlotDisplays.has(s.display),
  }));

  const freshSlots = newSlots.filter(s => !bookedSlots.some(b => b.display === s.display));
  mentor.slots = [...preservedBooked, ...freshSlots];
  await mentor.save();
  res.json(mentor);
});

// GET mentor slots
app.get("/api/mentors/:id/slots", async (req, res) => {
  const mentor = await Mentor.findById(req.params.id);
  res.json(mentor?.slots || []);
});

// PUT mentor credits
app.put("/api/mentors/:id/credits", async (req, res) => {
  const { amount } = req.body;
  const mentor = await Mentor.findByIdAndUpdate(req.params.id, { $inc: { credits: amount } }, { new: true });
  res.json(mentor);
});

// POST booking
app.post("/api/bookings", async (req, res) => {
  const { mentorId, slot, referralCode, ...rest } = req.body;

  // Mark slot as booked
  const mentor = await Mentor.findById(mentorId);
  if (!mentor) return res.status(404).json({ error: "Mentor not found" });

  const slotIdx = mentor.slots.findIndex(s => s.display === slot);
  if (slotIdx !== -1) mentor.slots[slotIdx].status = "booked";
  await mentor.save();

  // Handle referral code
  if (referralCode) {
    const refMentor = await Mentor.findOne({ referralCode: referralCode.toUpperCase() });
    if (!refMentor) return res.status(400).json({ error: "Invalid referral code" });
    await Mentor.findByIdAndUpdate(refMentor._id, { $inc: { credits: 10 } });
  }

  const booking = await Booking.create({ mentorId, slot, referralCode, ...rest });
  res.json(booking);
});

// GET bookings
app.get("/api/bookings", async (req, res) => {
  const query = req.query.mentorId ? { mentorId: req.query.mentorId } : {};
  const bookings = await Booking.find(query).sort({ createdAt: -1 });
  res.json(bookings);
});

// PUT booking notes
app.put("/api/bookings/:id/notes", async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { notes: req.body.notes }, { new: true });
  res.json(booking);
});

// PUT booking meet link
app.delete("/api/bookings/:id", async (req, res) => {
  await Booking.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
app.put("/api/bookings/:id/meetlink", async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { meetLink: req.body.meetLink, meetSent: req.body.meetSent }, { new: true });
  res.json(booking);
});

// POST registration
app.post("/api/registrations", async (req, res) => {
  const reg = await Registration.create(req.body);
  res.json(reg);
});

// GET registrations
app.get("/api/registrations", async (req, res) => {
  const regs = await Registration.find({ status: "pending" }).sort({ createdAt: -1 });
  res.json(regs);
});

// PUT approve registration
app.put("/api/registrations/:id/approve", async (req, res) => {
  const reg = await Registration.findById(req.params.id);
  if (!reg) return res.status(404).json({ error: "Not found" });
  const mentor = await Mentor.create({ name: reg.name, college: reg.college, course: reg.course, year: reg.year, email: reg.email.toLowerCase().trim(), whatsapp: reg.whatsapp, bio: reg.bio, photo: reg.photo, visible: true, pin: "0000" });
  await Registration.findByIdAndUpdate(req.params.id, { status: "approved" });
  res.json(mentor);
});

// DELETE registration
app.delete("/api/registrations/:id", async (req, res) => {
  await Registration.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// GET stats
app.get("/api/stats", async (req, res) => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalBookings, weeklyBookings, activeMentors, pendingRegistrations, mentors] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ createdAt: { $gte: weekAgo } }),
    Mentor.countDocuments({ visible: true }),
    Registration.countDocuments({ status: "pending" }),
    Mentor.find({}, "credits"),
  ]);

  const totalCredits = mentors.reduce((sum, m) => sum + (m.credits || 0), 0);

  const bookingsByMentorArr = await Booking.aggregate([{ $group: { _id: "$mentorId", count: { $sum: 1 } } }]);
  const bookingsByMentor = {};
  bookingsByMentorArr.forEach(b => { bookingsByMentor[b._id] = b.count; });

  res.json({ totalBookings, weeklyBookings, activeMentors, pendingRegistrations, totalCredits, bookingsByMentor });
});
// ─── PAYMENT ROUTES ───────────────────────────────────────────────────────────
const paymentRoutes = require("./routes/payment");
app.use("/api/payment", paymentRoutes);
// Serve React build in production

const { router: customCallsRouter } = require('./routes/customCalls');
app.use('/api/custom-calls', customCallsRouter);

app.listen(PORT, () => {
  console.log(`Proxima server running on port ${PORT}`);
  setInterval(() => {
    fetch(`https://proxima-backend-hdho.onrender.com/api/mentors`)
      .then(() => console.log("Self-ping to stay awake"))
      .catch(() => {});
  }, 14 * 60 * 1000);
});

