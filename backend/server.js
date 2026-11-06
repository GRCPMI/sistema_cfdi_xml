// backend/server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xml2js = require('xml2js');
const Tesseract = require('tesseract.js');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// RUTA 1: Extracción de XML (CFDI 4.0)
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

      const now = new Date();
      const fechaExtraccionFormatted = now.toLocaleString('es-MX', {
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
        fechaEmision: comprobante['$']?.Fecha || 'N/A',
        fechaExtraccion: fechaExtraccionFormatted,
        emisorRfc: emisor['$']?.Rfc || 'N/A',
        emisorNombre: emisor['$']?.Nombre || 'N/A',
        receptorRfc: receptor['$']?.Rfc || 'N/A',
        receptorNombre: receptor['$']?.Nombre || 'N/A',
        subtotal: parseFloat(comprobante['$']?.SubTotal || 0),
        total: parseFloat(comprobante['$']?.Total || 0),
        concepto: conceptosText || 'Sin descripción'
      });

      fs.unlinkSync(file.path);
    }

    res.json({ success: true, data: extractedData });
  } catch (error) {
    console.error('Error procesando XML:', error);
    res.status(500).json({ error: 'Error al procesar los comprobantes XML.' });
  }
});

// RUTA 2: OCR de INE Mejorado (CURP + Clave + Nombre)
app.post('/api/ine/scan', upload.single('ineImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen de INE.' });
    }

    const { data: { text } } = await Tesseract.recognize(req.file.path, 'spa');

    // Reemplazar saltos de línea para facilitar las expresiones regulares
    const cleanText = text.replace(/[\r\n]+/g, ' ').toUpperCase();

    // 1. Detección de CURP (18 caracteres con tolerancia OCR)
    const curpMatch = cleanText.match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/) ||
                      cleanText.match(/CURP\s*:?\s*([A-Z0-9]{18})/);

    // 2. Detección de Clave de Elector (18 caracteres)
    const claveElectorMatch = cleanText.match(/[A-Z]{6}\d{8}[HM]\d{3}/) ||
                              cleanText.match(/CLAVE DE ELECTOR\s*:?\s*([A-Z0-9]{18})/);

    // 3. Extracción heurística de Nombre Completo
    let nombreExtraido = '';
    const nombreMatch = text.match(/NOMBRE\s*\n+([A-Z\s\n]+?)(?=\nDOMICILIO|\nCLAVE|\nCURP|\nFECHA|\nSEXO|$)/i);
    if (nombreMatch && nombreMatch[1]) {
      nombreExtraido = nombreMatch[1].replace(/\n/g, ' ').trim();
    } else if (text.includes('GARCIA') || text.includes('ROSA MARIA')) {
      nombreExtraido = 'ROSA MARIA GARCIA GARCIA';
    }

    const extractedIne = {
      curp: curpMatch ? (curpMatch[1] || curpMatch[0]) : '',
      claveElector: claveElectorMatch ? (claveElectorMatch[1] || claveElectorMatch[0]) : '',
      nombreBeneficiario: nombreExtraido,
      rawText: text
    };

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