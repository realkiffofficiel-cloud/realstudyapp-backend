require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3002;
const DB_FILE = path.join(__dirname, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'realstudyapp-secret-key-change-in-prod';

// ── File-based persistent database ───────────────────────────────────────────
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
  }
  return { users: [], orders: [], nextOrderId: 1 };
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDb();

// Seed admin
if (!db.users.find(u => u.email === 'admin')) {
  db.users.push({
    id: 0,
    name: 'Admin',
    email: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    isAdmin: true,
    createdAt: new Date().toISOString()
  });
  saveDb();
}

// ── Subjects (4 matières) ─────────────────────────────────────────────────────
const subjects = [
  {
    id: 1, name: 'Chimie', color: 'violet', price: 20000, emoji: '⚗️',
    photos: ['/images/chimie1.jpg', '/images/chimie2.jpg', '/images/chimie3.jpg'],
    chapters: ['Structure atomique', 'Réactions chimiques', 'Cinétique chimique', 'Thermodynamique']
  },
  {
    id: 2, name: 'Biologie', color: 'green', price: 10000, emoji: '🧬',
    photos: ['/images/bio2.jpg', '/images/bio3.jpg', '/images/bio2.jpg'],
    chapters: ['La cellule', 'Génétique', 'Évolution', 'Physiologie']
  },
  {
    id: 3, name: 'Physique', color: 'orange', price: 15000, emoji: '⚡',
    photos: ['/images/physique1.jpg', '/images/physique2.jpg', '/images/physique3.jpg'],
    chapters: ['Mécanique', 'Électricité', 'Optique', 'Thermique']
  },
  {
    id: 4, name: 'Mathématiques', color: 'red', price: 18000, emoji: '📐',
    photos: ['/images/math1.jpg', '/images/math2.jpg', '/images/math3.jpg'],
    chapters: ['Algèbre', 'Géométrie', 'Analyse', 'Probabilités']
  }
];

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Accès refusé' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token invalide' });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Accès admin requis' });
  next();
};

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'OK', port: PORT }));

app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Champs manquants' });
  if (db.users.find(u => u.email === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email déjà utilisé' });
  }
  const user = {
    id: Date.now(),
    name,
    email: email.toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    isAdmin: false,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDb();
  res.json({ message: 'Compte créé avec succès.' });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === (email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } });
});

app.get('/subjects', (req, res) => res.json(subjects));

app.post('/orders', authenticateToken, (req, res) => {
  const { subjectId } = req.body;
  const subject = subjects.find(s => s.id === subjectId);
  if (!subject) return res.status(404).json({ error: 'Matière non trouvée' });

  const order = {
    id: db.nextOrderId++,
    userId: req.user.id,
    userName: req.user.name,
    userEmail: req.user.email,
    subject: subject.name,
    emoji: subject.emoji,
    amount: subject.price,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  saveDb();
  res.json({ message: 'Commande enregistrée.', order });
});

app.get('/orders', authenticateToken, (req, res) => {
  const userOrders = db.orders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(userOrders);
});

app.get('/dashboard/student', authenticateToken, (req, res) => {
  const orders = db.orders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ profile: { name: req.user.name, email: req.user.email }, orders });
});

app.get('/dashboard/admin', authenticateToken, requireAdmin, (req, res) => {
  const nonAdmins = db.users.filter(u => !u.isAdmin);
  const stats = {
    totalUsers: nonAdmins.length,
    totalOrders: db.orders.length,
    pendingOrders: db.orders.filter(o => o.status === 'pending').length,
    revenue: db.orders.reduce((sum, o) => sum + o.amount, 0)
  };
  res.json({
    stats,
    users: nonAdmins.map(u => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt })),
    orders: [...db.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

app.put('/orders/:id', authenticateToken, requireAdmin, (req, res) => {
  const order = db.orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Commande non trouvée' });
  order.status = req.body.status || order.status;
  saveDb();
  res.json({ message: 'Commande mise à jour', order });
});

app.listen(PORT, () => console.log(`RealStudyApp Backend — port ${PORT}`));
