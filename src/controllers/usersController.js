const { readData, writeData } = require('../utils/fileStore');

const getAllUsers = (req, res) => {
  const users = readData('users.json');
  res.json(users);
};

const addUser = (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const users = readData('users.json');

  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already exists' });
  }

  const newUser = {
    id: `u_${Date.now()}`,
    name,
    email,
    assignedBooks: [],
  };

  users.push(newUser);
  writeData('users.json', users);
  res.status(201).json(newUser);
};

const deleteUser = (req, res) => {
  const { id } = req.params;
  const users = readData('users.json');

  const userIndex = users.findIndex((u) => u.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (users[userIndex].assignedBooks.length > 0) {
    return res
      .status(409)
      .json({ error: 'User has books checked out. Return them first.' });
  }

  users.splice(userIndex, 1);
  writeData('users.json', users);
  res.json({ message: 'User deleted' });
};

const assignBook = (req, res) => {
  const { userId, bookId } = req.params;
  let { durationDays } = req.body;

  const users = readData('users.json');
  const books = readData('books.json');

  if (durationDays === undefined) {
    durationDays = 14;
  } else if (typeof durationDays !== 'number' || durationDays <= 0) {
    return res.status(400).json({ error: 'durationDays must be a positive number' });
  }

  const userIndex = users.findIndex((u) => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const bookIndex = books.findIndex((b) => b.id === bookId);
  if (bookIndex === -1) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (books[bookIndex].assignedTo !== null) {
    return res
      .status(409)
      .json({ error: 'Book is already assigned to another user' });
  }

  if (users[userIndex].assignedBooks.includes(bookId)) {
    return res.status(409).json({ error: 'Book is already assigned to this user' });
  }

  const assignedDate = new Date();
  const dueDate = new Date(assignedDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  books[bookIndex].assignedTo = userId;
  books[bookIndex].durationDays = durationDays;
  books[bookIndex].assignedDate = assignedDate.toISOString();
  books[bookIndex].dueDate = dueDate.toISOString();
  users[userIndex].assignedBooks.push(bookId);

  writeData('books.json', books);
  writeData('users.json', users);

  res.json({
    message: 'Book assigned to user',
    user: users[userIndex],
    book: books[bookIndex],
  });
};

const unassignBook = (req, res) => {
  const { userId, bookId } = req.params;

  const users = readData('users.json');
  const books = readData('books.json');

  const userIndex = users.findIndex((u) => u.id === userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const bookIndex = books.findIndex((b) => b.id === bookId);
  if (bookIndex === -1) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (books[bookIndex].assignedTo !== userId) {
    return res
      .status(409)
      .json({ error: 'Book is not assigned to this user' });
  }

  books[bookIndex].assignedTo = null;
  books[bookIndex].durationDays = null;
  books[bookIndex].assignedDate = null;
  books[bookIndex].dueDate = null;
  users[userIndex].assignedBooks = users[userIndex].assignedBooks.filter(
    (id) => id !== bookId
  );

  writeData('books.json', books);
  writeData('users.json', users);

  res.json({
    message: 'Book unassigned from user',
    user: users[userIndex],
    book: books[bookIndex],
  });
};

module.exports = { getAllUsers, addUser, deleteUser, assignBook, unassignBook };
