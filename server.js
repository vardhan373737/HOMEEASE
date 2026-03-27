const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/homeease";
const isVercel = Boolean(process.env.VERCEL);

// Booking schema
const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  date: { type: String, required: true },
  serviceType: { type: String, required: true },
  price: { type: String, required: true },
  notes: { type: String, default: "" },
  status: { type: String, enum: ["pending", "confirmed", "completed", "cancelled"], default: "pending" },
  followupStatus: { type: String, default: "" },
  paymentStatus: { type: String, enum: ["unpaid", "partial", "paid"], default: "unpaid" },
  amountPaid: { type: Number, default: 0 },
  paymentHistory: {
    type: [
      {
        amount: { type: Number, required: true },
        method: { type: String, required: true },
        referenceId: { type: String, required: true },
        notes: { type: String, default: "" },
        transactionDate: { type: Date, required: true },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    default: []
  },
  workPhotos: {
    before: {
      type: [
        {
          url: { type: String, required: true },
          uploadedAt: { type: Date, default: Date.now }
        }
      ],
      default: []
    },
    after: {
      type: [
        {
          url: { type: String, required: true },
          uploadedAt: { type: Date, default: Date.now }
        }
      ],
      default: []
    }
  },
  acceptedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const Booking = mongoose.model("Booking", bookingSchema);

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["user", "provider", "admin"], default: "user" },
  status: { type: String, enum: ["pending", "approved"], default: "approved" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

let useInMemory = true;
let inMemoryBookings = [];
let inMemoryChatMessages = [];
const bookingSseClients = new Map();

// Vercel filesystem is read-only except /tmp, so use /tmp for runtime uploads.
const uploadsRootDir = isVercel ? path.join("/tmp", "uploads") : path.join(__dirname, "uploads");
const workPhotosDir = path.join(uploadsRootDir, "work-photos");
fs.mkdirSync(workPhotosDir, { recursive: true });

const workPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, workPhotosDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});

const uploadWorkPhotos = multer({
  storage: workPhotoStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  }
});

async function connectDatabase() {
  if (!MONGO_URI) {
    console.warn("MONGO_URI not provided. Falling back to in-memory bookings (non-persistent).\nSet MONGO_URI in .env to enable MongoDB storage.");
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    useInMemory = false;
    console.log("Connected to MongoDB");
  } catch (error) {
    console.warn("MongoDB connection failed; using in-memory storage.", error);
    useInMemory = true;
  }
}

connectDatabase();

// Serve frontend static files
app.use(express.static(path.join(__dirname)));
app.use("/uploads", express.static(uploadsRootDir));

function toPlainBooking(booking) {
  if (!booking) return null;
  if (typeof booking.toObject === "function") return booking.toObject();
  return booking;
}

function getBookingProviderId(booking) {
  const plain = toPlainBooking(booking) || {};
  const provider = plain.providerId;
  if (!provider) return "";
  if (typeof provider === "object") {
    return String(provider._id || provider.id || "");
  }
  return String(provider);
}

function canReceiveBookingEvent(user, booking) {
  if (!user || !booking) return false;
  if (user.role === "admin") return true;
  if (user.role !== "provider") return false;

  const bookingProviderId = getBookingProviderId(booking);
  const userId = String(user._id || user.id || "");
  const status = String(booking.status || "");
  if (bookingProviderId) return bookingProviderId === userId;
  return status === "pending";
}

function recalculatePaymentSummary(booking) {
  if (!booking) return;
  const history = Array.isArray(booking.paymentHistory) ? booking.paymentHistory : [];
  const totalPaid = history.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalPrice = Number(booking.price || 0);

  booking.amountPaid = totalPaid;
  if (totalPaid <= 0) {
    booking.paymentStatus = "unpaid";
  } else if (totalPrice > 0 && totalPaid < totalPrice) {
    booking.paymentStatus = "partial";
  } else {
    booking.paymentStatus = "paid";
  }
}

function broadcastBookingEvent(action, booking) {
  const plain = toPlainBooking(booking);
  if (!plain) return;

  const payload = JSON.stringify({
    type: "booking-update",
    action,
    booking: plain,
    at: new Date().toISOString()
  });

  for (const [, client] of bookingSseClients) {
    if (!canReceiveBookingEvent(client.user, plain)) continue;
    client.res.write(`data: ${payload}\n\n`);
  }
}

