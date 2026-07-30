const { readData, writeData } = require('../utils/fileStore');

const getAllBooks = (req, res) => {
  const books = readData('books.json');
  res.json(books);
};

const addBook = (req, res) => {
  const { title, author, isbn } = req.body;

  if (!title || !author) {
    return res.status(400).json({ error: 'title and author are required' });
  }

  const books = readData('books.json');
  const newBook = {
    id: `b_${Date.now()}`,
    title,
    author,
    isbn: isbn || null,
    assignedTo: null,
    durationDays: null,
    assignedDate: null,
    dueDate: null,
  };

  books.push(newBook);
  writeData('books.json', books);
  res.status(201).json(newBook);
};

const deleteBook = (req, res) => {
  const { id } = req.params;
  const books = readData('books.json');

  const bookIndex = books.findIndex((b) => b.id === id);
  if (bookIndex === -1) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (books[bookIndex].assignedTo !== null) {
    return res
      .status(409)
      .json({ error: 'Book is currently assigned to a user. Unassign it first.' });
  }

  books.splice(bookIndex, 1);
  writeData('books.json', books);
  res.json({ message: 'Book deleted' });
};

const assignBook = (req, res) => {
  const { adminId, userId, durationDays } = req.body;

  if (!adminId || !userId) {
    return res.status(400).json({ error: 'adminId and userId are required' });
  }

  const users = readData('users.json');
  const admin = users.find((u) => u.id === adminId);

  if (!admin) {
    return res.status(404).json({ error: 'Admin user not found' });
  }

  if (!admin.isAdmin) {
    return res.status(403).json({ error: 'Only admins can assign books' });
  }

  const user = users.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const books = readData('books.json');
  const { id } = req.params;
  const bookIndex = books.findIndex((b) => b.id === id);

  if (bookIndex === -1) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (books[bookIndex].assignedTo !== null) {
    return res.status(409).json({ error: 'Book is already assigned' });
  }

  if (user.assignedBooks.includes(id)) {
    return res.status(409).json({ error: 'Book is already assigned to this user' });
  }

  const assignedDate = new Date();
  const dueDate = new Date(assignedDate.getTime() + (durationDays || 14) * 24 * 60 * 60 * 1000);

  books[bookIndex].assignedTo = userId;
  books[bookIndex].assignedDate = assignedDate.toISOString();
  books[bookIndex].durationDays = durationDays || 14;
  books[bookIndex].dueDate = dueDate.toISOString();
  user.assignedBooks.push(id);

  writeData('books.json', books);
  writeData('users.json', users);

  res.json({
    message: 'Book assigned successfully',
    book: books[bookIndex],
  });
};

const returnBook = (req, res) => {
  const { adminId } = req.body;

  if (!adminId) {
    return res.status(400).json({ error: 'adminId is required' });
  }

  const users = readData('users.json');
  const admin = users.find((u) => u.id === adminId);

  if (!admin) {
    return res.status(404).json({ error: 'Admin user not found' });
  }

  if (!admin.isAdmin) {
    return res.status(403).json({ error: 'Only admins can return books' });
  }

  const books = readData('books.json');
  const { id } = req.params;
  const bookIndex = books.findIndex((b) => b.id === id);

  if (bookIndex === -1) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (books[bookIndex].assignedTo === null) {
    return res.status(409).json({ error: 'Book is not currently assigned' });
  }

  const userId = books[bookIndex].assignedTo;
  const user = users.find((u) => u.id === userId);

  if (user) {
    user.assignedBooks = user.assignedBooks.filter((bid) => bid !== id);
  }

  books[bookIndex].assignedTo = null;
  books[bookIndex].assignedDate = null;
  books[bookIndex].durationDays = null;
  books[bookIndex].dueDate = null;

  writeData('books.json', books);
  writeData('users.json', users);

  res.json({
    message: 'Book returned successfully',
    book: books[bookIndex],
  });
};

module.exports = { getAllBooks, addBook, deleteBook, assignBook, returnBook };
