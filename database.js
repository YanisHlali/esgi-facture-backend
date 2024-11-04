const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'mysql-yanishlali.alwaysdata.net',
    user: '220794',
    password: 'T&$$6e!xyF%dXj',
    database: 'yanishlali_facture'
});

db.connect((err) => {
  if (err) {
    console.error('Erreur de connexion à MySQL:', err.message);
  } else {
    console.log('Connecté à la base de données MySQL.');
  }
});

module.exports = db;