app.get("/api/bookings", async (req, res) => {
  try {
    if (useInMemory) {
      return res.json(inMemoryBookings);
    }
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching bookings" });
  }
});

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Contact = mongoose.model("Contact", contactSchema);

const testimonialSchema = new mongoose.Schema({
  name: { type: String, required: true },
  content: { type: String, required: true },
  rating: { type: Number, min: 1, max: 5, default: 5 },
  createdAt: { type: Date, default: Date.now }
});

const Testimonial = mongoose.model("Testimonial", testimonialSchema);

const providerAdminChatSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderRole: { type: String, enum: ["provider", "admin"], required: true },
  senderName: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const ProviderAdminChat = mongoose.model("ProviderAdminChat", providerAdminChatSchema);

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing or invalid auth header" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "homeease-secret");
    const user = await User.findById(decoded.id).select("name email role");
    if (!user) return res.status(401).json({ message: "Invalid user" });
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin role required" });
  }
  next();
};

app.get("/api/stream/bookings", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.status(401).json({ message: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "homeease-secret");
    const user = await User.findById(decoded.id).select("name email role");
    if (!user || !["admin", "provider"].includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const clientId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    bookingSseClients.set(clientId, { user, res });

    res.write(`data: ${JSON.stringify({ type: "connected", role: user.role, at: new Date().toISOString() })}\n\n`);

    const heartbeat = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      bookingSseClients.delete(clientId);
    });
  } catch (error) {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
});

// POST /api/bookings (requires authentication)
app.post("/api/bookings", authMiddleware, async (req, res) => {
  try {
    const { name, phone, address, date, serviceType, price, notes } = req.body;
    if (!name || !phone || !address || !date || !serviceType || !price) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    if (useInMemory) {
      const id = inMemoryBookings.length + 1;
      const newBooking = {
        id,
        name,
        phone,
        address,
        date,
        serviceType,
        price,
        notes,
        status: "pending",
        followupStatus: "",
        providerId: null,
        acceptedAt: null,
        completedAt: null,
        paymentStatus: "unpaid",
        amountPaid: 0,
        paymentHistory: [],
        workPhotos: { before: [], after: [] },
        createdAt: new Date()
      };
      inMemoryBookings.unshift(newBooking);
      broadcastBookingEvent("created", newBooking);
      return res.status(201).json({ id, message: "Booking saved in memory" });
    }

    const booking = new Booking({ userId: req.user.id, name, phone, address, date, serviceType, price, notes });
    const saved = await booking.save();
    broadcastBookingEvent("created", saved);
    res.status(201).json({ id: saved._id, message: "Booking saved" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating booking" });
  }
});

// Get user's own bookings (authenticated)
app.get("/api/my-bookings", authMiddleware, async (req, res) => {
  try {
    const phone = req.query.phone;

    if (useInMemory) {
      let bookings = [...inMemoryBookings];
      if (phone) bookings = bookings.filter((b) => b.phone === phone);
      return res.json(bookings);
    }

    const filter = { userId: req.user.id };
    if (phone) filter.phone = phone;

    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching bookings" });
  }
});
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    if (!name || !email || !phone || !subject || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({ message: "Phone must be a 10-digit number" });
    }

    const contact = await Contact.create({ name, email, phone, subject, message });
    res.status(201).json(contact);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error saving contact" });
  }
});

app.get("/api/contact", authMiddleware, async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { message: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const contacts = await Contact.find(query).sort({ createdAt: -1 });
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ message: "Error fetching contacts" });
  }
});

app.post("/api/testimonials", authMiddleware, async (req, res) => {
  try {
    const { name, content, rating } = req.body;
    if (!name || !content) {
      return res.status(400).json({ message: "Name and content are required" });
    }
    const testimonial = await Testimonial.create({ name, content, rating: rating || 5 });
    res.status(201).json(testimonial);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating testimonial" });
  }
});

app.get("/api/testimonials", async (req, res) => {
  try {
    const testimonials = await Testimonial.find().sort({ createdAt: -1 }).limit(10);
    res.json(testimonials);
  } catch (error) {
    res.status(500).json({ message: "Error fetching testimonials" });
  }
});

