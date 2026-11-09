// frontend/src/App.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { 
  Upload, FileSpreadsheet, Camera, Search, Layers, FileText, 
  UserCheck, ShieldCheck, CheckCircle2, Edit3, Trash2, 
  X, Filter, Download, Save, Calendar, Clock, ChevronRight, RotateCcw, User, FolderArchive
} from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export default function App() {
  // 1. Inicializar estados obteniendo los datos guardados en localStorage
  const [xmlRecords, setXmlRecords] = useState(() => {
    const saved = localStorage.getItem('xmlRecords');
    return saved ? JSON.parse(saved) : [];
  });

  const [ineData, setIneData] = useState(() => {
    const saved = localStorage.getItem('ineData');
    return saved ? JSON.parse(saved) : { curp: '', claveElector: '', nombreBeneficiario: '' };
  });

  // Lista de expedientes de INE guardados
  const [ineList, setIneList] = useState(() => {
    const saved = localStorage.getItem('ineList');
    return saved ? JSON.parse(saved) : [];
  });

  const [loadingXml, setLoadingXml] = useState(false);
  const [loadingIne, setLoadingIne] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Estado para Edición XML
  const [editingRecord, setEditingRecord] = useState(null);

  // Estado para Opciones de Exportación
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportOption, setExportOption] = useState('all'); 
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Estado para Vista de Calendario por Mes
  const [selectedMonthModal, setSelectedMonthModal] = useState(null);
  const [selectedDayDetails, setSelectedDayDetails] = useState(null);

  // Sincronización con localStorage
  useEffect(() => {
    localStorage.setItem('xmlRecords', JSON.stringify(xmlRecords));
  }, [xmlRecords]);

  useEffect(() => {
    localStorage.setItem('ineData', JSON.stringify(ineData));
  }, [ineData]);

  useEffect(() => {
    localStorage.setItem('ineList', JSON.stringify(ineList));
  }, [ineList]);

  // Función para reiniciar sesión
  const handleClearSession = () => {
    if (window.confirm('¿Desea borrar todos los datos guardados localmente y reiniciar la sesión?')) {
      localStorage.removeItem('xmlRecords');
      localStorage.removeItem('ineData');
      localStorage.removeItem('ineList');
      setXmlRecords([]);
      setIneList([]);
      setIneData({ curp: '', claveElector: '', nombreBeneficiario: '' });
    }
  };

  // CARGA MASIVA INTELIGENTE (Archivos XML sueltos, Carpetas o archivos .ZIP)
  const handleXmlUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setLoadingXml(true);
    setUploadStatus('Analizando y filtrando archivos...');

    const xmlFilesToUpload = [];

    try {
      for (const file of files) {
        // Caso A: Es un paquete comprimido .ZIP
        if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
          setUploadStatus(`Descomprimiendo paquete ZIP: ${file.name}...`);
          const zip = new JSZip();
          const unzippedContent = await zip.loadAsync(file);

          for (const relativePath of Object.keys(unzippedContent.files)) {
            const zipEntry = unzippedContent.files[relativePath];
            // Filtrar carpetas y seleccionar solo archivos terminados en .xml (ignorando PDFs u otros)
            if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.xml')) {
              const blob = await zipEntry.async('blob');
              const cleanFileName = relativePath.split('/').pop() || 'comprobante.xml';
              const xmlFile = new File([blob], cleanFileName, { type: 'text/xml' });
              xmlFilesToUpload.push(xmlFile);
            }
          }
        } 
        // Caso B: Es un archivo individual XML (se descartan directamente los .pdf u otros formatos)
        else if (file.name.toLowerCase().endsWith('.xml')) {
          xmlFilesToUpload.push(file);
        }
      }

      if (xmlFilesToUpload.length === 0) {
        alert('No se encontraron comprobantes válidos con extensión .XML en la selección o en el paquete ZIP.');
        setLoadingXml(false);
        setUploadStatus('');
        return;
      }

      setUploadStatus(`Enviando ${xmlFilesToUpload.length} archivo(s) XML al servidor...`);

      const formData = new FormData();
      xmlFilesToUpload.forEach((file) => {
        formData.append('xmlFiles', file);
      });

      const response = await fetch('http://localhost:5000/api/xml/parse', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (result.success) {
        // Evitar duplicados por UUID o Folio
        setXmlRecords((prev) => {
          const existingUuids = new Set(prev.map(item => item.uuid));
          const newUniqueRecords = result.data.filter(item => !existingUuids.has(item.uuid) || item.uuid === 'N/A');
          return [...prev, ...newUniqueRecords];
        });
        alert(`¡Carga masiva completada! Se procesaron ${result.data.length} comprobante(s) XML.`);
      } else {
        alert(result.error || 'Ocurrió un error al procesar el paquete en el servidor.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión o fallo al leer los archivos subidos/ZIP.');
    } finally {
      setLoadingXml(false);
      setUploadStatus('');
      // Limpiar input file
      e.target.value = '';
    }
  };

  // OCR INE con guardado automático en lista
  const handleIneScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoadingIne(true);
    const formData = new FormData();
    formData.append('ineImage', file);

    try {
      const response = await fetch('http://localhost:5000/api/ine/scan', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      
      if (result.success && result.ineData) {
        const newIne = {
          id: Date.now(),
          nombreBeneficiario: result.ineData.nombreBeneficiario || '',
          curp: result.ineData.curp || '',
          claveElector: result.ineData.claveElector || '',
          fechaEscaneo: new Date().toLocaleString('es-MX')
        };

        setIneData(newIne);
        setIneList((prev) => [newIne, ...prev]);

        alert('¡Credencial INE escaneada y registrada con éxito!');
      } else {
        alert('No se pudieron extraer datos de la imagen.');
      }
    } catch (err) {
      alert('Error de conexión con el backend durante el OCR.');
    } finally {
      setLoadingIne(false);
    }
  };

  // Agregar manualmente INE actual
  const handleSaveManualIne = () => {
    if (!ineData.nombreBeneficiario && !ineData.curp && !ineData.claveElector) {
      alert('Ingrese al menos un dato del beneficiario para registrar.');
      return;
    }
    const newIne = {
      id: Date.now(),
      nombreBeneficiario: ineData.nombreBeneficiario,
      curp: ineData.curp,
      claveElector: ineData.claveElector,
      fechaEscaneo: new Date().toLocaleString('es-MX')
    };
    setIneList((prev) => [newIne, ...prev]);
    alert('Beneficiario registrado en la tabla.');
  };

  const handleDeleteIne = (id) => {
    if (window.confirm('¿Desea eliminar esta INE de la lista?')) {
      setIneList((prev) => prev.filter((item) => item.id !== id));
    }
  };

  // Modificación y Borrado de XML
  const handleDeleteRecord = (id) => {
    if (window.confirm('¿Está seguro de eliminar este comprobante de la lista?')) {
      setXmlRecords(prev => prev.filter(item => item.id !== id));
    }
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    setXmlRecords(prev => prev.map(item => item.id === editingRecord.id ? editingRecord : item));
    setEditingRecord(null);
  };

  // Agrupación y Cálculo Mensual
  const monthlySummary = useMemo(() => {
    const summary = {};
    xmlRecords.forEach(record => {
      const dateObj = new Date(record.fechaEmision || record.fecha);
      const isValidDate = !isNaN(dateObj.getTime());
      
      const monthYearKey = isValidDate 
        ? `${dateObj.getFullYear()}-${dateObj.getMonth()}`
        : 'sin-fecha';

      const monthName = isValidDate
        ? dateObj.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
        : 'Sin Fecha';
      
      const formattedName = monthName.charAt(0).toUpperCase() + monthName.slice(1);

      if (!summary[monthYearKey]) {
        summary[monthYearKey] = { 
          key: monthYearKey,
          name: formattedName,
          year: isValidDate ? dateObj.getFullYear() : new Date().getFullYear(),
          monthIndex: isValidDate ? dateObj.getMonth() : 0,
          count: 0, 
          total: 0,
          records: []
        };
      }
      summary[monthYearKey].count += 1;
      summary[monthYearKey].total += record.total;
      summary[monthYearKey].records.push(record);
    });
    return summary;
  }, [xmlRecords]);

  const handleOpenMonthCalendar = (monthData) => {
    setSelectedMonthModal(monthData);
    setSelectedDayDetails(null);
  };

  const monthCalendarGrid = useMemo(() => {
    if (!selectedMonthModal || selectedMonthModal.key === 'sin-fecha') return null;

    const { year, monthIndex, records } = selectedMonthModal;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const firstDayIndex = new Date(year, monthIndex, 1).getDay();

    const daysData = {};
    for (let day = 1; day <= daysInMonth; day++) {
      daysData[day] = [];
    }

    records.forEach(rec => {
      const recDate = new Date(rec.fechaEmision || rec.fecha);
      if (!isNaN(recDate.getTime()) && recDate.getFullYear() === year && recDate.getMonth() === monthIndex) {
        const dayNum = recDate.getDate();
        if (daysData[dayNum]) {
          daysData[dayNum].push(rec);
        }
      }
    });

    return { daysInMonth, firstDayIndex, daysData };
  }, [selectedMonthModal]);

  // Exportación a Excel
  const executeExport = () => {
    let dataToExport = [...xmlRecords];

    if (exportOption === 'amountRange') {
      const min = parseFloat(minAmount) || 0;
      const max = parseFloat(maxAmount) || Infinity;
      dataToExport = dataToExport.filter(r => r.total >= min && r.total <= max);
    } else if (exportOption === 'filtered') {
      const term = searchTerm.toLowerCase();
      dataToExport = xmlRecords.filter(r => 
        r.emisorNombre.toLowerCase().includes(term) ||
        r.concepto.toLowerCase().includes(term) ||
        r.emisorRfc.toLowerCase().includes(term)
      );
    }

    if (dataToExport.length === 0) {
      alert('No hay registros que coincidan con el criterio seleccionado.');
      return;
    }

    const exportFormatted = dataToExport.map((item) => ({
      'Folio': item.folio,
      'UUID Fiscal': item.uuid || 'N/A',
      'Fecha Emisión Factura': item.fechaEmision || item.fecha,
      'Fecha/Hora de Carga': item.fechaExtraccion || item.fechaCarga || 'N/A',
      'RFC Emisor': item.emisorRfc,
      'Nombre Emisor': item.emisorNombre,
      'Concepto / Justificación': item.concepto,
      'Monto Subtotal ($)': item.subtotal,
      'Monto Total ($)': item.total,
      'CURP Beneficiario (INE)': ineData.curp || 'N/A',
      'Clave Elector (INE)': ineData.claveElector || 'N/A',
      'Nombre Beneficiario (INE)': ineData.nombreBeneficiario || 'N/A'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportFormatted);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte Gastos');
    XLSX.writeFile(workbook, `Reporte_CFDI_${exportOption}_${Date.now()}.xlsx`);
    
    setShowExportModal(false);
  };

  // Filtro de XML
  const filteredRecords = xmlRecords.filter(r => {
    const term = searchTerm.toLowerCase();
    return (
      r.emisorNombre.toLowerCase().includes(term) ||
      r.concepto.toLowerCase().includes(term) ||
      r.emisorRfc.toLowerCase().includes(term) ||
      (ineData.curp && ineData.curp.toLowerCase().includes(term)) ||
      (ineData.nombreBeneficiario && ineData.nombreBeneficiario.toLowerCase().includes(term))
    );
  });

  return (
    <div className="app-viewport">
      <style>{`
        .app-viewport {
          min-height: 100vh;
          background-color: #f8fafc;
          color: #1e293b;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          padding-bottom: 3rem;
        }

        .header-bar {
          background-color: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 1rem 2rem;
          margin-bottom: 2rem;
          position: sticky;
          top: 0;
          z-index: 40;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }

        .header-content {
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .brand-logo-container {
          display: flex;
          align-items: center;
          gap: 0.875rem;
        }

        .icon-badge {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          padding: 0.625rem;
          border-radius: 0.75rem;
          color: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .brand-title {
          font-size: 1.25rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #0f172a;
          margin: 0;
          text-transform: uppercase;
        }

        .brand-subtitle {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0.15rem 0 0 0;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .btn-excel {
          background: #059669;
          color: white;
          border: none;
          padding: 0.625rem 1.25rem;
          border-radius: 0.5rem;
          font-weight: 600;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }

        .btn-excel:hover {
          background: #047857;
          transform: translateY(-1px);
        }

        .btn-clear {
          background: #ffffff;
          color: #64748b;
          border: 1px solid #cbd5e1;
          padding: 0.625rem 1rem;
          border-radius: 0.5rem;
          font-weight: 600;
          font-size: 0.85rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-clear:hover {
          background: #f1f5f9;
          color: #dc2626;
          border-color: #fca5a5;
        }

        .main-container {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 1.5rem;
        }

        .cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .white-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding-bottom: 0.75rem;
          margin-bottom: 0.75rem;
          border-bottom: 1px solid #f1f5f9;
        }

        .card-title {
          font-size: 0.85rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #334155;
          margin: 0;
        }

        .card-desc {
          font-size: 0.75rem;
          color: #64748b;
          margin-bottom: 1.25rem;
          line-height: 1.4;
        }

        .drop-zone {
          border: 2px dashed #cbd5e1;
          background: #f8fafc;
          border-radius: 0.625rem;
          padding: 1.75rem 1rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          text-align: center;
          transition: all 0.2s ease;
        }

        .drop-zone:hover {
          border-color: #2563eb;
          background: #eff6ff;
        }

        .btn-scan {
          width: 100%;
          background: #faf5ff;
          border: 1px solid #e9d5ff;
          color: #7e22ce;
          padding: 0.75rem;
          border-radius: 0.5rem;
          font-size: 0.8rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-scan:hover {
          background: #f3e8ff;
        }

        .input-group {
          margin-top: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .input-field {
          width: 100%;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.75rem;
          color: #0f172a;
          box-sizing: border-box;
        }

        .input-field:focus {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
        }

        .metric-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          padding: 1.25rem;
          text-align: center;
          margin: auto 0;
        }

        .metric-number {
          font-size: 3rem;
          font-weight: 800;
          font-family: monospace;
          color: #2563eb;
          line-height: 1;
          margin: 0.25rem 0;
        }

        .month-summary-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          padding: 1.5rem;
          margin-bottom: 2rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }

        .month-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }

        .month-item {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.625rem;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .month-item:hover {
          border-color: #2563eb;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
          transform: translateY(-1px);
        }

        .table-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          padding: 1.5rem;
          margin-bottom: 2rem;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }

        .table-header-flex {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 1.25rem;
        }

        .search-box {
          position: relative;
          min-width: 280px;
        }

        .search-input {
          width: 100%;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem 0.5rem 2.25rem;
          font-size: 0.75rem;
          color: #0f172a;
          box-sizing: border-box;
        }

        .search-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
        }

        .custom-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 0.75rem;
          text-align: left;
        }

        .custom-table th {
          background: #f8fafc;
          color: #475569;
          text-transform: uppercase;
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.875rem 1rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .custom-table td {
          padding: 0.875rem 1rem;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
        }

        .custom-table tr:hover td {
          background: #f8fafc;
        }

        .action-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0.35rem;
          border-radius: 0.375rem;
          transition: background 0.2s;
        }

        .action-btn.edit { color: #2563eb; }
        .action-btn.edit:hover { background: #eff6ff; }
        
        .action-btn.delete { color: #dc2626; }
        .action-btn.delete:hover { background: #fef2f2; }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }

        .modal-body {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
          width: 100%;
          max-width: 550px;
          padding: 1.5rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
          max-height: 90vh;
          overflow-y: auto;
        }

        .radio-option {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          cursor: pointer;
          margin-bottom: 0.5rem;
        }

        .radio-option.selected {
          border-color: #2563eb;
          background: #eff6ff;
        }

        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 0.35rem;
          margin-top: 1rem;
        }

        .calendar-day-header {
          text-align: center;
          font-size: 0.65rem;
          font-weight: 700;
          color: #64748b;
          padding: 0.25rem 0;
          text-transform: uppercase;
        }

        .calendar-day-cell {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 0.375rem;
          min-height: 48px;
          padding: 0.35rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-start;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .calendar-day-cell:hover {
          border-color: #2563eb;
          background: #f8fafc;
        }

        .calendar-day-cell.active-has-data {
          border-color: #bfdbfe;
          background: #eff6ff;
        }

        .calendar-day-cell.selected-day {
          border-color: #059669;
          background: #ecfdf5;
          box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.2);
        }

        .day-number {
          font-size: 0.7rem;
          font-weight: 600;
          color: #334155;
        }

        .day-badge {
          background: #2563eb;
          color: white;
          font-size: 0.55rem;
          font-weight: 700;
          padding: 0.1rem 0.35rem;
          border-radius: 0.25rem;
          align-self: flex-end;
        }
      `}</style>

      {/* Encabezado */}
      <header className="header-bar">
        <div className="header-content">
          <div className="brand-logo-container">
            <div className="icon-badge">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h1 className="brand-title">EXTRACTOR XML MASIVO</h1>
              <p className="brand-subtitle">Procesamiento CFDI 4.0 & Soporte .ZIP / Carpetas (1-1000+ Facturas)</p>
            </div>
          </div>
          <div className="header-actions">
            {(xmlRecords.length > 0 || ineList.length > 0 || ineData.curp || ineData.claveElector) && (
              <button onClick={handleClearSession} className="btn-clear" title="Reiniciar Sesión">
                <RotateCcw size={16} />
                Limpiar Datos
              </button>
            )}
            <button onClick={() => setShowExportModal(true)} className="btn-excel">
              <FileSpreadsheet size={18} />
              Exportar Reporte Excel (.xlsx)
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-container">
        <div className="cards-grid">
          
          {/* Carga Masiva XML & ZIP */}
          <div className="white-card">
            <div>
              <div className="card-header">
                <Upload size={18} style={{ color: '#2563eb' }} />
                <h2 className="card-title">Carga Masiva (1 - 1000+ XML)</h2>
              </div>
              <p className="card-desc">
                Seleccione múltiples archivos XML, carpetas o paquetes <strong>.ZIP</strong>. Los archivos PDF e imágenes se filtrarán automáticamente.
              </p>
            </div>

            <label className="drop-zone">
              <FolderArchive size={34} style={{ color: '#2563eb', marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                {loadingXml ? uploadStatus : 'Cargar Archivos XML o .ZIP'}
              </span>
              <span style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem' }}>
                Permite seleccionar hasta 1,000+ comprobantes en lote
              </span>
              <input 
                type="file" 
                multiple 
                accept=".xml,.zip,application/zip,application/x-zip-compressed" 
                onChange={handleXmlUpload} 
                disabled={loadingXml}
                style={{ display: 'none' }} 
              />
            </label>
          </div>

          {/* OCR INE */}
          <div className="white-card">
            <div>
              <div className="card-header">
                <Camera size={18} style={{ color: '#7e22ce' }} />
                <h2 className="card-title">Escaneo de INE (OCR)</h2>
              </div>
              <p className="card-desc">
                Cargue la imagen para vincular los datos del beneficiario.
              </p>
            </div>

            <div>
              <label className="btn-scan">
                <Camera size={16} />
                <span>{loadingIne ? 'Procesando Foto...' : 'Tomar / Subir Foto INE'}</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleIneScan} style={{ display: 'none' }} />
              </label>

              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="Nombre Completo Beneficiario" 
                  value={ineData.nombreBeneficiario}
                  onChange={(e) => setIneData({...ineData, nombreBeneficiario: e.target.value})}
                  className="input-field"
                  style={{ fontWeight: 600 }}
                />
                <input 
                  type="text" 
                  placeholder="CURP (18 Caracteres)" 
                  value={ineData.curp}
                  onChange={(e) => setIneData({...ineData, curp: e.target.value.toUpperCase()})}
                  className="input-field"
                  style={{ fontFamily: 'monospace' }}
                />
                <input 
                  type="text" 
                  placeholder="Clave de Elector (18 Caracteres)" 
                  value={ineData.claveElector}
                  onChange={(e) => setIneData({...ineData, claveElector: e.target.value.toUpperCase()})}
                  className="input-field"
                  style={{ fontFamily: 'monospace' }}
                />
                <button 
                  onClick={handleSaveManualIne}
                  style={{ background: '#7e22ce', color: 'white', border: 'none', padding: '0.4rem', borderRadius: '0.375rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Registrar Beneficiario
                </button>
              </div>
            </div>
          </div>

          {/* Métricas de Control */}
          <div className="white-card">
            <div>
              <div className="card-header">
                <Layers size={18} style={{ color: '#059669' }} />
                <h2 className="card-title">Métricas de Control</h2>
              </div>
              <p className="card-desc">
                Conteo de registros procesados en la sesión activa.
              </p>
            </div>

            <div className="metric-box">
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
                Comprobantes XML Cargados
              </span>
              <div className="metric-number">{xmlRecords.length}</div>
              <span style={{ fontSize: '0.7rem', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontWeight: 600 }}>
                <CheckCircle2 size={13} /> Expediente Sincronizado
              </span>
            </div>
          </div>

        </div>

        {/* Resumen por Mes */}
        <div className="month-summary-card">
          <div className="card-header" style={{ marginBottom: 0 }}>
            <Calendar size={18} style={{ color: '#2563eb' }} />
            <h2 className="card-title">Resumen de Facturación por Mes</h2>
          </div>

          {Object.keys(monthlySummary).length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '1rem', textAlign: 'center' }}>
              Cargue archivos XML o paquetes .ZIP para visualizar el total acumulado y desplegar el calendario mensual.
            </p>
          ) : (
            <div className="month-grid">
              {Object.values(monthlySummary).map((data) => (
                <div key={data.key} className="month-item" onClick={() => handleOpenMonthCalendar(data)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>{data.name}</span>
                    <ChevronRight size={16} style={{ color: '#2563eb' }} />
                  </div>
                  <div style={{ margin: '0.5rem 0' }}>
                    <span style={{ fontSize: '0.65rem', color: '#64748b', display: 'block' }}>Monto Acumulado:</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#059669', fontFamily: 'monospace' }}>
                      ${data.total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN
                    </span>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: '#2563eb', fontWeight: 600 }}>
                    {data.count} factura(s) • Abrir calendario
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* TABLA 1: IDENTIFICACIONES INE / BENEFICIARIOS */}
        <div className="table-card">
          <div className="table-header-flex">
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <User size={18} style={{ color: '#7e22ce' }} /> Beneficiarios E Identificaciones INE ({ineList.length})
              </h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                Expedientes de identificación validados por OCR o ingresados manualmente.
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Nombre del Beneficiario</th>
                  <th>CURP</th>
                  <th>Clave de Elector</th>
                  <th>Fecha de Registro</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ineList.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                      No se han escaneado ni registrado identificaciones de INE.
                    </td>
                  </tr>
                ) : (
                  ineList.map((item) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>{item.nombreBeneficiario || 'N/A'}</td>
                      <td style={{ fontFamily: 'monospace', color: '#2563eb' }}>{item.curp || 'N/A'}</td>
                      <td style={{ fontFamily: 'monospace', color: '#475569' }}>{item.claveElector || 'N/A'}</td>
                      <td style={{ fontSize: '0.7rem', color: '#64748b' }}>{item.fechaEscaneo || 'N/A'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="action-btn delete" onClick={() => handleDeleteIne(item.id)} title="Eliminar INE">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TABLA 2: FACTURAS XML EXTRAÍDAS */}
        <div className="table-card">
          <div className="table-header-flex">
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                Facturas Extraídas ({filteredRecords.length})
              </h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                Aparecen registradas la fecha de la factura y el momento exacto de carga al sistema.
              </p>
            </div>

            <div className="search-box">
              <Search size={16} className="search-icon" />
              <input 
                type="text" 
                placeholder="Filtrar por emisor, RFC o concepto..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Fecha Emisión Factura</th>
                  <th>Fecha/Hora Carga</th>
                  <th>RFC Emisor</th>
                  <th>Nombre / Razón Social</th>
                  <th>Concepto del Gasto</th>
                  <th style={{ textAlign: 'right' }}>Total ($)</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                      <FileText size={40} style={{ opacity: 0.3, margin: '0 auto 0.5rem auto', display: 'block' }} />
                      No hay comprobantes XML cargados.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => (
                    <tr key={record.id}>
                      <td style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>{record.folio}</td>
                      <td style={{ fontSize: '0.7rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={12} style={{ color: '#2563eb' }} /> {(record.fechaEmision || record.fecha) ? new Date(record.fechaEmision || record.fecha).toLocaleDateString('es-MX') : 'S/F'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.7rem', color: '#0284c7', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Clock size={12} /> {record.fechaExtraccion || record.fechaCarga || 'N/A'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{record.emisorRfc}</td>
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>{record.emisorNombre}</td>
                      <td style={{ maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#64748b' }}>
                        {record.concepto}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#059669', fontWeight: 700, textAlign: 'right', fontSize: '0.85rem' }}>
                        ${record.total.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="action-btn edit" onClick={() => setEditingRecord({...record})} title="Editar registro">
                          <Edit3 size={15} />
                        </button>
                        <button className="action-btn delete" onClick={() => handleDeleteRecord(record.id)} title="Eliminar registro">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* MODAL 1: CALENDARIO INTERACTIVO DEL MES */}
      {selectedMonthModal && (
        <div className="modal-overlay">
          <div className="modal-body" style={{ maxWidth: '650px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calendar size={20} style={{ color: '#2563eb' }} /> Calendario de {selectedMonthModal.name}
                </h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.7rem', color: '#64748b' }}>
                  Seleccione un día para ver las facturas agregadas con su fecha y hora.
                </p>
              </div>
              <button onClick={() => setSelectedMonthModal(null)} className="action-btn"><X size={18} /></button>
            </div>

            {selectedMonthModal.key === 'sin-fecha' ? (
              <p style={{ fontSize: '0.75rem', color: '#64748b', padding: '1rem 0' }}>
                Los registros de este bloque no cuentan con una fecha de emisión válida en el XML.
              </p>
            ) : monthCalendarGrid && (
              <>
                <div className="calendar-grid">
                  {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
                    <div key={d} className="calendar-day-header">{d}</div>
                  ))}

                  {Array.from({ length: monthCalendarGrid.firstDayIndex }).map((_, idx) => (
                    <div key={`empty-${idx}`} style={{ opacity: 0.2 }} />
                  ))}

                  {Array.from({ length: monthCalendarGrid.daysInMonth }).map((_, idx) => {
                    const dayNum = idx + 1;
                    const dayRecords = monthCalendarGrid.daysData[dayNum] || [];
                    const hasData = dayRecords.length > 0;
                    const isSelected = selectedDayDetails === dayNum;

                    return (
                      <div 
                        key={`day-${dayNum}`} 
                        className={`calendar-day-cell ${hasData ? 'active-has-data' : ''} ${isSelected ? 'selected-day' : ''}`}
                        onClick={() => hasData ? setSelectedDayDetails(dayNum) : null}
                        style={{ cursor: hasData ? 'pointer' : 'default', opacity: hasData ? 1 : 0.4 }}
                      >
                        <span className="day-number">{dayNum}</span>
                        {hasData && (
                          <span className="day-badge">{dayRecords.length} XML</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedDayDetails && (
                  <div style={{ marginTop: '1.25rem', padding: '1rem', background: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #cbd5e1' }}>
                    <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Clock size={15} /> Facturas del día {selectedDayDetails} de {selectedMonthModal.name}
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                      {monthCalendarGrid.daysData[selectedDayDetails]?.map((rec) => (
                        <div key={rec.id} style={{ background: '#ffffff', padding: '0.6rem 0.75rem', borderRadius: '0.375rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0f172a' }}>
                              Folio: <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>{rec.folio}</span> — {rec.emisorNombre}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.15rem' }}>
                              Concepto: {rec.concepto}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: '#0284c7', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <Clock size={11} /> Carga al sistema: {rec.fechaExtraccion || rec.fechaCarga || 'N/A'}
                            </div>
                          </div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#059669', fontFamily: 'monospace', whiteSpace: 'nowrap', marginLeft: '0.75rem' }}>
                            ${rec.total.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button onClick={() => setSelectedMonthModal(null)} className="btn-excel" style={{ background: '#64748b' }}>
                Cerrar Calendario
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: EDICIÓN DE FACTURA */}
      {editingRecord && (
        <div className="modal-overlay">
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>Editar Comprobante XML</h3>
              <button onClick={() => setEditingRecord(null)} className="action-btn"><X size={18} /></button>
            </div>
            
            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Folio:</label>
                  <input 
                    type="text" 
                    value={editingRecord.folio} 
                    onChange={(e) => setEditingRecord({...editingRecord, folio: e.target.value})} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Fecha de Emisión:</label>
                  <input 
                    type="text" 
                    value={editingRecord.fechaEmision || editingRecord.fecha} 
                    onChange={(e) => setEditingRecord({...editingRecord, fechaEmision: e.target.value, fecha: e.target.value})} 
                    className="input-field" 
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', color: '#64748b' }}>RFC Emisor:</label>
                <input 
                  type="text" 
                  value={editingRecord.emisorRfc} 
                  onChange={(e) => setEditingRecord({...editingRecord, emisorRfc: e.target.value})} 
                  className="input-field" 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Nombre / Razón Social Emisor:</label>
                <input 
                  type="text" 
                  value={editingRecord.emisorNombre} 
                  onChange={(e) => setEditingRecord({...editingRecord, emisorNombre: e.target.value})} 
                  className="input-field" 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Concepto del Gasto:</label>
                <textarea 
                  rows="3"
                  value={editingRecord.concepto} 
                  onChange={(e) => setEditingRecord({...editingRecord, concepto: e.target.value})} 
                  className="input-field" 
                  style={{ resize: 'none' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Subtotal ($):</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editingRecord.subtotal} 
                    onChange={(e) => setEditingRecord({...editingRecord, subtotal: parseFloat(e.target.value) || 0})} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: '#64748b' }}>Total ($):</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={editingRecord.total} 
                    onChange={(e) => setEditingRecord({...editingRecord, total: parseFloat(e.target.value) || 0})} 
                    className="input-field" 
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="submit" className="btn-excel" style={{ flex: 1, justifyContent: 'center' }}>
                  <Save size={16} /> Guardar Cambios
                </button>
                <button type="button" onClick={() => setEditingRecord(null)} className="action-btn" style={{ border: '1px solid #cbd5e1', padding: '0.5rem 1rem' }}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EXPORTACIÓN */}
      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Filter size={18} style={{ color: '#059669' }} /> Opciones de Exportación
              </h3>
              <button onClick={() => setShowExportModal(false)} className="action-btn"><X size={18} /></button>
            </div>

            <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1rem' }}>
              Seleccione el criterio con el que desea generar la hoja de cálculo en Excel:
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label className={`radio-option ${exportOption === 'all' ? 'selected' : ''}`}>
                <input 
                  type="radio" 
                  name="exportType" 
                  checked={exportOption === 'all'} 
                  onChange={() => setExportOption('all')} 
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>Todos los XML ({xmlRecords.length})</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Exporta la totalidad de facturas cargadas.</div>
                </div>
              </label>

              <label className={`radio-option ${exportOption === 'filtered' ? 'selected' : ''}`}>
                <input 
                  type="radio" 
                  name="exportType" 
                  checked={exportOption === 'filtered'} 
                  onChange={() => setExportOption('filtered')} 
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>Facturas Filtradas Actuales ({filteredRecords.length})</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Exporta únicamente el resultado del buscador.</div>
                </div>
              </label>

              <label className={`radio-option ${exportOption === 'amountRange' ? 'selected' : ''}`}>
                <input 
                  type="radio" 
                  name="exportType" 
                  checked={exportOption === 'amountRange'} 
                  onChange={() => setExportOption('amountRange')} 
                />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a' }}>Filtrar por Rango de Montos ($)</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Exporta sólo las facturas que estén dentro de un límite.</div>
                </div>
              </label>
            </div>

            {exportOption === 'amountRange' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                <div>
                  <label style={{ fontSize: '0.65rem', color: '#64748b' }}>Monto Mínimo ($):</label>
                  <input 
                    type="number" 
                    placeholder="0.00" 
                    value={minAmount} 
                    onChange={(e) => setMinAmount(e.target.value)} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.65rem', color: '#64748b' }}>Monto Máximo ($):</label>
                  <input 
                    type="number" 
                    placeholder="Sin límite" 
                    value={maxAmount} 
                    onChange={(e) => setMaxAmount(e.target.value)} 
                    className="input-field" 
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button onClick={executeExport} className="btn-excel" style={{ flex: 1, justifyContent: 'center' }}>
                <Download size={16} /> Generar Excel
              </button>
              <button onClick={() => setShowExportModal(false)} className="action-btn" style={{ border: '1px solid #cbd5e1', padding: '0.5rem 1rem' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}