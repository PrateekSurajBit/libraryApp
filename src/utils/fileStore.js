const fs = require('fs');
const path = require('path');

const readData = (filename) => {
  try {
    const filePath = path.join(__dirname, '../../data/', filename);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

const writeData = (filename, data) => {
  const filePath = path.join(__dirname, '../../data/', filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

module.exports = { readData, writeData };