const generateAccessToken = (user) => {
  return jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET || "homeease-secret", { expiresIn: "15m" });
};

const generateRefreshToken = async (user) => {
  const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_REFRESH_SECRET || "homeease-refresh-secret", { expiresIn: "30d" });
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await RefreshToken.create({ userId: user._id, token, expiresAt });
  return token;
};

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    if (!name || !email || !phone || !password || !role) {
      return res.status(400).json({ message: "Name, email, phone, password, and role are required" });
    }
    if (!["user", "provider", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    if (!/^[\w-+.]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({ message: "Phone must be a 10-digit number" });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.status(409).json({ message: "Email or phone already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 11);
    const status = (role === "user" || role === "provider") ? "pending" : "approved";
    const user = new User({ name, email, phone, passwordHash, role, status });
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error during registration" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    let { email, phone, password } = req.body;
    if ((!email && !phone) || !password) {
      return res.status(400).json({ message: "Email or phone and password are required" });
    }

    let query;
    if (phone && /^[0-9]{10}$/.test(phone)) {
      query = { phone };
    } else if (email) {
      query = { email };
    } else {
      return res.status(400).json({ message: "Please provide a valid email or 10-digit phone number" });
    }

    const user = await User.findOne(query);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.status !== "approved") {
      return res.status(403).json({ message: "Account pending admin approval. Admin will approve within 72 hours." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);
    res.json({
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error during login" });
  }
});

app.post("/api/refresh-token", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: "Refresh token is required" });
  try {
    const found = await RefreshToken.findOne({ token: refreshToken });
    if (!found || found.expiresAt < new Date()) {
      return res.status(401).json({ message: "Refresh token invalid or expired" });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || "homeease-refresh-secret");
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "User not found" });

    const accessToken = generateAccessToken(user);
    res.json({ accessToken });
  } catch (error) {
    console.error(error);
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});

app.post("/api/logout", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: "Refresh token is required" });
  try {
    await RefreshToken.deleteOne({ token: refreshToken });
    res.json({ message: "Logged out" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Logout failed" });
  }
});

app.get("/api/profile", authMiddleware, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await User.findById(req.user.id).select("name email phone");
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  res.json(user);
});

// Admin endpoint to retrieve bookings with role-based auth
app.get("/api/admin/bookings", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (useInMemory) {
      return res.json(inMemoryBookings);
    }
    const bookings = await Booking.find().populate("providerId", "name email").sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching admin bookings" });
  }
});

app.get("/api/admin/pending-users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const pendingUsers = await User.find({ status: "pending" }).select("name email role createdAt");
    res.json(pendingUsers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching pending users" });
  }
});

app.post("/api/admin/approve-user/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.status !== "pending") {
      return res.status(400).json({ message: "User is not pending approval" });
    }
    user.status = "approved";
    await user.save();
    res.json({ message: "User approved successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error approving user" });
  }
});

app.get("/api/admin/providers", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const providers = await User.find({ role: "provider", status: "approved" }).select("name email createdAt");
    res.json(providers);
  } catch (error) {
    res.status(500).json({ message: "Error fetching providers" });
  }
});

app.put("/api/admin/bookings/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "confirmed", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }
      inMemoryBookings[idx].status = status;
      if (status === "completed") {
        inMemoryBookings[idx].completedAt = new Date();
      }
      broadcastBookingEvent("status-updated", inMemoryBookings[idx]);
      return res.json({ message: "Status updated", booking: inMemoryBookings[idx] });
    }

    const updateData = { status };
    if (status === "completed") {
      updateData.completedAt = new Date();
    }

    const booking = await Booking.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    broadcastBookingEvent("status-updated", booking);
    res.json({ message: "Status updated", booking });
  } catch (error) {
    res.status(500).json({ message: "Error updating status" });
  }
});

