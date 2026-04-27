require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const MentorSchema = new mongoose.Schema({
  name: String, referralCode: String,
}, { strict: false });

const Mentor = mongoose.model("Mentor", MentorSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const mentors = await Mentor.find({ $or: [{ referralCode: "" }, { referralCode: null }, { referralCode: { $exists: false } }] });
  console.log(`Found ${mentors.length} mentors without referral codes`);

  for (const mentor of mentors) {
    const firstName = mentor.name.trim().split(" ")[0].toUpperCase();
    const referralCode = `${firstName}10`;
    await Mentor.findByIdAndUpdate(mentor._id, { referralCode });
    console.log(`${mentor.name} → ${referralCode}`);
  }

  console.log("Done!");
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });