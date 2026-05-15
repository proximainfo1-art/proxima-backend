require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");

const mailer = {
  sendMail: async ({ from, to, subject, html }) => {
    const name = from.includes("<") ? from.split("<")[0].trim() : "Proxima";
    const email = from.includes("<") ? from.split("<")[1].replace(">", "").trim() : from;
    await axios.post("https://api.brevo.com/v3/smtp/email", {
      sender: { name, email },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }, {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
    });
  },
};

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/proxima";
const PORT = process.env.PORT || 5000;

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
  featured: { type: Boolean, default: false },
  featuredOrder: { type: Number, default: 0 },
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

const GroupSessionSchema = new mongoose.Schema({
  mentorId: String, mentorName: String, mentorPhoto: String,
  mentorCollege: String, mentorCourse: String, mentorYear: String,
  topic: String, date: String, time: String, slot: String,
  price: { type: Number, default: 99 },
  maxParticipants: { type: Number, default: 5 },
  participants: [{ name: String, email: String, phone: String, paymentId: { type: String, default: null } }],
  visible: { type: Boolean, default: true },
  status: { type: String, enum: ["upcoming", "completed", "cancelled"], default: "upcoming" },
}, { timestamps: true });

const InfluencerSchema = new mongoose.Schema({
  name: String,
  code: { type: String, unique: true },
  email: String,
  totalEarnings: { type: Number, default: 0 },
  totalBookings: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
}, { timestamps: true });

const FreeSessionSchema = new mongoose.Schema({
  type: { type: String, enum: ["onetoone", "group"], default: "onetoone" },
  mentorId: String, mentorName: String, mentorPhoto: String,
  mentorCollege: String, mentorCourse: String, mentorYear: String,
  slot: String, topic: String,
  maxParticipants: { type: Number, default: 1000 },
  participants: [{ name: String, email: String, phone: String }],
  visible: { type: Boolean, default: true },
  status: { type: String, enum: ["upcoming", "completed"], default: "upcoming" },
}, { timestamps: true });

const Mentor = mongoose.model("Mentor", MentorSchema);
const FreeSession = mongoose.model("FreeSession", FreeSessionSchema);
const Booking = mongoose.model("Booking", BookingSchema);
const Registration = mongoose.model("Registration", RegistrationSchema);
const GroupSession = mongoose.model("GroupSession", GroupSessionSchema);
const Influencer = mongoose.model("Influencer", InfluencerSchema);

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "Server misconfigured: ADMIN_PASSWORD not set" });
  if (password === process.env.ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ error: "Invalid password" });
});

// Mentor login
app.post("/api/mentor/login", async (req, res) => {
  const { email, pin } = req.body;
  const mentor = await Mentor.findOne({ email: email.toLowerCase().trim(), pin });
  if (!mentor) return res.status(401).json({ error: "Invalid email or PIN" });
  res.json(mentor);
});

// GET mentors (admin)
app.get("/api/mentors", async (req, res) => {
  const query = req.query.all === "true" ? {} : { visible: true };
  const mentors = await Mentor.find(query).sort({ createdAt: -1 });
  res.json(mentors);
});

// GET mentors (public — sensitive fields stripped)
app.get('/api/mentors/public', async (req, res) => {
  const mentors = await Mentor.find({ visible: true }, '-pin -email -whatsapp');
  res.json(mentors);
});

// POST mentor (admin add)
app.post("/api/mentors", async (req, res) => {
  const name = req.body.name || "";
  const firstName = name.trim().split(" ")[0].toUpperCase();
  const referralCode = req.body.referralCode || `${firstName}10`;
  const mentor = await Mentor.create({ ...req.body, referralCode, email: req.body.email?.toLowerCase()?.trim() });
  res.json(mentor);
});