app.put("/api/admin/bookings/:id/followup", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { followupStatus } = req.body;

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }
      inMemoryBookings[idx].followupStatus = String(followupStatus || "");
      broadcastBookingEvent("followup-updated", inMemoryBookings[idx]);
      return res.json({ message: "Followup status updated", booking: inMemoryBookings[idx] });
    }

    const booking = await Booking.findByIdAndUpdate(req.params.id, { followupStatus }, { new: true });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    broadcastBookingEvent("followup-updated", booking);
    res.json({ message: "Followup status updated", booking });
  } catch (error) {
    res.status(500).json({ message: "Error updating followup status" });
  }
});

app.put("/api/admin/bookings/:id/assign", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { providerId } = req.body;
    if (!providerId) {
      return res.status(400).json({ message: "providerId is required" });
    }

    const provider = await User.findOne({ _id: providerId, role: "provider", status: "approved" }).select("_id name email");
    if (!provider) {
      return res.status(404).json({ message: "Provider not found" });
    }

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }
      inMemoryBookings[idx].providerId = String(provider._id);
      if ((inMemoryBookings[idx].status || "pending") === "pending") {
        inMemoryBookings[idx].status = "confirmed";
      }
      if (!inMemoryBookings[idx].acceptedAt) {
        inMemoryBookings[idx].acceptedAt = new Date();
      }
      broadcastBookingEvent("assigned", inMemoryBookings[idx]);
      return res.json({ message: "Booking assigned", booking: inMemoryBookings[idx] });
    }

    const updateData = {
      providerId: provider._id,
      acceptedAt: new Date()
    };

    const current = await Booking.findById(req.params.id);
    if (!current) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (current.status === "pending") {
      updateData.status = "confirmed";
    }

    const booking = await Booking.findByIdAndUpdate(req.params.id, updateData, { new: true }).populate("providerId", "name email");
    broadcastBookingEvent("assigned", booking);
    res.json({ message: "Booking assigned", booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error assigning booking" });
  }
});

app.put("/api/admin/bookings/:id/payment", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { paymentStatus, amountPaid } = req.body;
    if (!paymentStatus || !["unpaid", "partial", "paid"].includes(paymentStatus)) {
      return res.status(400).json({ message: "Invalid payment status" });
    }

    const parsedAmount = Number(amountPaid || 0);
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ message: "amountPaid must be a valid non-negative number" });
    }

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }

      inMemoryBookings[idx].paymentStatus = paymentStatus;
      inMemoryBookings[idx].amountPaid = parsedAmount;
      broadcastBookingEvent("payment-updated", inMemoryBookings[idx]);
      return res.json({ message: "Payment updated", booking: inMemoryBookings[idx] });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { paymentStatus, amountPaid: parsedAmount },
      { new: true }
    );
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    broadcastBookingEvent("payment-updated", booking);
    res.json({ message: "Payment updated", booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating payment" });
  }
});

app.post("/api/admin/bookings/:id/payment-history", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { amount, method, referenceId, notes, transactionDate } = req.body;
    const parsedAmount = Number(amount || 0);
    const safeMethod = String(method || "").trim();
    const safeReferenceId = String(referenceId || "").trim();
    const safeNotes = String(notes || "").trim();
    const paidAt = transactionDate ? new Date(transactionDate) : new Date();

    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }
    if (!safeMethod) {
      return res.status(400).json({ message: "method is required" });
    }
    if (!safeReferenceId) {
      return res.status(400).json({ message: "referenceId is required" });
    }
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ message: "transactionDate is invalid" });
    }

    const ledgerRow = {
      amount: parsedAmount,
      method: safeMethod,
      referenceId: safeReferenceId,
      notes: safeNotes,
      transactionDate: paidAt,
      createdAt: new Date()
    };

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (!Array.isArray(inMemoryBookings[idx].paymentHistory)) {
        inMemoryBookings[idx].paymentHistory = [];
      }
      inMemoryBookings[idx].paymentHistory.push(ledgerRow);
      recalculatePaymentSummary(inMemoryBookings[idx]);
      broadcastBookingEvent("payment-history-added", inMemoryBookings[idx]);
      return res.json({ message: "Payment transaction added", booking: inMemoryBookings[idx] });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!Array.isArray(booking.paymentHistory)) {
      booking.paymentHistory = [];
    }
    booking.paymentHistory.push(ledgerRow);
    recalculatePaymentSummary(booking);
    await booking.save();

    broadcastBookingEvent("payment-history-added", booking);
    res.json({ message: "Payment transaction added", booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding payment transaction" });
  }
});

