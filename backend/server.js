// backend/server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xml2js = require('xml2js');
const Tesseract = require('tesseract.js');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Configuración de almacenamiento local para cargas de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// -------------------------------------------------------------
// RUTA 1: Procesamiento de archivos XML (CFDI 4.0)
// -------------------------------------------------------------
app.post('/api/xml/parse', upload.array('xmlFiles'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se subieron archivos XML.' });
    }

    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
    const extractedData = [];

    for (const file of req.files) {
      const xmlContent = fs.readFileSync(file.path, 'utf8');
      const result = await parser.parseStringPromise(xmlContent);

      const comprobante = result['cfdi:Comprobante'] || result['Comprobante'] || {};
      const emisor = comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {};
      const receptor = comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {};
      const conceptosRaw = comprobante['cfdi:Conceptos']?.['cfdi:Concepto'] || comprobante['Conceptos']?.['Concepto'] || [];
      const conceptosList = Array.isArray(conceptosRaw) ? conceptosRaw : [conceptosRaw];

      const conceptosText = conceptosList
        .map(c => c['$']?.Descripcion || c?.Descripcion || '')
        .join(' | ');

      // Registro de fecha y hora actual de procesamiento
      const now = new Date();
      const fechaCargaFormatted = now.toLocaleString('es-MX', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });

      extractedData.push({
        id: file.filename,
        uuid: comprobante['cfdi:Complemento']?.['tfd:TimbreFiscalDigital']?.['$']?.UUID || 'N/A',
        folio: comprobante['$']?.Folio || 'S/N',
        fecha: comprobante['$']?.Fecha || new Date().toISOString(),
        fechaCarga: fechaCargaFormatted,
        emisorRfc: emisor['$']?.Rfc || 'N/A',
        emisorNombre: emisor['$']?.Nombre || 'N/A',
        receptorRfc: receptor['$']?.Rfc || 'N/A',
        receptorNombre: receptor['$']?.Nombre || 'N/A',
        subtotal: parseFloat(comprobante['$']?.SubTotal || 0),
        total: parseFloat(comprobante['$']?.Total || 0),
        concepto: conceptosText || 'Sin descripción'
      });

      // Limpiar archivo temporal
      fs.unlinkSync(file.path);
    }

    res.json({ success: true, data: extractedData });
  } catch (error) {
    console.error('Error procesando XML:', error);
    res.status(500).json({ error: 'Error al procesar los comprobantes XML.' });
  }
});

// -------------------------------------------------------------
// RUTA 2: OCR de Identificación Oficial (INE desde Móvil)
// -------------------------------------------------------------
app.post('/api/ine/scan', upload.single('ineImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen de INE.' });
    }

    // Ejecución de OCR con Tesseract en español
    const { data: { text } } = await Tesseract.recognize(req.file.path, 'spa');

    // Expresiones regulares para filtrado de campos clave
    const curpMatch = text.match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/);
    const claveElectorMatch = text.match(/[A-Z]{6}\d{8}[HM]\d{3}/);

    const extractedIne = {
      curp: curpMatch ? curpMatch[0] : 'NO DETECTADO',
      claveElector: claveElectorMatch ? claveElectorMatch[0] : 'NO DETECTADO',
      rawText: text
    };

    // Limpiar archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({ success: true, ineData: extractedIne });
  } catch (error) {
    console.error('Error en OCR:', error);
    res.status(500).json({ error: 'Error al escanear la credencial INE.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Backend ejecutándose localmente en http://localhost:${PORT}`);
});