// PUT mentor (admin edit) — never overwrite slots
app.put("/api/mentors/:id", async (req, res) => {
  const { slots, ...safeBody } = req.body;
  const mentor = await Mentor.findByIdAndUpdate(req.params.id, safeBody, { new: true });
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
  const preservedBooked = bookedSlots.map(s => ({ ...s.toObject(), outsideSchedule: !newSlotDisplays.has(s.display) }));
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

  const mentor = await Mentor.findById(mentorId);
  if (!mentor) return res.status(404).json({ error: "Mentor not found" });

  const slotIdx = mentor.slots.findIndex(s => s.display === slot);
  if (slotIdx !== -1) mentor.slots[slotIdx].status = "booked";
  await mentor.save();

  if (referralCode) {
    const code = referralCode.toUpperCase();
    const refMentor = await Mentor.findOne({ referralCode: code });
    const refInfluencer = await Influencer.findOne({ code });

    if (refMentor) {
      const creditAmount = Math.floor((mentor.price || 299) * 0.15);
      await Mentor.findByIdAndUpdate(refMentor._id, { $inc: { credits: creditAmount } });
    } else if (refInfluencer) {
      const earningAmount = Math.floor((mentor.price || 299) * 0.20);
      await Influencer.findByIdAndUpdate(refInfluencer._id, {
        $inc: { totalEarnings: earningAmount, totalBookings: 1 }
      });

      // Email to influencer — non blocking
      if (refInfluencer.email) {
        mailer.sendMail({
          from: process.env.MAIL_FROM,
          to: refInfluencer.email,
          subject: `New booking through your code ${refInfluencer.code}! 🎉`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
              <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
              <h2 style="color:#111;">A session was booked using your code! 🎉</h2>
              <p style="color:#555;">Hey ${refInfluencer.name}, someone just booked a session on Proxima using your referral code <strong style="color:#E93800;">${refInfluencer.code}</strong>.</p>
              <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:16px 0;">
                <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">MENTOR</span><br/><strong style="color:#111;">${mentor.name} — ${mentor.college}</strong></div>
                <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">SESSION SLOT</span><br/><strong style="color:#E93800;">📅 ${slot}</strong></div>
                <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">SESSION PRICE</span><br/><strong style="color:#111;">₹${mentor.price || 299}</strong></div>
                <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">YOUR EARNINGS THIS SESSION</span><br/><strong style="color:#16A34A;font-size:18px;">₹${earningAmount}</strong></div>
                <div><span style="color:#888;font-size:13px;">TOTAL EARNINGS SO FAR</span><br/><strong style="color:#111;">₹${refInfluencer.totalEarnings + earningAmount}</strong></div>
              </div>
              <p style="color:#555;font-size:14px;">Keep sharing your code — every session booked through it adds to your earnings.</p>
              <p style="color:#aaa;font-size:12px;margin-top:24px;">— Team Proxima · info@joinproxima.in</p>
            </div>
          `,
        }).catch(e => console.error("Influencer email failed:", e.message));
      }
    } else {
      return res.status(400).json({ error: "Invalid referral code" });
    }
  }

  const booking = await Booking.create({ mentorId, slot, referralCode, ...rest });

  // Respond immediately — emails fire in background
  res.json(booking);

  // Email to mentor
  if (mentor.email) {
    mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: mentor.email,
      subject: `New Session Booked — ${rest.studentName}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
          <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
          <h2 style="color:#111;">New session booked! 🎉</h2>
          <p style="color:#555;">Hi ${mentor.name}, a student has booked a 30-minute session with you.</p>
          <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:16px 0;">
            <div style="margin-bottom:10px;"><span style="color:#888;font-size:13px;">STUDENT NAME</span><br/><strong style="color:#111;">${rest.studentName}</strong></div>
            <div style="margin-bottom:10px;"><span style="color:#888;font-size:13px;">PHONE</span><br/><strong style="color:#111;">${rest.studentPhone}</strong></div>
            <div style="margin-bottom:10px;"><span style="color:#888;font-size:13px;">EMAIL</span><br/><strong style="color:#111;">${rest.studentEmail}</strong></div>
            <div style="margin-bottom:10px;"><span style="color:#888;font-size:13px;">SLOT</span><br/><strong style="color:#E93800;">📅 ${slot}</strong></div>
            ${rest.message ? `<div><span style="color:#888;font-size:13px;">THEIR QUERY</span><br/><span style="color:#555;">${rest.message}</span></div>` : ""}
          </div>
          <p style="color:#555;font-size:14px;">Log in to your Proxima dashboard to share your Google Meet link with the student.</p>
          <p style="color:#aaa;font-size:12px;margin-top:24px;">— Team Proxima · info@joinproxima.in</p>
        </div>
      `,
    }).catch(e => console.error("Mentor email failed:", e.message));
  }

  // Email to mentee
  if (rest.studentEmail) {
    mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: rest.studentEmail,
      subject: `Your session with ${mentor.name} is confirmed! 🎉`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
          <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
          <h2 style="color:#111;">Booking Confirmed! 🎉</h2>
          <p style="color:#555;">Hi ${rest.studentName}, your 1-on-1 session is all set.</p>
          <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:16px 0;">
            <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">MENTOR</span><br/><strong style="color:#111;">${mentor.name} — ${mentor.college}</strong></div>
            <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">COURSE</span><br/><strong style="color:#111;">${mentor.course}</strong></div>
            <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">SLOT</span><br/><strong style="color:#E93800;">📅 ${slot}</strong></div>
            <div><span style="color:#888;font-size:13px;">AMOUNT PAID</span><br/><strong style="color:#111;">₹${mentor.price || 299}</strong></div>
          </div>
          <p style="color:#555;font-size:14px;">Your mentor will share the Google Meet link before the session. You'll receive it on this email.</p>
          <p style="color:#aaa;font-size:12px;margin-top:24px;">— Team Proxima · info@joinproxima.in</p>
        </div>
      `,
    }).catch(e => console.error("Mentee email failed:", e.message));
  }
});

// GET bookings
app.get("/api/bookings", async (req, res) => {
  const query = req.query.mentorId ? { mentorId: req.query.mentorId } : {};
  const bookings = await Booking.find(query).sort({ createdAt: -1 });
  res.json(bookings);
});

// DELETE booking
app.delete("/api/bookings/:id", async (req, res) => {
  await Booking.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// PUT booking notes
app.put("/api/bookings/:id/notes", async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { notes: req.body.notes }, { new: true });
  res.json(booking);
});

// PUT booking meet link — sends email directly to student
app.put("/api/bookings/:id/meetlink", async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
    { meetLink: req.body.meetLink, meetSent: req.body.meetSent },
    { new: true }
  );

  // Respond immediately
  res.json(booking);

  if (req.body.sendToStudent && booking.studentEmail && req.body.meetLink) {
    Booking.findByIdAndUpdate(req.params.id, { meetSent: true }).catch(() => {});
    mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: booking.studentEmail,
      subject: `Your session link is ready — ${booking.slot}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
          <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
          <h2 style="color:#111;">Your session link is ready! 🎥</h2>
          <p style="color:#555;">Hi ${booking.studentName}, your mentor has shared the Google Meet link.</p>
          <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:16px 0;">
            <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">MENTOR</span><br/><strong style="color:#111;">${booking.mentorName}</strong></div>
            <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">SLOT</span><br/><strong style="color:#E93800;">📅 ${booking.slot}</strong></div>
            <div><span style="color:#888;font-size:13px;">MEET LINK</span><br/><a href="${req.body.meetLink}" style="color:#2563EB;font-weight:700;word-break:break-all;">${req.body.meetLink}</a></div>
          </div>
          <a href="${req.body.meetLink}" style="display:inline-block;background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-top:8px;">Join Session →</a>
          <p style="color:#555;font-size:14px;margin-top:20px;">Issues? <a href="mailto:info@joinproxima.in" style="color:#E93800;">info@joinproxima.in</a></p>
          <p style="color:#aaa;font-size:12px;margin-top:24px;">— Team Proxima</p>
        </div>
      `,
    }).catch(e => console.error("Meet link email failed:", e.message));
  }
});