// User management endpoints
app.get("/api/admin/users/search", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const users = await User.find({
      $or: [
        { email: new RegExp(q, 'i') },
        { phone: new RegExp(q, 'i') },
        { name: new RegExp(q, 'i') }
      ]
    }).select("name email phone role status createdAt").limit(10);

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error searching users" });
  }
});

app.get("/api/admin/users/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("name email phone role status createdAt");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user" });
  }
});

app.put("/api/admin/users/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, email, phone, password, role, status } = req.body;

    if (!name || !email || !phone || !role || !status) {
      return res.status(400).json({ message: "Name, email, phone, role, and status are required" });
    }

    if (!["user", "provider", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    if (!["pending", "approved"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (!/^[\w-+.]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({ message: "Phone must be a 10-digit number" });
    }

    // Check if email or phone is already taken by another user
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
      _id: { $ne: req.params.id }
    });
    if (existingUser) {
      return res.status(409).json({ message: "Email or phone already taken by another user" });
    }

    const updateData = { name, email, phone, role, status };

    // Only update password if provided
    if (password && password.trim()) {
      updateData.passwordHash = await bcrypt.hash(password, 11);
    }

    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "User updated successfully",
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, status: user.status }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating user" });
  }
});

// Delete user endpoint
app.delete("/api/admin/users/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Also delete associated bookings
    await Booking.deleteMany({ userId: req.params.id });

    res.json({ message: "User and associated bookings deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting user" });
  }
});

// Get all users with filtering
app.get("/api/admin/all-users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { role, status, search } = req.query;
    let filter = {};

    if (role) filter.role = role;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { phone: new RegExp(search, 'i') }
      ];
    }

    const users = await User.find(filter).select("name email phone role status createdAt").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users" });
  }
});

// Get user statistics
app.get("/api/admin/user-stats", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: "user" });
    const totalProviders = await User.countDocuments({ role: "provider" });
    const totalAdmins = await User.countDocuments({ role: "admin" });
    const pendingUsers = await User.countDocuments({ status: "pending" });

    res.json({
      totalUsers,
      totalProviders,
      totalAdmins,
      pendingUsers
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching user statistics" });
  }
});

// Provider endpoints
app.get("/api/provider/bookings", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ message: "Provider access required" });
    }

    const providerId = String(req.user._id || req.user.id);
    const { status } = req.query;

    const assignedToProvider = { providerId };
    const openUnassigned = { status: "pending", providerId: null };

    let filter = { $or: [assignedToProvider, openUnassigned] };

    if (status) {
      if (status === "pending") {
        filter = {
          $or: [
            { status: "pending", providerId: null },
            { status: "pending", providerId }
          ]
        };
      } else {
        filter = { providerId, status };
      }
    }

    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Error fetching provider bookings" });
  }
});

app.put("/api/provider/bookings/:id/accept", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ message: "Provider access required" });
    }

    const providerId = String(req.user._id || req.user.id);

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if ((inMemoryBookings[idx].status || "pending") !== "pending") {
        return res.status(400).json({ message: "Only pending bookings can be accepted" });
      }

      if (inMemoryBookings[idx].providerId && String(inMemoryBookings[idx].providerId) !== providerId) {
        return res.status(400).json({ message: "Booking already accepted by another provider" });
      }

      inMemoryBookings[idx].status = "confirmed";
      inMemoryBookings[idx].providerId = providerId;
      inMemoryBookings[idx].acceptedAt = new Date();
      broadcastBookingEvent("accepted", inMemoryBookings[idx]);
      return res.json({ message: "Booking accepted", booking: inMemoryBookings[idx] });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.status !== "pending") {
      return res.status(400).json({ message: "Only pending bookings can be accepted" });
    }

    if (booking.providerId && String(booking.providerId) !== providerId) {
      return res.status(400).json({ message: "Booking already accepted by another provider" });
    }

    booking.status = "confirmed";
    booking.providerId = providerId;
    booking.acceptedAt = new Date();
    await booking.save();
    broadcastBookingEvent("accepted", booking);

    res.json({ message: "Booking accepted", booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error accepting booking" });
  }
});

