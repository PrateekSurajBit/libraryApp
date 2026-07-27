const express = require('express');
const fs = require('fs');
const path = require('path');
const booksRouter = require('./routes/books');
const usersRouter = require('./routes/users');
//Test changes
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const initializeApp = () => {
  const dataDir = path.join(__dirname, '../data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const booksPath = path.join(dataDir, 'books.json');
  const usersPath = path.join(dataDir, 'users.json');

  if (!fs.existsSync(booksPath)) {
    fs.writeFileSync(booksPath, JSON.stringify([], null, 2), 'utf-8');
  }

  if (!fs.existsSync(usersPath)) {
    fs.writeFileSync(usersPath, JSON.stringify([], null, 2), 'utf-8');
  }
};

app.use('/api/books', booksRouter);
app.use('/api/users', usersRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

initializeApp();

app.listen(PORT, () => {
  console.log(`Library server is running on http://localhost:${PORT}`);
});
