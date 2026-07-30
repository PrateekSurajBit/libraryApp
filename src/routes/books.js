const express = require('express');
const { getAllBooks, addBook, deleteBook, assignBook, returnBook } = require('../controllers/booksController');

const router = express.Router();

router.get('/', getAllBooks);
router.post('/', addBook);
router.delete('/:id', deleteBook);
router.post('/:id/assign', assignBook);
router.post('/:id/return', returnBook);

module.exports = router;