app.put("/api/provider/bookings/:id/update", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ message: "Provider access required" });
    }

    const providerId = String(req.user._id || req.user.id);
    const { status, followupStatus } = req.body;
    if (status && !["pending", "confirmed", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (!inMemoryBookings[idx].providerId || String(inMemoryBookings[idx].providerId) !== providerId) {
        return res.status(403).json({ message: "You can update only your accepted bookings" });
      }

      if (typeof status === "string") {
        inMemoryBookings[idx].status = status;
        if (status === "completed") {
          inMemoryBookings[idx].completedAt = new Date();
        }
      }
      if (typeof followupStatus === "string") {
        inMemoryBookings[idx].followupStatus = followupStatus;
      }

      broadcastBookingEvent("provider-updated", inMemoryBookings[idx]);

      return res.json({ message: "Booking updated", booking: inMemoryBookings[idx] });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!booking.providerId || String(booking.providerId) !== providerId) {
      return res.status(403).json({ message: "You can update only your accepted bookings" });
    }

    const updateData = {};
    if (typeof status === "string") updateData.status = status;
    if (typeof followupStatus === "string") updateData.followupStatus = followupStatus;
    if (status === "completed") updateData.completedAt = new Date();

    const updatedBooking = await Booking.findByIdAndUpdate(req.params.id, updateData, { new: true });
    broadcastBookingEvent("provider-updated", updatedBooking);

    res.json({ message: "Booking updated", booking: updatedBooking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating provider booking" });
  }
});

