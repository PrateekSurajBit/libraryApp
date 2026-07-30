const express = require('express');
const {
  getAllUsers,
  addUser,
  deleteUser,
  updateUser,
  assignBook,
  unassignBook,
} = require('../controllers/usersController');

const router = express.Router();

router.get('/', getAllUsers);
router.post('/', addUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.post('/:userId/assign/:bookId', assignBook);
router.delete('/:userId/assign/:bookId', unassignBook);

module.exports = router;
