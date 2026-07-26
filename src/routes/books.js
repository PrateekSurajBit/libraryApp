const express = require('express');
const { getAllBooks, addBook, deleteBook } = require('../controllers/booksController');

const router = express.Router();

router.get('/', getAllBooks);
router.post('/', addBook);
router.delete('/:id', deleteBook);

module.exports = router;