app.post(
  "/api/provider/bookings/:id/photos",
  authMiddleware,
  uploadWorkPhotos.fields([
    { name: "beforePhoto", maxCount: 1 },
    { name: "afterPhoto", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      if (req.user.role !== "provider") {
        return res.status(403).json({ message: "Provider access required" });
      }

      const providerId = String(req.user._id || req.user.id);
      const beforeFile = req.files && req.files.beforePhoto && req.files.beforePhoto[0];
      const afterFile = req.files && req.files.afterPhoto && req.files.afterPhoto[0];

      if (!beforeFile && !afterFile) {
        return res.status(400).json({ message: "Upload at least one image (before or after)" });
      }

      const beforeEntry = beforeFile
        ? { url: `/uploads/work-photos/${beforeFile.filename}`, uploadedAt: new Date() }
        : null;
      const afterEntry = afterFile
        ? { url: `/uploads/work-photos/${afterFile.filename}`, uploadedAt: new Date() }
        : null;

      if (useInMemory) {
        const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
        if (idx === -1) {
          return res.status(404).json({ message: "Booking not found" });
        }

        if (!inMemoryBookings[idx].providerId || String(inMemoryBookings[idx].providerId) !== providerId) {
          return res.status(403).json({ message: "You can upload photos only for your accepted bookings" });
        }

        if (!inMemoryBookings[idx].workPhotos) {
          inMemoryBookings[idx].workPhotos = { before: [], after: [] };
        }
        if (!Array.isArray(inMemoryBookings[idx].workPhotos.before)) inMemoryBookings[idx].workPhotos.before = [];
        if (!Array.isArray(inMemoryBookings[idx].workPhotos.after)) inMemoryBookings[idx].workPhotos.after = [];

        if (beforeEntry) inMemoryBookings[idx].workPhotos.before.push(beforeEntry);
        if (afterEntry) inMemoryBookings[idx].workPhotos.after.push(afterEntry);

        broadcastBookingEvent("photos-uploaded", inMemoryBookings[idx]);
        return res.json({ message: "Work photos uploaded", booking: inMemoryBookings[idx] });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (!booking.providerId || String(booking.providerId) !== providerId) {
        return res.status(403).json({ message: "You can upload photos only for your accepted bookings" });
      }

      if (!booking.workPhotos) {
        booking.workPhotos = { before: [], after: [] };
      }
      if (!Array.isArray(booking.workPhotos.before)) booking.workPhotos.before = [];
      if (!Array.isArray(booking.workPhotos.after)) booking.workPhotos.after = [];

      if (beforeEntry) booking.workPhotos.before.push(beforeEntry);
      if (afterEntry) booking.workPhotos.after.push(afterEntry);

      await booking.save();
      broadcastBookingEvent("photos-uploaded", booking);

      res.json({ message: "Work photos uploaded", booking });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error uploading work photos" });
    }
  }
);

app.delete("/api/provider/bookings/:id/photos", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ message: "Provider access required" });
    }

    const providerId = String(req.user._id || req.user.id);
    const phase = String(req.body.phase || "").trim();
    const photoUrl = String(req.body.url || "").trim();

    if (!["before", "after"].includes(phase)) {
      return res.status(400).json({ message: "phase must be before or after" });
    }
    if (!photoUrl) {
      return res.status(400).json({ message: "url is required" });
    }

    if (useInMemory) {
      const idx = inMemoryBookings.findIndex((b) => String(b.id) === String(req.params.id) || String(b._id) === String(req.params.id));
      if (idx === -1) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (!inMemoryBookings[idx].providerId || String(inMemoryBookings[idx].providerId) !== providerId) {
        return res.status(403).json({ message: "You can delete photos only for your accepted bookings" });
      }

      if (!inMemoryBookings[idx].workPhotos || !Array.isArray(inMemoryBookings[idx].workPhotos[phase])) {
        return res.status(404).json({ message: "Photo not found" });
      }

      const beforeCount = inMemoryBookings[idx].workPhotos[phase].length;
      inMemoryBookings[idx].workPhotos[phase] = inMemoryBookings[idx].workPhotos[phase].filter((p) => String(p.url || "") !== photoUrl);
      if (beforeCount === inMemoryBookings[idx].workPhotos[phase].length) {
        return res.status(404).json({ message: "Photo not found" });
      }

      broadcastBookingEvent("photo-deleted", inMemoryBookings[idx]);
      return res.json({ message: "Photo deleted", booking: inMemoryBookings[idx] });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (!booking.providerId || String(booking.providerId) !== providerId) {
      return res.status(403).json({ message: "You can delete photos only for your accepted bookings" });
    }

    if (!booking.workPhotos || !Array.isArray(booking.workPhotos[phase])) {
      return res.status(404).json({ message: "Photo not found" });
    }

    const beforeCount = booking.workPhotos[phase].length;
    booking.workPhotos[phase] = booking.workPhotos[phase].filter((p) => String(p.url || "") !== photoUrl);
    if (beforeCount === booking.workPhotos[phase].length) {
      return res.status(404).json({ message: "Photo not found" });
    }

    await booking.save();
    broadcastBookingEvent("photo-deleted", booking);

    // Remove stored file when it is local upload path.
    if (photoUrl.startsWith("/uploads/work-photos/")) {
      const fileName = path.basename(photoUrl);
      const filePath = path.join(workPhotosDir, fileName);
      fs.unlink(filePath, () => {});
    }

    res.json({ message: "Photo deleted", booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting work photo" });
  }
});