// POST registration — no email on submission
app.post("/api/registrations", async (req, res) => {
  const reg = await Registration.create(req.body);
  res.json(reg);
});

// GET registrations
app.get("/api/registrations", async (req, res) => {
  const regs = await Registration.find({ status: "pending" }).sort({ createdAt: -1 });
  res.json(regs);
});

// PUT approve registration — sends approval email with credentials
app.put("/api/registrations/:id/approve", async (req, res) => {
  const reg = await Registration.findById(req.params.id);
  if (!reg) return res.status(404).json({ error: "Not found" });
  const firstName = reg.name.trim().split(" ")[0].toUpperCase();
  const referralCode = `${firstName}10`;
  const mentor = await Mentor.create({
    name: reg.name, college: reg.college, course: reg.course, year: reg.year,
    email: reg.email.toLowerCase().trim(), whatsapp: reg.whatsapp,
    bio: reg.bio, photo: reg.photo, visible: true, pin: "0000", referralCode,
  });
  await Registration.findByIdAndUpdate(req.params.id, { status: "approved" });

  // Respond immediately
  res.json(mentor);

  // Send approval email in background
  if (reg.email) {
    mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: reg.email,
      subject: `You're in! Welcome to Proxima 🎉`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
          <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
          <h2 style="color:#111;">Congratulations, ${reg.name.split(" ")[0]}! 🎉</h2>
          <p style="color:#555;font-size:15px;">Your application has been approved. You are now an official guide on Proxima.</p>
          <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:20px 0;">
            <div style="font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">Your Login Details</div>
            <div style="margin-bottom:10px;"><span style="color:#888;font-size:13px;">EMAIL</span><br/><strong style="color:#111;">${reg.email}</strong></div>
            <div style="margin-bottom:10px;"><span style="color:#888;font-size:13px;">PIN</span><br/><strong style="color:#111;">0000 (change this from your dashboard)</strong></div>
            <div><span style="color:#888;font-size:13px;">YOUR REFERRAL CODE</span><br/><strong style="color:#E93800;font-size:18px;">${referralCode}</strong><br/><span style="color:#888;font-size:12px;">Share this with students — you earn 15% of every session booked through your code</span></div>
          </div>
          <a href="https://joinproxima.in/#mentor-login" style="display:inline-block;background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:20px;">Login to Dashboard →</a>
          <p style="color:#555;font-size:14px;">Once logged in, set up your availability slots and update your PIN. Students can start booking you right away.</p>
          <p style="color:#555;font-size:14px;">You're helping students make one of the most important decisions of their lives — thank you for being part of this.</p>
          <p style="color:#aaa;font-size:12px;margin-top:24px;">— Team Proxima · info@joinproxima.in</p>
        </div>
      `,
    }).catch(e => console.error("Approval email failed:", e.message));
  }
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

// ─── GROUP SESSION ROUTES ────────────────────────────────────────────────────

app.get("/api/group-sessions", async (req, res) => {
  try {
    const sessions = await GroupSession.find({ visible: true, status: "upcoming" }).sort({ createdAt: -1 });
    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/group-sessions/admin", async (req, res) => {
  try {
    const sessions = await GroupSession.find().sort({ createdAt: -1 });
    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/group-sessions", async (req, res) => {
  try {
    const session = await GroupSession.create(req.body);
    res.json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/group-sessions/:id", async (req, res) => {
  try {
    const session = await GroupSession.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/group-sessions/:id", async (req, res) => {
  try {
    await GroupSession.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/group-sessions/:id/book", async (req, res) => {
  try {
    const session = await GroupSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.participants.length >= session.maxParticipants) return res.status(400).json({ error: "Session is full" });
    const { name, email, phone, paymentId } = req.body;
    session.participants.push({ name, email, phone, paymentId: paymentId || null });
    await session.save();

    res.json(session);

    if (email) {
      mailer.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: `Group Session Booked — ${session.topic}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
            <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
            <h2 style="color:#111;">You're in! 🎉</h2>
            <p style="color:#555;">Hi ${name}, your spot in the group session is confirmed.</p>
            <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:16px 0;">
              <div style="margin-bottom:8px;"><strong>Topic:</strong> ${session.topic}</div>
              <div style="margin-bottom:8px;"><strong>Mentor:</strong> ${session.mentorName} — ${session.mentorCollege}</div>
              <div style="margin-bottom:8px;"><strong>Date & Time:</strong> ${session.slot}</div>
              <div style="margin-bottom:8px;"><strong>Amount Paid:</strong> ₹${session.price}</div>
              <div><strong>Spots remaining:</strong> ${session.maxParticipants - session.participants.length}</div>
            </div>
            <p style="color:#555;font-size:14px;">The Google Meet link will be shared on this email before the session starts.</p>
            <p style="color:#aaa;font-size:12px;">— Team Proxima · info@joinproxima.in</p>
          </div>
        `,
      }).catch(e => console.error("Group email failed:", e.message));
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/group-sessions/:id/create-order", async (req, res) => {
  try {
    const session = await GroupSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.participants.length >= session.maxParticipants) return res.status(400).json({ error: "Session is full" });
    const Razorpay = require("razorpay");
    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({ amount: session.price * 100, currency: "INR", receipt: `group_${session._id}_${Date.now()}` });
    res.json({ orderId: order.id, amount: order.amount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/group-sessions/:id/verify", async (req, res) => {
  try {
    const crypto = require("crypto");
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const expectedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (expectedSignature !== razorpay_signature) return res.status(400).json({ error: "Payment verification failed" });
    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── INFLUENCER ROUTES ───────────────────────────────────────────────────────

// GET all influencers (admin)
app.get("/api/influencers", async (req, res) => {
  try {
    const influencers = await Influencer.find().sort({ createdAt: -1 });
    res.json(influencers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create influencer (admin)
app.post("/api/influencers", async (req, res) => {
  try {
    const code = req.body.name.trim().toUpperCase().replace(/\s+/g, "");
    const influencer = await Influencer.create({ ...req.body, code });
    res.json(influencer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update influencer (admin)
app.put("/api/influencers/:id", async (req, res) => {
  try {
    const influencer = await Influencer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(influencer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE influencer (admin)
app.delete("/api/influencers/:id", async (req, res) => {
  try {
    await Influencer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── FREE SESSION ROUTES ─────────────────────────────────────────────────────

app.get("/api/free-sessions", async (req, res) => {
  try {
    const sessions = await FreeSession.find({ visible: true, status: "upcoming" }).sort({ createdAt: -1 });
    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/free-sessions/admin", async (req, res) => {
  try {
    const sessions = await FreeSession.find().sort({ createdAt: -1 });
    res.json(sessions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/free-sessions", async (req, res) => {
  try {
    const session = await FreeSession.create(req.body);
    res.json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/free-sessions/:id", async (req, res) => {
  try {
    const session = await FreeSession.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(session);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/free-sessions/:id", async (req, res) => {
  try {
    await FreeSession.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/free-sessions/:id/book", async (req, res) => {
  try {
    const session = await FreeSession.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.participants.length >= session.maxParticipants) return res.status(400).json({ error: "Session is full" });
    const { name, email, phone } = req.body;

    // Check for duplicate registration by email or phone
    const alreadyRegistered = session.participants.some(
      p => p.email?.toLowerCase() === email?.toLowerCase() || p.phone === phone
    );
    if (alreadyRegistered) return res.status(400).json({ error: "You have already registered for this session." });

    session.participants.push({ name, email, phone });
    await session.save();

    res.json(session);

    if (email) {
      mailer.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: `Your free session is confirmed! 🎉`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px;border:1px solid #E8E2D9;border-radius:12px;">
            <img src="https://res.cloudinary.com/dlzqb06u6/image/upload/v1775449181/Logo_Dark_Mode_hhg8xt.png" alt="Proxima" style="height:32px;margin-bottom:24px;" />
            <h2 style="color:#111;">You're booked! 🎉</h2>
            <p style="color:#555;">Hi ${name}, your free session is confirmed.</p>
            <div style="background:#FFF0EB;border-radius:10px;padding:20px;margin:16px 0;">
              <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">MENTOR</span><br/><strong style="color:#111;">${session.mentorName} — ${session.mentorCollege}</strong></div>
              ${session.topic ? `<div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">TOPIC</span><br/><strong style="color:#111;">${session.topic}</strong></div>` : ""}
              <div style="margin-bottom:8px;"><span style="color:#888;font-size:13px;">SLOT</span><br/><strong style="color:#E93800;">📅 ${session.slot}</strong></div>
              <div><span style="color:#888;font-size:13px;">AMOUNT</span><br/><strong style="color:#16A34A;font-size:16px;">FREE</strong></div>
            </div>
            <p style="color:#555;font-size:14px;">The Google Meet link will be shared on this email before the session.</p>
            <p style="color:#aaa;font-size:12px;margin-top:24px;">— Team Proxima · info@joinproxima.in</p>
          </div>
        `,
      }).catch(e => console.error("Free session email failed:", e.message));
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EXTERNAL ROUTES ─────────────────────────────────────────────────────────
const paymentRoutes = require("./routes/payment");
app.use("/api/payment", paymentRoutes);

const { router: customCallsRouter } = require('./routes/customCalls');
app.use('/api/custom-calls', customCallsRouter);

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Proxima server running on port ${PORT}`);
  setInterval(() => {
    fetch(`https://proxima-backend-hdho.onrender.com/api/mentors`)
      .then(() => console.log("Self-ping to stay awake"))
      .catch(() => {});
  }, 4 * 60 * 1000);
});