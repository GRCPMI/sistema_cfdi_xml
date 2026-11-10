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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

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

// Configuración de Multer optimizada para lotes grandes de más de 1,000 archivos
const upload = multer({
  storage,
  limits: {
    fieldSize: 100 * 1024 * 1024,
    fileSize: 50 * 1024 * 1024
  }
});

// RUTA 1: Extracción de XML (CFDI 4.0) Masiva
app.post('/api/xml/parse', upload.array('xmlFiles'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron archivos XML válidos.' });
    }

    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
    const extractedData = [];

    for (const file of req.files) {
      try {
        const xmlContent = fs.readFileSync(file.path, 'utf8');
        const result = await parser.parseStringPromise(xmlContent);

        const comprobante = result['cfdi:Comprobante'] || result['Comprobante'] || {};
        const emisor = comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {};
        const receptor = comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {};
        const conceptosRaw = comprobante['cfdi:Conceptos']?.['cfdi:Concepto'] || comprobante['Conceptos']?.['Concepto'] || [];
        const conceptosList = Array.isArray(conceptosRaw) ? conceptosRaw : [conceptosRaw];

        const conceptosText = conceptosList
          .map(c => c['$']?.Descripcion || c?.Descripcion || '')
          .filter(Boolean)
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
      } catch (fileErr) {
        console.error(`Error leyendo el archivo individual ${file.originalname}:`, fileErr);
      } finally {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    res.json({ success: true, data: extractedData });
  } catch (error) {
    console.error('Error en procesamiento masivo XML:', error);
    res.status(500).json({ error: 'Fallo al procesar el lote de comprobantes XML.' });
  }
});

