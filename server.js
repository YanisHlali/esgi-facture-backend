const express = require("express");
const cors = require("cors");
const db = require("./database");
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun, AlignmentType, BorderStyle } = require('docx');
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
    console.log(facture);
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

  // Create a new Document
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Header
          new Paragraph({
            children: [
              new TextRun({
                text: facture.nom_client,
                bold: true,
                size: 48,
                color: "2E86C1",
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: "",
            spacing: { after: 200 },
          }),

          // Invoice Title
          new Paragraph({
            text: numero_facture,
            heading: "Heading1",
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),

          // Invoice Details
          new Paragraph({
            children: [
              new TextRun({
                text: `Numéro de facture : `,
                bold: true,
              }),
              new TextRun(numero_facture),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Date de création : `,
                bold: true,
              }),
              new TextRun(date_creation),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Montant total TTC : `,
                bold: true,
              }),
              new TextRun(`${parseFloat(montant_total_ttc).toFixed(2)} €`),
            ],
          }),
          new Paragraph({
            text: "",
            spacing: { after: 200 },
          }),

          // Table Header
          new Paragraph({
            text: "Objets de la facture :",
            heading: "Heading2",
            spacing: { after: 200 },
          }),

          // Invoice Items Table
          createTable(objets),

          // Footer
          new Paragraph({
            text: "Merci pour votre confiance !",
            alignment: AlignmentType.CENTER,
            spacing: { before: 400 },
          }),
        ],
      },
    ],
  });

  // Pack the document and send it
  Packer.toBuffer(doc).then((buffer) => {
    res.setHeader("Content-Disposition", `attachment; filename="testtfd${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  });
};

// Helper function to create a styled table for DOCX
const createTable = (objets) => {
  const table = new Table({
    rows: [
      // Header Row
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: "Nom", bold: true, color: "FFFFFF" })],
            shading: {
              fill: "2E86C1",
            },
            width: { size: 20, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ text: "Quantité", bold: true, color: "FFFFFF" })],
            shading: {
              fill: "2E86C1",
            },
            width: { size: 10, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ text: "Prix unitaire HT (€)", bold: true, color: "FFFFFF" })],
            shading: {
              fill: "2E86C1",
            },
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ text: "TVA (%)", bold: true, color: "FFFFFF" })],
            shading: {
              fill: "2E86C1",
            },
            width: { size: 10, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ text: "Total HT (€)", bold: true, color: "FFFFFF" })],
            shading: {
              fill: "2E86C1",
            },
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ text: "Total TTC (€)", bold: true, color: "FFFFFF" })],
            shading: {
              fill: "2E86C1",
            },
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
      // Data Rows
      ...objets.map((objet) => new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph(objet.nom)],
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
          new TableCell({
            children: [new Paragraph(objet.quantite.toString())],
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
          new TableCell({
            children: [new Paragraph(parseFloat(objet.prixunitaire).toFixed(2))],
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
          new TableCell({
            children: [new Paragraph(objet.tva.toString())],
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
          new TableCell({
            children: [new Paragraph(parseFloat(objet.totalHT).toFixed(2))],
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
          new TableCell({
            children: [new Paragraph(parseFloat(objet.totalTTC).toFixed(2))],
            borders: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
        ],
      })),
      // Total Row
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: "Total", bold: true })],
            columnSpan: 4,
            shading: {
              fill: "DDDDDD",
            },
          }),
          new TableCell({
            children: [new Paragraph({ text: parseFloat(objets.reduce((acc, obj) => acc + parseFloat(obj.totalHT), 0)).toFixed(2), bold: true })],
            shading: {
              fill: "DDDDDD",
            },
          }),
          new TableCell({
            children: [new Paragraph({ text: parseFloat(objets.reduce((acc, obj) => acc + parseFloat(obj.totalTTC), 0)).toFixed(2), bold: true })],
            shading: {
              fill: "DDDDDD",
            },
          }),
        ],
      }),
    ],
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.DOTTED, size: 1, color: "CCCCCC" },
      insideVertical: { style: BorderStyle.DOTTED, size: 1, color: "CCCCCC" },
    },
  });

  return table;
};

const generatePdf = (facture, objets, filename, res) => {
  const { numero_facture, date_creation, montant_total_ttc } = facture;
  const pdfDoc = new PDFDocument({ margin: 50, size: 'A4' });

  // Pipe the PDF into a buffer
  let buffers = [];
  pdfDoc.on('data', buffers.push.bind(buffers));
  pdfDoc.on('end', () => {
    const pdfData = Buffer.concat(buffers);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfData);
  });

  // Header Section
  addHeader(pdfDoc, numero_facture);

  // Invoice Title and Details
  addInvoiceDetails(pdfDoc, numero_facture, date_creation, montant_total_ttc);

  // Table Section
  addTableHeader(pdfDoc);
  addTableRows(pdfDoc, objets);

  // Total Calculation and Display
  addTotalSection(pdfDoc, objets);

  // Footer Section
  addFooter(pdfDoc);

  // Finalize PDF file
  pdfDoc.end();
};

// Helper Functions

// Add header section
const addHeader = (pdfDoc, numero_facture) => {
  pdfDoc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor('#2E86C1')
    .text(numero_facture, { align: 'center' })
    .moveDown();
};

// Add invoice details section
const addInvoiceDetails = (pdfDoc, numero_facture, date_creation, montant_total_ttc) => {
  pdfDoc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(numero_facture, { align: 'center' })
    .moveDown()
    .font('Helvetica')
    .fontSize(12)
    .fillColor('#000000')
    .text(`Numéro de facture : ${numero_facture}`)
    .text(`Date de création : ${date_creation}`)
    .text(`Montant total TTC : ${parseFloat(montant_total_ttc).toFixed(2)} €`)
    .moveDown();
};

// Add table header
const addTableHeader = (pdfDoc) => {
  const headerTop = pdfDoc.y;
  const columns = [
    { label: 'Nom', x: 50, width: 80 },
    { label: 'Quantité', x: 150, width: 50 },
    { label: 'Prix unitaire HT (€)', x: 220, width: 100 },
    { label: 'TVA (%)', x: 320, width: 50 },
    { label: 'Total HT (€)', x: 380, width: 100 },
    { label: 'Total TTC (€)', x: 450, width: 100 }
  ];

  // Draw background color for header
  pdfDoc
    .rect(columns[0].x - 10, headerTop, 500, 20)
    .fill('#2E86C1');

  // Set text properties for header text
  pdfDoc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#FFFFFF');

  // Add text for each header column
  columns.forEach(col => {
    pdfDoc.text(col.label, col.x, headerTop + 5, { width: col.width, align: 'left' });
  });

  pdfDoc.moveDown();
};


// Add table rows
const addTableRows = (pdfDoc, objets) => {
  const rowTop = pdfDoc.y;
  const itemX = 50, qtyX = 150, priceX = 220, tvaX = 320, totalHTX = 380, totalTTCX = 450;

  pdfDoc.fillColor('#000000').font('Helvetica').fontSize(12);

  objets.forEach((objet, index) => {
    const y = rowTop + index * 20;

    pdfDoc
      .text(objet.nom, itemX, y, { width: 80, align: 'left' })
      .text(objet.quantite.toString(), qtyX, y, { width: 50, align: 'left' })
      .text(parseFloat(objet.prixunitaire).toFixed(2), priceX, y, { width: 100, align: 'left' })
      .text(objet.tva.toString(), tvaX, y, { width: 50, align: 'left' })
      .text(parseFloat(objet.totalHT).toFixed(2), totalHTX, y, { width: 100, align: 'left' })
      .text(parseFloat(objet.totalTTC).toFixed(2), totalTTCX, y, { width: 100, align: 'left' });

    // Draw line separator
    pdfDoc
      .strokeColor('#CCCCCC')
      .lineWidth(0.5)
      .moveTo(itemX - 10, y + 15)
      .lineTo(itemX + 490, y + 15)
      .stroke();
  });

  pdfDoc.moveDown();
};

// Add total section
// Updated total section function
const addTotalSection = (pdfDoc, objets) => {
  const totalHT = objets.reduce((acc, obj) => acc + parseFloat(obj.totalHT), 0).toFixed(2);
  const totalTTC = objets.reduce((acc, obj) => acc + parseFloat(obj.totalTTC), 0).toFixed(2);

  // Add spacing before the total row
  pdfDoc.moveDown(2);

  // Set the y-position based on the current position and add some padding
  const yTotal = pdfDoc.y + 10;

  // Draw Total HT and Total TTC labels and values
  pdfDoc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Total HT (€):', 380 - 100, yTotal, { width: 100, align: 'right' })
    .text(totalHT, 380, yTotal, { width: 100, align: 'left' })
    .text('Total TTC (€):', 450 - 100, yTotal + 20, { width: 100, align: 'right' })
    .text(totalTTC, 450, yTotal + 20, { width: 100, align: 'left' });

  pdfDoc.moveDown(2); // Add additional spacing if needed
};

// Updated footer function
const addFooter = (pdfDoc) => {
  // Ensure the footer is positioned towards the bottom of the page
  const pageHeight = pdfDoc.page.height;
  const footerY = pageHeight - 50; // Position footer 50 units from the bottom

  pdfDoc
    .font('Helvetica-Oblique')
    .fontSize(12)
    .fillColor('#555555')
    .text('Merci pour votre confiance !', 50, footerY, { align: 'center', width: pdfDoc.page.width - 100 });
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
