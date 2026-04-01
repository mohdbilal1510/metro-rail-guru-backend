// ═══════════════════════════════════════════════════════════════════
//  Metro Rail Guru — Backend API Server
//  Stack: Node.js + Express + MongoDB (Mongoose) + JWT + Nodemailer
// ═══════════════════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow your frontend origin
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:5500',   // Live Server (VS Code)
    'http://127.0.0.1:5500',
    'https://metrorailguru.in',
    'https://www.metrorailguru.in',
    'https://app.metrorailguru.in'
  ],
  credentials: true
}));

// Rate limiting — protect all routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many auth attempts, please try again later.' }
});
app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

// ─────────────────────────────────────────────────────────────────
//  DATABASE — MongoDB
// ─────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/metrorailguru')
  .then(() => console.log('✅  MongoDB connected'))
  .catch(err => {
    console.error('❌  MongoDB connection error:', err.message);
    console.log('⚠️   Running without DB — subscribe & contact routes will still accept data');
  });

// ─────────────────────────────────────────────────────────────────
//  MONGOOSE SCHEMAS & MODELS
// ─────────────────────────────────────────────────────────────────

// User
const userSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true, minlength: 6 },
  role:      { type: String, enum: ['user', 'admin'], default: 'user' },
  enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
  createdAt: { type: Date, default: Date.now }
});
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};
const User = mongoose.model('User', userSchema);

// Course
const courseSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  slug:        { type: String, required: true, unique: true },
  category:    { type: String, enum: ['ohe', 'traction', 'em', 'interview'], required: true },
  tag:         String,
  level:       { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Intermediate' },
  description: String,
  price:       { type: Number, required: true },
  priceDisplay:String,
  videos:      { type: Number, default: 0 },
  hours:       { type: Number, default: 0 },
  highlights:  [String],
  syllabus:    [String],
  featured:    { type: Boolean, default: false },
  published:   { type: Boolean, default: true },
  enrollments: { type: Number, default: 0 },
  createdAt:   { type: Date, default: Date.now }
});
const Course = mongoose.model('Course', courseSchema);

// Blog
const blogSchema = new mongoose.Schema({
  title:     { type: String, required: true },
  slug:      { type: String, required: true, unique: true },
  category:  { type: String, enum: ['ohe', 'traction', 'em', 'exam'], required: true },
  tag:       String,
  desc:      String,
  content:   String,
  readTime:  String,
  published: { type: Boolean, default: true },
  author:    { type: String, default: 'Mohd Bilal' },
  createdAt: { type: Date, default: Date.now }
});
const Blog = mongoose.model('Blog', blogSchema);

// Subscriber
const subscriberSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  source:     { type: String, default: 'website' },
  active:     { type: Boolean, default: true },
  createdAt:  { type: Date, default: Date.now }
});
const Subscriber = mongoose.model('Subscriber', subscriberSchema);

// Contact
const contactSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, lowercase: true },
  phone:     String,
  type:      { type: String, enum: ['course','corporate','consulting','content','other'], default: 'other' },
  org:       String,
  message:   { type: String, required: true },
  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);

// Enrollment
const enrollmentSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  email:      { type: String, required: true, lowercase: true },
  phone:      String,
  courseId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  courseTitle:String,
  price:      String,
  status:     { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
  paymentId:  String,
  createdAt:  { type: Date, default: Date.now }
});
const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

// ─────────────────────────────────────────────────────────────────
//  EMAIL TRANSPORTER
// ─────────────────────────────────────────────────────────────────
const https = require('https');

async function sendEmail(to, subject, html) {
  if (!process.env.BREVO_API_KEY) {
    console.log(`📧  [MOCK EMAIL] To: ${to} | Subject: ${subject}`);
    return;
  }
  const data = JSON.stringify({
    sender: { name: process.env.FROM_NAME || 'Metro Rail Guru', email: process.env.FROM_EMAIL || 'mohdbilal1510@gmail.com' },
    to: [{ email: to }],
    subject,
    htmlContent: html
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`📧  Email sent to ${to}`);
        } else {
          console.error(`📧  Email error: ${body}`);
        }
        resolve();
      });
    });
    req.on('error', (err) => {
      console.error('📧  Email error:', err.message);
      resolve();
    });
    req.write(data);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────