app.get("/api/chat/messages", authMiddleware, async (req, res) => {
  try {
    let providerId;
    if (req.user.role === "provider") {
      providerId = String(req.user._id || req.user.id);
    } else if (req.user.role === "admin") {
      providerId = String(req.query.providerId || "").trim();
      if (!providerId) {
        return res.status(400).json({ message: "providerId is required for admin" });
      }
    } else {
      return res.status(403).json({ message: "Only provider/admin chat access allowed" });
    }

    if (useInMemory) {
      const messages = inMemoryChatMessages
        .filter((m) => String(m.providerId) === providerId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return res.json(messages);
    }

    const messages = await ProviderAdminChat.find({ providerId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching chat messages" });
  }
});

app.post("/api/chat/messages", authMiddleware, async (req, res) => {
  try {
    const { providerId: rawProviderId, message } = req.body;
    const text = String(message || "").trim();
    if (!text) {
      return res.status(400).json({ message: "Message is required" });
    }

    let providerId;
    if (req.user.role === "provider") {
      providerId = String(req.user._id || req.user.id);
    } else if (req.user.role === "admin") {
      providerId = String(rawProviderId || "").trim();
      if (!providerId) {
        return res.status(400).json({ message: "providerId is required for admin" });
      }
    } else {
      return res.status(403).json({ message: "Only provider/admin chat access allowed" });
    }

    const senderId = String(req.user._id || req.user.id);
    const senderRole = req.user.role;
    const senderName = req.user.name || senderRole;

    if (useInMemory) {
      const chatMsg = {
        id: inMemoryChatMessages.length + 1,
        providerId,
        senderId,
        senderRole,
        senderName,
        message: text,
        createdAt: new Date()
      };
      inMemoryChatMessages.push(chatMsg);
      return res.status(201).json(chatMsg);
    }

    const saved = await ProviderAdminChat.create({
      providerId,
      senderId,
      senderRole,
      senderName,
      message: text
    });
    res.status(201).json(saved);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error sending chat message" });
  }
});

app.delete("/api/chat/messages", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const providerId = String(req.query.providerId || "").trim();
    if (!providerId) {
      return res.status(400).json({ message: "providerId is required" });
    }

    const providerExists = await User.exists({ _id: providerId, role: "provider", status: "approved" });
    if (!providerExists) {
      return res.status(404).json({ message: "Selected provider not found" });
    }

    if (useInMemory) {
      const beforeCount = inMemoryChatMessages.length;
      inMemoryChatMessages = inMemoryChatMessages.filter((m) => String(m.providerId) !== providerId);
      const deletedCount = beforeCount - inMemoryChatMessages.length;
      return res.json({ message: "Chat history deleted", deletedCount });
    }

    const result = await ProviderAdminChat.deleteMany({ providerId });
    res.json({ message: "Chat history deleted", deletedCount: result.deletedCount || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting chat history" });
  }
});

app.delete("/api/chat/messages/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const messageId = String(req.params.id || "").trim();
    const providerId = String(req.query.providerId || "").trim();
    if (!messageId || !providerId) {
      return res.status(400).json({ message: "message id and providerId are required" });
    }

    const providerExists = await User.exists({ _id: providerId, role: "provider", status: "approved" });
    if (!providerExists) {
      return res.status(404).json({ message: "Selected provider not found" });
    }

    if (useInMemory) {
      const beforeCount = inMemoryChatMessages.length;
      inMemoryChatMessages = inMemoryChatMessages.filter((m) => {
        const sameMessage = String(m.id || m._id || "") === messageId;
        const sameProvider = String(m.providerId) === providerId;
        return !(sameMessage && sameProvider);
      });
      const deletedCount = beforeCount - inMemoryChatMessages.length;
      if (!deletedCount) {
        return res.status(404).json({ message: "Message not found" });
      }
      return res.json({ message: "Message deleted", deletedCount });
    }

    const result = await ProviderAdminChat.deleteOne({ _id: messageId, providerId });
    if (!result.deletedCount) {
      return res.status(404).json({ message: "Message not found" });
    }

    res.json({ message: "Message deleted", deletedCount: result.deletedCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting chat message" });
  }
});

// Provider statistics
app.get("/api/provider/stats", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "provider") {
      return res.status(403).json({ message: "Provider access required" });
    }

    const providerId = String(req.user._id || req.user.id);

    if (useInMemory) {
      const mine = inMemoryBookings.filter((b) => String(b.providerId || "") === providerId);
      const totalBookings = mine.length;
      const completedBookings = mine.filter((b) => b.status === "completed").length;
      const pendingBookings = mine.filter((b) => ["pending", "confirmed"].includes(b.status || "pending")).length;
      const totalEarnings = mine
        .filter((b) => b.status === "completed")
        .reduce((sum, booking) => sum + parseFloat(booking.price || 0), 0);

      return res.json({
        totalBookings,
        completedBookings,
        pendingBookings,
        totalEarnings
      });
    }

    const totalBookings = await Booking.countDocuments({ providerId });
    const completedBookings = await Booking.countDocuments({ providerId, status: "completed" });
    const pendingBookings = await Booking.countDocuments({ providerId, status: { $in: ["pending", "confirmed"] } });

    const completedBookingDocs = await Booking.find({ providerId, status: "completed" }).select("price");
    const totalEarnings = completedBookingDocs.reduce((sum, booking) => sum + parseFloat(booking.price || 0), 0);

    res.json({
      totalBookings,
      completedBookings,
      pendingBookings,
      totalEarnings
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching provider statistics" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