// RUTA 2: OCR Completo de INE (Todos los campos y domicilio multilínea)
app.post('/api/ine/scan', upload.single('ineImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen de INE.' });
    }

    const processedImagePath = req.file.path + '-processed.png';

    // Preprocesamiento en Blanco y Negro (Threshold) para máxima precisión
    await sharp(req.file.path)
      .rotate()
      .grayscale()
      .threshold(160)
      .toFile(processedImagePath);

    const { data: { text } } = await Tesseract.recognize(processedImagePath, 'spa');

    console.log("--- TEXTO OCR COMPLETO ---");
    console.log(text);
    console.log("--------------------------");

    const cleanText = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 1. CURP (18 caracteres exactos)
    let curp = '';
    const curpMatch = cleanText.match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/);
    if (curpMatch) {
      curp = curpMatch[0].substring(0, 18);
    } else {
      const curpIdx = lines.findIndex(l => l.toUpperCase().includes('CURP'));
      if (curpIdx !== -1 && lines[curpIdx + 1]) {
        const cleanVal = lines[curpIdx + 1].replace(/[^A-Z0-9]/g, '');
        if (cleanVal.length >= 16) curp = cleanVal.substring(0, 18);
      }
    }

    // 2. CLAVE DE ELECTOR (18 caracteres exactos)
    let claveElector = '';
    const claveMatch = cleanText.match(/[A-Z]{6}\d{8}[HM]\d{3}/) || cleanText.match(/[A-Z0-9]{18}/g)?.find(c => c !== curp);
    if (claveMatch) {
      const val = typeof claveMatch === 'string' ? claveMatch : claveMatch[0];
      claveElector = val.substring(0, 18);
    }

    // 3. NOMBRE (Entre NOMBRE y DOMICILIO, filtrando ruido)
    let nombreBeneficiario = '';
    const nombreIdx = lines.findIndex(l => l.toUpperCase().includes('NOMBRE') || l.toUpperCase().includes('NONBRE'));
    const domicilioIdx = lines.findIndex(l => l.toUpperCase().includes('DOMICILIO'));

    if (nombreIdx !== -1 && domicilioIdx !== -1 && domicilioIdx > nombreIdx) {
      let fragmentosNombre = [];
      for (let i = nombreIdx + 1; i < domicilioIdx; i++) {
        let linea = lines[i].toUpperCase();
        if (linea.includes('SEXO') || linea.includes('H') || linea.includes('M') || linea.length <= 2) continue;
        let limpia = linea.replace(/[^A-ZÁÉÍÓÚÑ\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (limpia.length > 3) fragmentosNombre.push(limpia);
      }
      nombreBeneficiario = fragmentosNombre.join(' ');
    }

    // 4. DOMICILIO (Con los 3 saltos de línea solicitados: Calle/Colonia, CP, Localidad/Estado)
    let domicilio = '';
    if (domicilioIdx !== -1) {
      let lineasDomicilio = [];
      // Tomamos hasta 3 líneas debajo de la etiqueta DOMICILIO
      for (let i = domicilioIdx + 1; i <= domicilioIdx + 3 && i < lines.length; i++) {
        let lDom = lines[i];
        if (lDom.toUpperCase().includes('CLAVE') || lDom.toUpperCase().includes('CURP') || lDom.toUpperCase().includes('AÑO')) break;
        if (lDom.length > 2) lineasDomicilio.push(lDom);
      }
      // Unimos las líneas usando saltos de línea explícitos (\n) simulando el formato de la credencial
      domicilio = lineasDomicilio.join('\n');
    }

    // 5. FECHA DE NACIMIENTO
    let fechaNacimiento = '';
    const fechaMatch = cleanText.match(/\d{2}\/\d{2}\/\d{4}/);
    if (fechaMatch) {
      fechaNacimiento = fechaMatch[0];
    }

    // 6. AÑO DE REGISTRO (4 dígitos numéricos generalmente asociados al año)
    let anioRegistro = '';
    const anioMatch = cleanText.match(/AÑO DE REGISTRO\s*(\d{4})/i) || cleanText.match(/\b(19|20)\d{2}\b/);
    if (anioMatch) {
      anioRegistro = anioMatch[1] || anioMatch[0];
    }

    // 7. SECCIÓN (4 dígitos numéricos)
    let seccion = '';
    const seccionMatch = cleanText.match(/SECCION\s*(\d{4})/i) || cleanText.match(/\b\d{4}\b/g)?.find(s => s !== anioRegistro);
    if (seccionMatch) {
      seccion = seccionMatch[1] || seccionMatch;
    }

    // 8. VIGENCIA (Rango de años como 2020-2030)
    let vigencia = '';
    const vigenciaMatch = cleanText.match(/\d{4}\s*-\s*\d{4}/);
    if (vigenciaMatch) {
      vigencia = vigenciaMatch[0].replace(/\s/g, '');
    }

    // 9. SEXO (H o M)
    let sexo = '';
    const sexoMatch = cleanText.match(/SEXO\s*([HM])/i) || cleanText.match(/\b([HM])\b/g);
    if (sexoMatch) {
      sexo = sexoMatch[1] || (Array.isArray(sexoMatch) ? sexoMatch[0] : '');
    }

    // Objeto consolidado con todos los campos solicitados
    const extractedIne = {
      nombreBeneficiario: nombreBeneficiario || '',
      domicilio: domicilio || '',
      claveElector: claveElector || '',
      curp: curp || '',
      fechaNacimiento: fechaNacimiento || '',
      anioRegistro: anioRegistro || '',
      seccion: seccion || '',
      vigencia: vigencia || '',
      sexo: sexo || '',
      rawText: text
    };

    fs.unlinkSync(req.file.path);
    if (fs.existsSync(processedImagePath)) fs.unlinkSync(processedImagePath);

    res.json({ success: true, ineData: extractedIne });
  } catch (error) {
    console.error('Error en OCR Completo:', error);
    res.status(500).json({ error: 'Error al procesar todos los campos de la credencial INE.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Backend ejecutándose localmente en http://localhost:${PORT}`);
});