//  JWT MIDDLEWARE
// ─────────────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ error: 'Not authorised — no token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_change_me');
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ error: 'User no longer exists' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────────────────────────
//  ROUTES — AUTH
// ─────────────────────────────────────────────────────────────────
// POST /api/auth/register
app.post('/api/auth/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;
      const existing = await User.findOne({ email });
      if (existing) return res.status(400).json({ error: 'Email already registered' });
      const user = await User.create({ name, email, password });
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      res.status(201).json({
        success: true,
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/auth/login
app.post('/api/auth/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback_secret_change_me', { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      res.json({
        success: true,
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/auth/me
app.get('/api/auth/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─────────────────────────────────────────────────────────────────
//  ROUTES — COURSES
// ─────────────────────────────────────────────────────────────────
// GET /api/courses  (public — supports ?category=ohe&featured=true)
app.get('/api/courses', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.featured === 'true') filter.featured = true;
    const courses = await Course.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: courses.length, data: courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/courses/:slug  (public)
app.get('/api/courses/:slug', async (req, res) => {
  try {
    const course = await Course.findOne({ slug: req.params.slug, published: true });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json({ success: true, data: course });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/courses  (admin)
app.post('/api/courses', protect, adminOnly,
  [
    body('title').trim().notEmpty(),
    body('slug').trim().notEmpty(),
    body('category').isIn(['ohe','traction','em','interview']),
    body('price').isNumeric()
  ],
  validate,
  async (req, res) => {
    try {
      const course = await Course.create(req.body);
      res.status(201).json({ success: true, data: course });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /api/courses/:id  (admin)
app.put('/api/courses/:id', protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json({ success: true, data: course });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/courses/:id  (admin)
app.delete('/api/courses/:id', protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json({ success: true, message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  ROUTES — ENROLL
// ─────────────────────────────────────────────────────────────────
// POST /api/courses/:id/enroll  (public — creates enrollment, triggers email)
app.post('/api/courses/:id/enroll',
  [
    body('name').trim().notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required')
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, phone, price, course: courseTitle } = req.body;
      const enrollment = await Enrollment.create({
        name, email, phone,
        courseId: req.params.id !== 'undefined' ? req.params.id : undefined,
        courseTitle,
        price,
        status: 'pending'
      });

      // Email to student
      await sendEmail(email, `Enrollment Received — ${courseTitle} | Metro Rail Guru`,
        `<div style="font-family:sans-serif;max-width:600px;margin:auto;">
          <div style="background:#0A1628;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#F5C518;margin:0;font-size:1.4rem;">Metro Rail Guru</h2>
          </div>
          <div style="background:#0F1F3D;padding:32px;border-radius:0 0 12px 12px;color:#9CA3AF;">
            <h3 style="color:#fff;margin-top:0;">Hi ${name}, we've received your enrollment!</h3>
            <p><strong style="color:#F5C518;">Course:</strong> <span style="color:#fff;">${courseTitle}</span></p>
            <p><strong style="color:#F5C518;">Amount:</strong> <span style="color:#fff;">${price}</span></p>
            <p>We'll send payment instructions and course access details shortly. For any queries, reply to this email or contact us on Telegram: <a href="https://t.me/MetroRailGuru" style="color:#F5C518;">@MetroRailGuru</a></p>
            <div style="margin-top:24px;padding:16px;background:#162545;border-radius:8px;border-left:3px solid #F5C518;">
              <p style="margin:0;color:#fff;font-size:.9rem;">Meanwhile, join our free Telegram community for PDF notes and doubt-clearing sessions.</p>
            </div>
            <p style="margin-top:24px;color:#6B7280;font-size:.8rem;">Metro Rail Guru · India's #1 Metro Electrical Engineering Resource</p>
          </div>
        </div>`
      );

      // Email to admin
      await sendEmail(
        process.env.ADMIN_EMAIL || process.env.SMTP_USER,
        `🎓 New Enrollment — ${courseTitle}`,
        `<p><strong>Name:</strong> ${name}</p>
         <p><strong>Email:</strong> ${email}</p>
         <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
         <p><strong>Course:</strong> ${courseTitle}</p>
         <p><strong>Price:</strong> ${price}</p>
         <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN')}</p>`
      );

      res.status(201).json({ success: true, message: 'Enrollment received! Check your email.', data: { id: enrollment._id } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/enrollments  (admin)
app.get('/api/enrollments', protect, adminOnly, async (req, res) => {
  try {
    const enrollments = await Enrollment.find().sort({ createdAt: -1 });
    res.json({ success: true, count: enrollments.length, data: enrollments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  ROUTES — BLOG
// ─────────────────────────────────────────────────────────────────
// GET /api/blogs  (public)
app.get('/api/blogs', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.category) filter.category = req.query.category;
    const blogs = await Blog.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: blogs.length, data: blogs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/blogs/:slug  (public)
app.get('/api/blogs/:slug', async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug, published: true });
    if (!blog) return res.status(404).json({ error: 'Article not found' });
    res.json({ success: true, data: blog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/blogs  (admin)
app.post('/api/blogs', protect, adminOnly,
  [body('title').trim().notEmpty(), body('slug').trim().notEmpty(), body('category').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const blog = await Blog.create(req.body);
      res.status(201).json({ success: true, data: blog });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /api/blogs/:id  (admin)
app.put('/api/blogs/:id', protect, adminOnly, async (req, res) => {
  try {
    const blog = await Blog.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!blog) return res.status(404).json({ error: 'Article not found' });
    res.json({ success: true, data: blog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/blogs/:id  (admin)
app.delete('/api/blogs/:id', protect, adminOnly, async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) return res.status(404).json({ error: 'Article not found' });
    res.json({ success: true, message: 'Article deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  ROUTES — SUBSCRIBE
// ─────────────────────────────────────────────────────────────────
// POST /api/subscribe  (public)
app.post('/api/subscribe',
  [body('email').isEmail().withMessage('Valid email required')],
  validate,
  async (req, res) => {
    try {
      const { email } = req.body;
      let subscriber;
      try {
        subscriber = await Subscriber.create({ email });
      } catch (err) {
        if (err.code === 11000) {
          // Already subscribed — still send success
          return res.json({ success: true, message: 'Already subscribed!' });
        }
        throw err;
      }

      // Welcome email to subscriber
      await sendEmail(email, 'Welcome to Metro Rail Guru — Your Free OHE PDF is Here 🚄',
        `<div style="font-family:sans-serif;max-width:600px;margin:auto;">
          <div style="background:#0A1628;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#F5C518;margin:0;">Metro Rail Guru</h2>
            <p style="color:#9CA3AF;margin:8px 0 0;font-size:.85rem;">India's #1 Metro Electrical Engineering Resource</p>
          </div>
          <div style="background:#0F1F3D;padding:32px;border-radius:0 0 12px 12px;color:#9CA3AF;">
            <h3 style="color:#fff;margin-top:0;">Welcome aboard! 🎉</h3>
            <p>Thank you for subscribing. You're now part of a growing community of metro rail engineers and aspirants across India.</p>
            <div style="background:#162545;border:1px solid rgba(245,197,24,.2);border-radius:10px;padding:20px;margin:20px 0;">
              <p style="color:#F5C518;font-weight:bold;margin:0 0 8px;">📥 Your Free PDF — 25 kV OHE Design Quick Reference</p>
              <p style="margin:0;font-size:.88rem;">This guide covers: conductor types, sag-tension basics, stagger rules, clearance requirements, and commissioning checkpoints — all in one reference sheet.</p>
              <p style="margin:12px 0 0;font-size:.82rem;color:#6B7280;">(We'll send the PDF in a follow-up email within 24 hours while we finalise the latest version.)</p>
            </div>
            <p>In the meantime, join our free Telegram community for live Q&A, PDF notes, and job alerts:</p>
            <div style="text-align:center;margin:20px 0;">
              <a href="https://t.me/MetroRailGuru" style="background:#2AABEE;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Join Telegram Community →</a>
            </div>
            <p>Also subscribe on YouTube for free technical videos:</p>
            <div style="text-align:center;margin:20px 0;">
              <a href="https://www.youtube.com/@MetroRailGuru" style="background:#FF0000;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Subscribe on YouTube →</a>
            </div>
            <p style="margin-top:24px;color:#6B7280;font-size:.78rem;">You're receiving this because you subscribed at metrorailguru.in. <a href="#" style="color:#F5C518;">Unsubscribe</a></p>
          </div>
        </div>`
      );

      // Notify admin
      await sendEmail(
        process.env.ADMIN_EMAIL || process.env.SMTP_USER,
        `📬 New Subscriber — ${email}`,
        `<p>New subscriber: <strong>${email}</strong></p><p>Time: ${new Date().toLocaleString('en-IN')}</p><p>Total subscribers: ${await Subscriber.countDocuments({ active: true })}</p>`
      );

      res.status(201).json({ success: true, message: 'Subscribed! Check your inbox for the free PDF.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/subscribers  (admin)
app.get('/api/subscribers', protect, adminOnly, async (req, res) => {
  try {
    const subscribers = await Subscriber.find({ active: true }).sort({ createdAt: -1 });
    res.json({ success: true, count: subscribers.length, data: subscribers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  ROUTES — CONTACT
// ─────────────────────────────────────────────────────────────────
// POST /api/contact  (public)
app.post('/api/contact',
  [
    body('name').trim().notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('message').trim().isLength({ min: 10 }).withMessage('Message must be at least 10 characters')
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, phone, type, org, message } = req.body;
      const contact = await Contact.create({ name, email, phone, type, org, message });

      // Auto-reply to sender
      await sendEmail(email, `We've received your message — Metro Rail Guru`,
        `<div style="font-family:sans-serif;max-width:600px;margin:auto;">
          <div style="background:#0A1628;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
            <h2 style="color:#F5C518;margin:0;">Metro Rail Guru</h2>
          </div>
          <div style="background:#0F1F3D;padding:32px;border-radius:0 0 12px 12px;color:#9CA3AF;">
            <h3 style="color:#fff;margin-top:0;">Hi ${name}, message received!</h3>
            <p>Thank you for reaching out. I'll respond to your inquiry within <strong style="color:#F5C518;">24 hours</strong>.</p>
            <div style="background:#162545;border-left:3px solid #F5C518;padding:16px;border-radius:0 8px 8px 0;margin:20px 0;">
              <p style="margin:0;color:#9CA3AF;font-size:.88rem;"><strong style="color:#fff;">Your message:</strong><br/>${message}</p>
            </div>
            <p>While you wait, join our free Telegram community: <a href="https://t.me/MetroRailGuru" style="color:#F5C518;">@MetroRailGuru</a></p>
            <p style="color:#6B7280;font-size:.78rem;margin-top:24px;">Metro Rail Guru · India's #1 Metro Electrical Engineering Resource</p>
          </div>
        </div>`
      );

      // Notify admin
      await sendEmail(
        process.env.ADMIN_EMAIL || process.env.SMTP_USER,
        `📩 New Contact — ${type || 'General'} from ${name}`,
        `<h3>New Contact Submission</h3>
         <p><strong>Name:</strong> ${name}</p>
         <p><strong>Email:</strong> ${email}</p>
         <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
         <p><strong>Type:</strong> ${type || 'N/A'}</p>
         <p><strong>Organisation:</strong> ${org || 'N/A'}</p>
         <p><strong>Message:</strong></p>
         <blockquote style="border-left:3px solid #F5C518;padding-left:16px;color:#555;">${message}</blockquote>
         <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN')}</p>`
      );

      res.status(201).json({ success: true, message: 'Message received! We\'ll respond within 24 hours.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/contact  (admin)
app.get('/api/contact', protect, adminOnly, async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.json({ success: true, count: contacts.length, data: contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/contact/:id/read  (admin)
app.patch('/api/contact/:id/read', protect, adminOnly, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    res.json({ success: true, data: contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  ROUTES — ADMIN DASHBOARD STATS
// ─────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', protect, adminOnly, async (req, res) => {
  try {
    const [subscribers, contacts, courses, blogs, enrollments, unreadContacts, pendingEnrollments] = await Promise.all([
      Subscriber.countDocuments({ active: true }),
      Contact.countDocuments(),
      Course.countDocuments({ published: true }),
      Blog.countDocuments({ published: true }),
      Enrollment.countDocuments(),
      Contact.countDocuments({ read: false }),
      Enrollment.countDocuments({ status: 'pending' }),
    ]);
    const recentEnrollments = await Enrollment.find().sort({ createdAt: -1 }).limit(5);
    const recentContacts   = await Contact.find().sort({ createdAt: -1 }).limit(5);
    res.json({
      success: true,
      data: {
        subscribers, contacts, courses, blogs, enrollments,
        unreadContacts, pendingEnrollments,
        recentEnrollments, recentContacts
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  SEED ROUTE — Populate sample data (run once)
// ─────────────────────────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
  try {
    await Course.deleteMany({});
    await Blog.deleteMany({});

    await Course.insertMany([
      {
        title: 'Complete 25 kV OHE Design & Construction',
        slug: '25kv-ohe-design-construction',
        category: 'ohe', tag: 'OHE', level: 'Intermediate',
        description: 'From conductor selection to commissioning — every aspect of 25 kV overhead equipment design for metro rail.',
        price: 3499, priceDisplay: '₹3,499', videos: 24, hours: 18, featured: true,
        highlights: ['Conductor types, sag-tension, stagger','OHE for tunnels, bridges, depots','Erection, registration, commissioning','Protection & earthing scheme'],
        syllabus: ['Introduction to Metro OHE Systems','Catenary & Contact Wire Conductor Design','Sag-Tension Calculation Methods','Stagger Pattern and Overlap Design','OHE for Elevated Viaducts','Tunnel OHE: Rigid vs Flexible','At-grade & Depot OHE Design','Mast & Foundation Design','OHE Earthing & Bonding','Section Insulator & Neutral Section','Tension Length Calculations','OHE Registration & Adjustment','Commissioning Testing Procedures','Protection: Auto-reclose & Distance Relay','SCADA Integration for OHE']
      },
      {
        title: 'Metro Traction Power Systems (1×25 to 2×25 kV)',
        slug: 'metro-traction-power-systems',
        category: 'traction', tag: 'Traction', level: 'Advanced',
        description: 'Complete traction power supply design — grid interface to rail return, including AT system analysis.',
        price: 2999, priceDisplay: '₹2,999', videos: 18, hours: 14,
        highlights: ['TSS layout & transformer sizing','AT placement optimization','Load flow & voltage regulation','Fault analysis & protection coordination'],
        syllabus: ['Traction Power System Overview','132/25 kV Traction Substation Design','1×25 kV vs 2×25 kV Comparison','Auto-Transformer Theory & Placement','Load Flow Analysis Methodology','Voltage Regulation & Power Quality','Fault Level Calculations','Distance Relay for Traction Feeders','Negative Feeder & Return Circuit','Stray Current Control','SCADA for Traction Power','Sectioning & Paralleling Posts','Emergency Power Supply Schemes','Testing & Commissioning of TSS']
      },
      {
        title: 'Metro Station Electrical & Mechanical Systems',
        slug: 'metro-station-em-systems',
        category: 'em', tag: 'E&M Systems', level: 'Intermediate',
        description: 'Complete coverage of station E&M — HVAC, FAS, BMS, tunnel ventilation, power supply, and emergency systems.',
        price: 2499, priceDisplay: '₹2,499', videos: 20, hours: 16,
        highlights: ['HVAC in normal & fire mode','FAS design & integration','BMS & SCADA architecture','Emergency power & UPS sizing'],
        syllabus: ['Station E&M System Overview','HV Power Supply to Stations','Station Transformer & LV Distribution','Emergency Power & UPS Systems','Normal Ventilation System Design','HVAC Design for Concourse & Platform','Fire Mode Ventilation (Smoke Control)','Fire Alarm System Architecture','Fire Suppression Systems','IBMS & BMS Integration','Public Address & CCTV Systems','Escalators & Lifts (MEP view)','Tunnel Ventilation','Station Lighting Design','E&M Commissioning & Testing']
      },
      {
        title: 'Metro Interview Preparation Pack (DMRC / LMRC)',
        slug: 'metro-interview-prep-dmrc-lmrc',
        category: 'interview', tag: 'Interview Prep', level: 'Beginner',
        description: '150+ technical questions with expert-level answers. Know exactly what interviewers look for at DMRC, LMRC, BMRC.',
        price: 699, priceDisplay: '₹699', videos: 8, hours: 5,
        highlights: ['150+ DMRC/LMRC questions answered','Common traps & how to avoid them','How to structure technical answers','Last 5-year pattern analysis'],
        syllabus: ['Interview Strategy & Mindset','OHE Technical Q&A: Part 1','OHE Technical Q&A: Part 2','Traction Power Q&A','E&M Systems Q&A','SCADA & Protection Q&A','HR & Situation-based Questions','Mock Interview Session']
      }
    ]);

    await Blog.insertMany([
      {
        title: 'Why Metro Tunnel OHE Design Is Completely Different from Open-Line',
        slug: 'tunnel-ohe-vs-open-line',
        category: 'ohe', tag: 'OHE', readTime: '8 min read', published: true,
        desc: 'Everything you assumed from open-line OHE needs re-evaluation when you enter a tunnel.',
        content: 'Full article content here...'
      },
      {
        title: '2×25 kV vs 1×25 kV: The Real Answer for Metro Systems',
        slug: '2x25kv-vs-1x25kv-metro',
        category: 'traction', tag: 'Traction', readTime: '10 min read', published: true,
        desc: 'The decision to go 2×25 kV is a project economics and corridor length question, not a technical default.',
        content: 'Full article content here...'
      },
      {
        title: 'Metro Station HVAC in Fire Mode: What Actually Happens',
        slug: 'metro-hvac-fire-mode',
        category: 'em', tag: 'E&M Systems', readTime: '7 min read', published: true,
        desc: 'Normal ventilation and fire mode ventilation are entirely different systems operating on opposite logic.',
        content: 'Full article content here...'
      },
      {
        title: 'Top 20 OHE Interview Questions for DMRC & LMRC',
        slug: 'ohe-interview-questions-dmrc-lmrc',
        category: 'exam', tag: 'Exam Prep', readTime: '12 min read', published: true,
        desc: 'Not just the questions — the depth of answer that separates a selected candidate from a rejected one.',
        content: 'Full article content here...'
      }
    ]);

    res.json({ success: true, message: 'Database seeded with 4 courses and 4 articles.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Metro Rail Guru API is running',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Root
app.get('/', (req, res) => {
  res.json({ message: 'Metro Rail Guru API — v1.0.0', docs: '/api/health' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

// ─────────────────────────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚄  Metro Rail Guru API running on http://localhost:${PORT}`);
  console.log(`📊  Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌱  Seed data:    POST http://localhost:${PORT}/api/seed\n`);
});

module.exports = app;
