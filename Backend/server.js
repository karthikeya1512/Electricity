const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;
const JWT_SECRET = "SECRET_KEY";

app.use(cors());
app.use(express.json());

/* ================= PDF DIR ================= */
const invoicesDir = path.join(__dirname, "public", "invoices");
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
}
app.use("/invoices", express.static(invoicesDir));

/* ================= DB (FIXED) ================= */
mongoose
  .connect(
    "mongodb+srv://karthikeyamca25_db_user:Mensa%402026@cluster0.hc5jv6g.mongodb.net/Mensadb"
  )
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

  

/* ================= MODELS ================= */
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    name: String,
    email: String,
    password: String,
  })
);

const Booking = mongoose.model(
  "Booking",
  new mongoose.Schema(
    {
      userId: mongoose.Schema.Types.ObjectId,
      customerName: String,
      companyName: String,
      email: String,
      mobile: String,
      address: String,
      services: [{ serviceName: String, price: Number }],
      totalAmount: Number,
      serviceStatus: { type: String, default: "Incomplete" },
    },
    { timestamps: true }
  )
);

const Invoice = mongoose.model(
  "Invoice",
  new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    bookingId: mongoose.Schema.Types.ObjectId,
    companyName: String,
    service: String,
    amount: Number,
    invoiceStatus: { type: String, default: "Generated" },
    createdAt: { type: Date, default: Date.now },
  })
);





/* ================= AUTH ================= */
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

app.get("/",(req,res)=>{
res.send("Hello world")
})
/* ================= TOKEN VERIFY ================= */
app.get("/verify-token", auth, (req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  res.status(200).json({ success: true });
});


app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await User.create({
      name,
      email,
      password: hashed,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: "1d",
    });

    res.json({
      token,
      name: user.name,
      email: user.email,
    });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= FORGOT PASSWORD ================= */
app.post("/forgot-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    user.password = hashed;
    await user.save();

    res.json({ success: true, message: "Password updated successfully" });

  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});



