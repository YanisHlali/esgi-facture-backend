const express = require("express");
const cors = require("cors");
const db = require("./database");
const { Document, Packer, Paragraph } = require("docx");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

app.get("/api/factures", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM factures");
    res.json(rows);
  } catch (err) {
    console.error("Erreur lors de la récupération des factures:", err.message);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des factures." });
  }
});

app.post("/api/factures", async (req, res) => {
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
  const sqlObjets = `
    INSERT INTO objet_facture (idFacture, nom, quantite, prixunitaire, tva, totalHT, totalTTC)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id_regles_gestion,
    numero_facture,
    date_creation,
    montant_total_ttc,
    "en attente",
  ];

  try {
    const [result] = await db.query(sql, params);
    const factureId = result.insertId; // Store the facture ID after insertion

    console.log("Facture ID:", factureId);
    console.log("Objets:", objets);
    for (const objet of objets) {
      const paramsObjets = [
        factureId, // Use the facture ID here
        objet.objet,
        objet.quantite,
        objet.prix_unitaire_ht,
        objet.tva,
        objet.total_ht,
        objet.total_ttc,
      ];
      try {
        await db.query(sqlObjets, paramsObjets);
      } catch (err) {
        console.error("Erreur lors de l'insertion des objets de la facture:", err.message);
        return res
          .status(500)
          .json({ error: "Erreur lors de l'insertion des objets de la facture." });
      }
    }

    res.status(200).json({
      message: "Facture créée avec succès",
      factureId: factureId,
    });
  } catch (err) {
    console.error("Erreur lors de l'insertion de la facture:", err.message);
    res
      .status(500)
      .json({ error: "Erreur lors de la création de la facture." });
  }
});


app.get("/api/factures/generer/:factureId", async (req, res) => {
  const { factureId } = req.params;
  const { format } = req.query;

  const sqlFacture = `
    SELECT factures.*, regles_gestion.format_numero
    FROM factures
    JOIN regles_gestion ON factures.id_client = regles_gestion.id_client
    WHERE factures.id = ?
  `;

  const sqlObjets = `
    SELECT * FROM objet_facture WHERE idFacture = ?
  `;

  try {
    const [factureRows] = await db.query(sqlFacture, [factureId]);
    const [objetsRows] = await db.query(sqlObjets, [factureId]);

    if (!factureRows.length) return res.status(404).json({ error: "Facture introuvable." });
    if (!objetsRows.length) return res.status(404).json({ error: "Aucun objet trouvé pour cette facture." });

    const facture = factureRows[0];
    const objets = objetsRows;
    const safeFilename = `${facture.numero_facture.replace(/[^a-zA-Z0-9]/g, "_")}.${format}`;
    const { numero_facture, date_creation, montant_total_ttc } = facture;

    if (format === "docx") {
      generateDocx(facture, objets, safeFilename, res);
    } else if (format === "pdf") {
      generatePdf(facture, objets, safeFilename, res);
    } else {
      res.status(400).json({ error: 'Format non supporté. Utilisez "docx" ou "pdf".' });
    }
  } catch (err) {
    console.error("Erreur lors de la génération de la facture:", err.message);
    res.status(500).json({ error: "Erreur lors de la génération de la facture." });
  }
});

const generateDocx = (facture, objets, filename, res) => {
  const { numero_facture, date_creation, montant_total_ttc } = facture;
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Facture", heading: "Heading1" }),
          new Paragraph(`Numéro de facture : ${numero_facture}`),
          new Paragraph(`Date de création : ${date_creation}`),
          new Paragraph(`Montant total TTC : ${parseFloat(montant_total_ttc).toFixed(2)} €`),
          new Paragraph({ text: "Objets de la facture :", heading: "Heading2" }),
          ...objets.flatMap((objet) => [
            new Paragraph({ text: `Nom: ${objet.nom}`, bold: true }),
            new Paragraph(`Quantité: ${objet.quantite}`),
            new Paragraph(`Prix unitaire HT: ${objet.prixunitaire} €`),
            new Paragraph(`TVA: ${objet.tva}%`),
            new Paragraph(`Total HT: ${objet.totalHT} €`),
            new Paragraph(`Total TTC: ${objet.totalTTC} €`),
            new Paragraph(""),
          ]),
        ],
      },
    ],
  });

  Packer.toBuffer(doc).then((buffer) => {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  });
};

const generatePdf = (facture, objets, filename, res) => {
  const { numero_facture, date_creation, montant_total_ttc } = facture;
  const pdfDoc = new PDFDocument();
  pdfDoc.pipe(res);

  pdfDoc.fontSize(20).text("Facture", { align: "center" }).moveDown();
  pdfDoc.fontSize(14).text(`Numéro de facture : ${numero_facture}`);
  pdfDoc.text(`Date de création : ${date_creation}`);
  pdfDoc.text(`Montant total TTC : ${parseFloat(montant_total_ttc).toFixed(2)} €`).moveDown();

  pdfDoc.fontSize(16).text("Objets de la facture :", { underline: true }).moveDown();
  objets.forEach((objet) => {
    pdfDoc.fontSize(12)
      .text(`Nom: ${objet.nom}`, { continued: true })
      .text(` | Quantité: ${objet.quantite}`, { continued: true })
      .text(` | Prix unitaire HT: ${objet.prixunitaire} €`, { continued: true })
      .text(` | TVA: ${objet.tva}%`, { continued: true })
      .text(` | Total HT: ${objet.totalHT} €`, { continued: true })
      .text(` | Total TTC: ${objet.totalTTC} €`)
      .moveDown();
  });

  pdfDoc.end();
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");
};


app.get("/api/factures/next-number", async (req, res) => {
  const { id_regles_gestion, date_creation } = req.query;

  try {
    const [regleRows] = await db.query("SELECT format_numero FROM regles_gestion WHERE id = ?", [id_regles_gestion]);

    if (regleRows.length === 0) {
      console.error("Règle de gestion introuvable.");
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

    const [result] = await db.query(sqlNumero, [id_regles_gestion, annee, mois]);

    const dernierNumero = result[0].dernier_numero ? parseInt(result[0].dernier_numero) : 0;
    const numero = dernierNumero + 1;

    // Génère le numéro de facture en utilisant le format de la règle de gestion
    const numero_facture = formatNumero
      .replace("{nom_client}", `Client-${id_regles_gestion}`)
      .replace("{annee}", annee)
      .replace("{mois}", mois)
      .replace("{numero}", String(numero).padStart(3, "0"));

    res.json({ numero_facture });
  } catch (err) {
    console.error("Erreur lors de la génération du numéro de facture:", err.message);
    res.status(500).json({ error: "Erreur lors de la génération du numéro de facture." });
  }
});

app.get("/api/clients", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, nom FROM clients");
    res.json(rows);
  } catch (err) {
    console.error("Erreur lors de la récupération des clients:", err.message);
    res.status(500).json({ error: "Erreur lors de la récupération des clients." });
  }
});

app.post("/api/clients", async (req, res) => {
  const { nom_client, adresse, siret } = req.body;
  console.log(req.body);

  if (!nom_client || !siret) {
    return res.status(400).json({ error: "Nom du client et SIRET sont requis." });
  }

  const sql = "INSERT INTO clients (nom, adresse, siret) VALUES (?, ?, ?)";
  const params = [nom_client, adresse, siret];

  try {
    const [result] = await db.query(sql, params);
    res.status(200).json({
      message: "Client ajouté avec succès",
      clientId: result.insertId,
    });
  } catch (err) {
    console.error("Erreur lors de l'insertion du client:", err.message);
    res.status(500).json({
      error: "Erreur lors de l'ajout du client.",
      details: err.message,
    });
  }
});

app.get("/api/regles-gestion", async (req, res) => {
  const sql = "SELECT id, description FROM regles_gestion";

  try {
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("Erreur lors de la récupération des règles de gestion:", err.message);
    res.status(500).json({
      error: "Erreur lors de la récupération des règles de gestion.",
    });
  }
});


// marquer une facture en changant le statu de "en attente" à "payée"
app.put("/api/factures/:factureId", async (req, res) => {
  const { factureId } = req.params;
  const sql = "UPDATE factures SET status = 'payée' WHERE id = ?";

  try {
    const [result] = await db.query(sql, [factureId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Facture non trouvée." });
    }

    res.status(200).json({ message: "Facture marquée comme payée." });
  } catch (err) {
    console.error("Erreur lors de la mise à jour de la facture:", err.message);
    res.status(500).json({ error: "Erreur lors de la mise à jour de la facture." });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur en cours d'exécution sur http://localhost:${PORT}`);
});
