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

const updateBook = (req, res) => {
  const { id } = req.params;
  const { title, author, isbn } = req.body;

  if (!title && !author && !isbn) {
    return res.status(400).json({ error: 'At least one field (title, author, or isbn) is required' });
  }

  const books = readData('books.json');
  const bookIndex = books.findIndex((b) => b.id === id);

  if (bookIndex === -1) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (title) {
    books[bookIndex].title = title;
  }

  if (author) {
    books[bookIndex].author = author;
  }

  if (isbn) {
    books[bookIndex].isbn = isbn;
  }

  writeData('books.json', books);
  res.json({
    message: 'Book updated successfully',
    book: books[bookIndex],
  });
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

module.exports = { getAllBooks, addBook, updateBook, deleteBook };