/* ================= BOOKINGS ================= */
app.post("/booking", auth, async (req, res) => {
  try {

    // ✅ NORMALIZE SERVICES FIRST
    if (req.body.services?.length) {
      req.body.services = req.body.services.map(s => ({
        serviceName: s.serviceName || s.name || "",
        price: s.price || 0
      }));
    }

    // ✅ BUILD service string for invoice
    const serviceString = req.body.services
      ?.map(s => s.serviceName)
      .filter(Boolean)
      .join(", ");

    if (!serviceString) {
      return res.status(400).json({ message: "Service name cannot be empty" });
    }

    // ✅ CREATE BOOKING
    const booking = new Booking({
      userId: req.userId,
      customerName: req.body.customerName,
      companyName: req.body.companyName,
      email: req.body.email,
      mobile: req.body.mobile,
      address: req.body.address,
      services: req.body.services,
      totalAmount: req.body.totalAmount
    });

    await booking.save();

    // ✅ CREATE INVOICE
    const invoice = new Invoice({
  userId: req.userId,
  bookingId: booking._id,
  companyName: booking.companyName,
  service: serviceString,
  amount: booking.totalAmount,
  invoiceStatus: "Generated"
});
    

    await invoice.save();

    res.json({
      success: true,
      message: "Booking & Invoice created successfully"
    });

  } catch (err) {
    console.error("BOOKING ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/all-bookings",   async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= BOOKING STATUS ================= */
app.put("/booking-status/:id", async (req, res) => {
  try {
    const { status } = req.body;

    if (!["Complete", "Incomplete"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { serviceStatus: status },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/booking/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 🔒 validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      {
        customerName: req.body.customerName,
        companyName: req.body.companyName,
        email: req.body.email,
        mobile: req.body.mobile
      },
      { new: true }
    );

    if (!updatedBooking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // ✅ ALWAYS JSON
    res.json(updatedBooking);

  } catch (err) {
    console.error("PUT /booking ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});



app.delete("/booking/:id", async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= INVOICES ================= */
app.get("/my-invoices", auth, async (req, res) => {
  try {
    const invoices = await Invoice.find({ userId: req.userId })
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/all-invoices", async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .sort({ createdAt: -1 });

    res.json(invoices);
  } catch (err) {
    console.error("ALL INVOICES ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});




app.put("/invoice-status/:id", async (req, res) => {
  try {
    const { status } = req.body;

    const allowed = ["Generated", "Approved", "In Progress", "Completed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await Invoice.findByIdAndUpdate(req.params.id, {
      invoiceStatus: status
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});


app.put("/invoice/:id", async (req, res) => {
  const { companyName, service, amount } = req.body;

  const invoice = await Invoice.findByIdAndUpdate(
    req.params.id,
    { companyName, service, amount },
    { new: true }
  );

  if (invoice?.bookingId && service) {
    await Booking.findByIdAndUpdate(invoice.bookingId, {
      services: service.split(",").map(s => ({
        serviceName: s.trim(),
        price: 0
      }))
    });
  }

  res.json({ success: true });
});

app.put("/invoice-reject/:id", async (req, res) => {
  try {
    const updated = await Invoice.findByIdAndUpdate(
      req.params.id,
      { invoiceStatus: "Rejected" },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    res.json({ message: "Booking rejected successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/invoice-confirm/:id", async (req, res) => {
  try {
    const updated = await Invoice.findByIdAndUpdate(
      req.params.id,
      { invoiceStatus: "Confirmed" },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    res.json({ message: "Booking confirmed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});



app.delete("/invoice/:id", async (req, res) => {
  try {
    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= PROFILE (FIXED) ================= */
app.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    const booking = await Booking.findOne({ userId: req.userId })
      .sort({ createdAt: -1 });

    const invoices = await Invoice.find({ userId: req.userId })
      .sort({ createdAt: -1 });

    let serviceNames = "-";
    let mobile = "-";
    let address = "-";

    // ✅ 1. Prefer INVOICE (FINAL billed data)
    if (invoices.length && invoices[0].service) {
      serviceNames = invoices[0].service;
    }

    // ✅ 2. Fallback to BOOKING if no invoice service
    else if (booking?.services?.length) {
      serviceNames = booking.services
        .map(s => s.serviceName)
        .filter(Boolean)
        .join(", ");
    }

    // contact details always from booking
    if (booking) {
      mobile = booking.mobile || "-";
      address = booking.address || "-";
    }

    res.json({
      name: user?.name || "-",
      mobile,
      address,
      service: serviceNames,
      estimate: invoices.length ? `₹${invoices[0].amount}` : "-",
      invoiceStatus: invoices.length ? invoices[0].invoiceStatus : "-"

    });

  } catch (err) {
    console.error("PROFILE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= PDF (UPDATED – NO PAYMENT) ================= */
app.get("/invoice-pdf/:id", auth, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).send("Invoice not found");
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=invoice-${invoice._id}.pdf`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // ===== PROFESSIONAL HEADER =====
const logoPath = path.join(__dirname, "public", "images", "blacklogo.png");

let startY = 50;

// Draw logo if exists
if (fs.existsSync(logoPath)) {
  doc.image(logoPath, 50, startY, { width: 120 });
}

// Company name
doc
  .fontSize(18)
  .text("MENSA POWER CONTROLS", 200, startY + 10);

// Subtitle
doc
  .fontSize(13)
  .text("Invoice / Service Confirmation", 200, startY + 35);

// Line
doc.moveTo(50, 100).lineTo(550, 100).stroke();

// Move cursor safely below header
doc.y = 130;


    // BODY
    doc.fontSize(12);
    doc.text(`Invoice ID: ${invoice._id}`);
    doc.text(`Company Name: ${invoice.companyName || "-"}`);
    doc.text(`Service(s): ${invoice.service || "-"}`);
    doc.text(`Date: ${invoice.createdAt.toDateString()}`);
    doc.text(`Amount: ₹${invoice.amount}`);
    doc.text(`Status: Booking Confirmed`);

    

    // FOOTER NOTE
    doc.fontSize(10).text(
      "This document confirms the service booking. Payment will be taken after the service is completed.",
      { align: "left" }
    );

    doc.end();
  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).send("Error generating PDF");
  }
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
