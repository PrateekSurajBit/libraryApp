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

module.exports = { getAllBooks, addBook, deleteBook };
