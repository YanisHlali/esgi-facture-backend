const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

db.connect((err) => {
  if (err) {
    console.error('Erreur de connexion à MySQL:', err.message);
  } else {
    console.log('Connecté à la base de données MySQL.');
  }
});

module.exports = db;
