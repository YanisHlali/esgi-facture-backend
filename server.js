const express = require("express");
const cors = require("cors");
const db = require("./database");
const { Document, Packer, Paragraph } = require("docx");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get("/api/factures", (req, res) => {
  const sql = "SELECT * FROM factures";
  db.query(sql, (err, rows) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des factures:",
        err.message
      );
      res
        .status(500)
        .json({ error: "Erreur lors de la récupération des factures." });
    } else {
      res.json(rows);
    }
  });
});

app.post("/api/factures", (req, res) => {
  const {
    id_regles_gestion,
    nom_client,
    adresse,
    numero_facture,
    date_creation,
    objets,
  } = req.body;

  const montant_total_ttc = objets.reduce(
    (total, obj) => total + parseFloat(obj.total_ttc),
    0
  );

  const sql = `
    INSERT INTO factures (id_client, numero_facture, date_creation, montant_total_ttc, status)
    VALUES (?, ?, ?, ?, ?)
  `;
  const params = [
    id_regles_gestion,
    numero_facture,
    date_creation,
    montant_total_ttc,
    "en attente",
  ];

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error("Erreur lors de l'insertion de la facture:", err.message);
      res
        .status(500)
        .json({ error: "Erreur lors de la création de la facture." });
    } else {
      res.status(200).json({
        message: "Facture créée avec succès",
        factureId: result.insertId,
      });
    }
  });
});

app.get("/api/factures/generer/:factureId", async (req, res) => {
  const { factureId } = req.params;
  const { format } = req.query;

  const sql = `
    SELECT factures.*, regles_gestion.format_numero
    FROM factures
    JOIN regles_gestion ON factures.id_client = regles_gestion.id_client
    WHERE factures.id = ?
  `;

  db.query(sql, [factureId], async (err, rows) => {
    if (err || rows.length === 0) {
      console.error(
        "Erreur lors de la récupération de la facture:",
        err ? err.message : "Facture introuvable"
      );
      return res.status(404).json({ error: "Facture introuvable." });
    }

    const facture = rows[0];
    const { numero_facture, date_creation, montant_total_ttc } = facture;
    const safeFilename = `${numero_facture.replace(
      /[^a-zA-Z0-9]/g,
      "_"
    )}.${format}`;

    if (format === "docx") {
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({ text: "Facture", heading: "Heading1" }),
              new Paragraph(`Numéro de facture : ${numero_facture}`),
              new Paragraph(`Date de création : ${date_creation}`),
              new Paragraph(
                `Montant total TTC : ${parseFloat(montant_total_ttc).toFixed(
                  2
                )} €`
              ),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename}"`
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );

      res.send(buffer);
    } else if (format === "pdf") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename}"`
      );
      res.setHeader("Content-Type", "application/pdf");

      const pdfDoc = new PDFDocument();
      pdfDoc.pipe(res);
      pdfDoc.fontSize(25).text("Facture", { align: "center" });
      pdfDoc.moveDown();
      pdfDoc.fontSize(14).text(`Numéro de facture : ${numero_facture}`);
      pdfDoc.text(`Date de création : ${date_creation}`);
      pdfDoc.text(
        `Montant total TTC : ${parseFloat(montant_total_ttc).toFixed(2)} €`
      );
      pdfDoc.end();
    } else {
      res
        .status(400)
        .json({ error: 'Format non supporté. Utilisez "docx" ou "pdf".' });
    }
  });
});

app.get("/api/factures/next-number", (req, res) => {
  const { id_regles_gestion, date_creation } = req.query;

  const sqlRegle = "SELECT format_numero FROM regles_gestion WHERE id = ?";
  db.query(sqlRegle, [id_regles_gestion], (err, regleRows) => {
    if (err || regleRows.length === 0) {
      console.error("Erreur lors de la récupération de la règle de gestion:", err ? err.message : "Règle introuvable");
      return res.status(404).json({ error: "Règle de gestion introuvable." });
    }

    const formatNumero = regleRows[0].format_numero;
    const annee = new Date(date_creation).getFullYear();
    const mois = String(new Date(date_creation).getMonth() + 1).padStart(2, "0");

    const sqlNumero = `
      SELECT MAX(SUBSTRING_INDEX(numero_facture, '#', -1)) AS dernier_numero
      FROM factures
      WHERE id_client = ? AND YEAR(date_creation) = ? AND MONTH(date_creation) = ?
    `;

    db.query(sqlNumero, [id_regles_gestion, annee, mois], (err, result) => {
      if (err) {
        console.error("Erreur lors de la récupération du dernier numéro:", err.message);
        return res.status(500).json({ error: "Erreur lors de la génération du numéro de facture." });
      }

      const dernierNumero = result[0].dernier_numero ? parseInt(result[0].dernier_numero) : 0;
      const numero = dernierNumero + 1;

      const numero_facture = formatNumero
        .replace("{nom_client}", `Client-${id_regles_gestion}`)
        .replace("{annee}", annee)
        .replace("{mois}", mois)
        .replace("{numero}", String(numero).padStart(3, "0"));

      res.json({ numero_facture });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Serveur en cours d'exécution sur http://localhost:${PORT}`);
});
